"""Agnes AI（OpenAI 兼容）客户端。"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .config import Settings


class AgnesClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(self.settings.agnes_api_key) and self.settings.agnes_api_key != "your_key_here"

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.4,
        max_tokens: int = 512,
    ) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("AGNES_API_KEY 未配置")

        url = f"{self.settings.agnes_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.agnes_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.agnes_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        started = time.perf_counter()
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=payload)
            latency_ms = int((time.perf_counter() - started) * 1000)
            try:
                data = resp.json()
            except Exception:
                data = {"raw_text": resp.text}
            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "status_code": resp.status_code,
                    "latency_ms": latency_ms,
                    "request": payload,
                    "response": data,
                    "error": data.get("error") if isinstance(data, dict) else resp.text,
                }
            content = ""
            try:
                content = data["choices"][0]["message"]["content"]
            except Exception:
                content = ""
            return {
                "ok": True,
                "status_code": resp.status_code,
                "latency_ms": latency_ms,
                "request": {**payload, "messages": messages},
                "response": data,
                "content": content,
                "usage": data.get("usage") if isinstance(data, dict) else None,
            }
