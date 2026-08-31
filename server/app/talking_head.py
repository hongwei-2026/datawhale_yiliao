"""MiniMax H3：肖像 + TTS 音频 → 口型同步说话视频（路线 B）。"""

from __future__ import annotations

import base64
import hashlib
import io
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "web"
PORTRAIT_DIR = WEB_DIR / "live2d" / "portraits"
CACHE_DIR = ROOT / "data" / "talking_cache"

PERSONA_PROMPT = {
    "PER-HTN-TAXI-01": "中年男性受试者李建国，社区医院随访，自然说话，轻微点头，口型与参考音频一致，写实风格，上半身，背景简洁。",
    "PER-ELDER-BASIC-01": "老年男性受试者张大爷，社区医院随访，和蔼自然说话，口型与参考音频一致，写实风格，上半身。",
    "PER-ELDER-FEMALE-02": "老年女性受试者王阿姨，社区医院随访，亲切自然说话，口型与参考音频一致，写实风格，上半身。",
    "default": "中国医院随访受试者，自然说话，口型与参考音频一致，写实半身像，背景简洁。",
}

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _video_api_root(settings) -> str:
    base = (settings.minimax_base_url or "https://api.minimaxi.com/v1").rstrip("/")
    if base.endswith("/v1"):
        return base[:-3]
    return base


def _cache_key(persona_id: str, text: str, audio_bytes: bytes) -> str:
    normalized = (text or "").strip()
    if normalized:
        digest = hashlib.sha256(f"{persona_id}:{normalized}".encode("utf-8")).hexdigest()[:20]
    else:
        digest = hashlib.sha256(audio_bytes).hexdigest()[:20]
    safe = (persona_id or "default").replace("/", "_")
    return f"{safe}_{digest}"


def _load_portrait_raster(persona_id: str) -> tuple[bytes, str] | None:
    pid = persona_id or "default"
    candidates = [
        PORTRAIT_DIR / f"{pid}.webp",
        PORTRAIT_DIR / f"{pid}.png",
        PORTRAIT_DIR / f"{pid}.jpg",
        PORTRAIT_DIR / f"{pid}.jpeg",
        PORTRAIT_DIR / "PER-ELDER-BASIC-01.webp",
        PORTRAIT_DIR / "PER-ELDER-BASIC-01.png",
    ]
    for path in candidates:
        if path.is_file():
            raw = path.read_bytes()
            ext = path.suffix.lower().lstrip(".")
            mime = {"webp": "webp", "png": "png", "jpg": "jpeg", "jpeg": "jpeg"}.get(ext, "jpeg")
            try:
                from PIL import Image

                img = Image.open(io.BytesIO(raw)).convert("RGB")
                w, h = img.size
                if w < 512 or h < 512:
                    scale = max(512 / w, 512 / h)
                    img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=92)
                return buf.getvalue(), "jpeg"
            except Exception:
                return raw, mime
    return None


def _pad_audio_to_min_duration(audio_bytes: bytes, min_ms: int = 2100) -> bytes:
    """H3 要求参考音频 2–15 秒；过短则在末尾补静音。"""
    try:
        from pydub import AudioSegment

        seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
        if len(seg) >= min_ms:
            return audio_bytes
        padded = seg + AudioSegment.silent(duration=min_ms - len(seg))
        buf = io.BytesIO()
        padded.export(buf, format="mp3")
        return buf.getvalue()
    except Exception:
        return audio_bytes


