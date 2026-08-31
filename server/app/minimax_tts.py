"""MiniMax 同步语音合成（受试者旁白）。密钥仅服务端使用。"""

from __future__ import annotations

import base64
from typing import Any

import httpx


class MiniMaxTTS:
    def __init__(self, settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        key = (self.settings.minimax_api_key or "").strip()
        return bool(key) and key != "your_key_here"

    @property
    def api_key_masked(self) -> str:
        key = self.settings.minimax_api_key or ""
        if len(key) < 12:
            return "(未配置)"
        return f"{key[:7]}…{key[-4:]}"

    def synthesize(self, text: str, *, emotion: str | None = None) -> dict[str, Any]:
        text = (text or "").strip()
        if not text:
            return {"ok": False, "error": "文本为空"}
        if not self.configured:
            return {"ok": False, "error": "MINIMAX_API_KEY 未配置"}

        # 控制延迟：短句 + turbo
        if len(text) > 500:
            text = text[:500]

        url = f"{self.settings.minimax_base_url.rstrip('/')}/t2a_v2"
        payload = {
            "model": self.settings.minimax_tts_model,
            "text": text,
            "stream": False,
            "voice_setting": {
                "voice_id": self.settings.minimax_voice_id,
                "speed": self.settings.minimax_voice_speed,
                "vol": 1,
                "pitch": 0,
                "emotion": emotion or self.settings.minimax_voice_emotion,
            },
            "audio_setting": {
                "sample_rate": 32000,
                "bitrate": 128000,
                "format": "mp3",
                "channel": 1,
            },
        }
        headers = {
            "Authorization": f"Bearer {self.settings.minimax_api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                res = client.post(url, headers=headers, json=payload)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        if res.status_code >= 400:
            return {
                "ok": False,
                "error": f"HTTP {res.status_code}",
                "detail": res.text[:500],
            }

        try:
            data = res.json()
        except Exception:
            return {"ok": False, "error": "响应非 JSON", "detail": res.text[:200]}

        base = data.get("base_resp") or {}
        if base.get("status_code") not in (None, 0):
            return {
                "ok": False,
                "error": base.get("status_msg") or "合成失败",
                "status_code": base.get("status_code"),
            }

        audio_hex = (data.get("data") or {}).get("audio")
        if not audio_hex:
            return {"ok": False, "error": "无音频数据", "raw": data}

        try:
            audio_b64 = base64.b64encode(bytes.fromhex(audio_hex)).decode("ascii")
        except Exception as exc:
            return {"ok": False, "error": f"音频解码失败: {exc}"}

        extra = data.get("extra_info") or {}
        return {
            "ok": True,
            "format": "mp3",
            "audio_base64": audio_b64,
            "audio_length_ms": extra.get("audio_length"),
            "usage_characters": extra.get("usage_characters"),
            "trace_id": data.get("trace_id"),
            "model": self.settings.minimax_tts_model,
            "voice_id": self.settings.minimax_voice_id,
        }