def _audio_duration_sec(audio_bytes: bytes, audio_length_ms: int | None) -> int:
    try:
        from pydub import AudioSegment

        ms = len(AudioSegment.from_mp3(io.BytesIO(audio_bytes)))
    except Exception:
        ms = audio_length_ms or 0
    if ms <= 0:
        ms = max(4000, len(audio_bytes) // 4)
    sec = int(round(ms / 1000))
    return max(4, min(15, sec))


class TalkingHeadService:
    def __init__(self, settings):
        self.settings = settings
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def configured(self) -> bool:
        key = (self.settings.minimax_api_key or "").strip()
        return bool(key) and key != "your_key_here"

    @property
    def enabled(self) -> bool:
        return bool(getattr(self.settings, "talking_head_enabled", True)) and self.configured

    def cached_video_url(self, persona_id: str, text: str, audio_bytes: bytes) -> str | None:
        path = CACHE_DIR / f"{_cache_key(persona_id, text, audio_bytes)}.mp4"
        if path.is_file() and path.stat().st_size > 1024:
            return f"/media/talking/{path.name}"
        return None

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with _jobs_lock:
            job = _jobs.get(job_id)
            return dict(job) if job else None

    def start_job(
        self,
        *,
        persona_id: str,
        text: str,
        audio_bytes: bytes,
        audio_length_ms: int | None = None,
    ) -> str:
        job_id = uuid.uuid4().hex
        with _jobs_lock:
            _jobs[job_id] = {
                "status": "queued",
                "persona_id": persona_id,
                "created_at": time.time(),
            }

        def _run() -> None:
            with _jobs_lock:
                _jobs[job_id]["status"] = "running"
            result = self.generate(
                persona_id=persona_id,
                text=text,
                audio_bytes=audio_bytes,
                audio_length_ms=audio_length_ms,
            )
            with _jobs_lock:
                if result.get("ok"):
                    _jobs[job_id] = {
                        "status": "succeeded",
                        "video_url": result.get("video_url"),
                        "cache_hit": result.get("cache_hit", False),
                        "task_id": result.get("task_id"),
                    }
                else:
                    _jobs[job_id] = {
                        "status": "failed",
                        "error": result.get("error") or "口型视频生成失败",
                        "detail": result.get("detail"),
                    }

        threading.Thread(target=_run, daemon=True).start()
        return job_id

    def generate(
        self,
        *,
        persona_id: str,
        text: str,
        audio_bytes: bytes,
        audio_length_ms: int | None = None,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": "说话数字人未启用或未配置 MiniMax"}

        cache_path = CACHE_DIR / f"{_cache_key(persona_id, text, audio_bytes)}.mp4"
        if cache_path.is_file() and cache_path.stat().st_size > 1024:
            return {
                "ok": True,
                "mode": "talking_video",
                "video_url": f"/media/talking/{cache_path.name}",
                "cache_hit": True,
            }

        portrait = _load_portrait_raster(persona_id)
        if not portrait:
            return {
                "ok": False,
                "error": "缺少写实肖像，请运行: python scripts/generate_persona_assets.py --portraits",
                "mode": "audio_only",
            }

        image_bytes, image_fmt = portrait
        audio_bytes = _pad_audio_to_min_duration(audio_bytes)
        duration = _audio_duration_sec(audio_bytes, audio_length_ms)
        prompt = PERSONA_PROMPT.get(persona_id) or PERSONA_PROMPT["default"]
        if text:
            snippet = text.strip().replace('"', "'")[:120]
            prompt = f'{prompt} 台词大意："{snippet}"'

        img_b64 = base64.b64encode(image_bytes).decode("ascii")
        aud_b64 = base64.b64encode(audio_bytes).decode("ascii")
        resolution = getattr(self.settings, "talking_head_resolution", "768P") or "768P"
        timeout = int(getattr(self.settings, "talking_head_timeout_sec", 120) or 120)

        payload = {
            "model": "MiniMax-H3",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/{image_fmt};base64,{img_b64}"},
                    "role": "reference_image",
                },
                {
                    "type": "audio_url",
                    "audio_url": {"url": f"data:audio/mp3;base64,{aud_b64}"},
                    "role": "reference_audio",
                },
            ],
            "resolution": resolution,
            "duration": duration,
            "ratio": "3:4",
            "aigc_watermark": False,
        }

        api_root = _video_api_root(self.settings)
        headers = {
            "Authorization": f"Bearer {self.settings.minimax_api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=60.0) as client:
                create_res = client.post(
                    f"{api_root}/v2/video_generation",
                    headers=headers,
                    json=payload,
                )
                if create_res.status_code >= 400:
                    return {
                        "ok": False,
                        "error": f"H3 创建任务失败 HTTP {create_res.status_code}",
                        "detail": create_res.text[:400],
                        "mode": "audio_only",
                    }
                create_data = create_res.json()
                task_id = create_data.get("task_id")
                if not task_id:
                    return {
                        "ok": False,
                        "error": "H3 未返回 task_id",
                        "detail": str(create_data)[:400],
                        "mode": "audio_only",
                    }

                deadline = time.time() + timeout
                while time.time() < deadline:
                    time.sleep(3)
                    query_res = client.get(
                        f"{api_root}/v2/query/video_generation/{task_id}",
                        headers=headers,
                    )
                    if query_res.status_code >= 400:
                        continue
                    query_data = query_res.json()
                    task = query_data.get("task") or {}
                    status = task.get("status")
                    if status == "succeeded":
                        video_url = (task.get("content") or {}).get("url")
                        if not video_url:
                            return {"ok": False, "error": "H3 成功但无视频 URL", "mode": "audio_only"}
                        try:
                            vid_res = client.get(video_url, timeout=120.0)
                            vid_res.raise_for_status()
                            cache_path.write_bytes(vid_res.content)
                        except Exception as exc:
                            return {
                                "ok": False,
                                "error": f"下载视频失败: {exc}",
                                "remote_url": video_url,
                                "mode": "audio_only",
                            }
                        return {
                            "ok": True,
                            "mode": "talking_video",
                            "video_url": f"/media/talking/{cache_path.name}",
                            "cache_hit": False,
                            "task_id": task_id,
                            "duration": task.get("duration"),
                        }
                    if status in ("failed", "cancelled"):
                        err = task.get("error") or {}
                        return {
                            "ok": False,
                            "error": err.get("message") or f"H3 任务 {status}",
                            "mode": "audio_only",
                            "task_id": task_id,
                        }

                return {
                    "ok": False,
                    "error": f"H3 生成超时（>{timeout}s）",
                    "mode": "audio_only",
                    "task_id": task_id,
                }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "mode": "audio_only"}
