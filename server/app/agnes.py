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
        retries: int = 2,
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
        attempts = max(1, int(retries) + 1)
        last_exc: Exception | None = None
        last_error: str | None = None
        resp = None
        data: Any = None
        for attempt in range(attempts):
            try:
                with httpx.Client(timeout=90.0) as client:
                    resp = client.post(url, headers=headers, json=payload)
            except httpx.TimeoutException as exc:
                last_exc = exc
                last_error = "AI 响应超时，请稍后重试"
                if attempt + 1 < attempts:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                latency_ms = int((time.perf_counter() - started) * 1000)
                return {
                    "ok": False,
                    "status_code": 504,
                    "latency_ms": latency_ms,
                    "error": last_error,
                }
            except httpx.RequestError as exc:
                last_exc = exc
                last_error = f"AI 服务连接失败: {exc}"
                # DNS / 瞬时断网：短暂退避后重试
                if attempt + 1 < attempts:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                latency_ms = int((time.perf_counter() - started) * 1000)
                return {
                    "ok": False,
                    "status_code": 0,
                    "latency_ms": latency_ms,
                    "error": last_error,
                }

            try:
                data = resp.json()
            except Exception:
                data = {"raw_text": resp.text}

            # 限流 / 网关抖动：退避后再试，演示时少打「连不上」
            if resp.status_code in (408, 429, 500, 502, 503, 504) and attempt + 1 < attempts:
                last_error = (
                    (data.get("error") if isinstance(data, dict) else None)
                    or f"AI 服务暂时不可用({resp.status_code})"
                )
                time.sleep(0.6 * (attempt + 1))
                continue
            break

        if resp is None:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return {
                "ok": False,
                "status_code": 0,
                "latency_ms": latency_ms,
                "error": last_error or f"AI 服务连接失败: {last_exc or 'unknown'}",
            }

        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return {
                "ok": False,
                "status_code": resp.status_code,
                "latency_ms": latency_ms,
                "request": payload,
                "response": data,
                "error": (
                    (data.get("error") if isinstance(data, dict) else None)
                    or last_error
                    or resp.text
                ),
            }

        content = _extract_message_content(data)
        choice0 = ((data.get("choices") or [{}])[0] if isinstance(data, dict) else {}) or {}
        finish_reason = choice0.get("finish_reason")
        return {
            "ok": True,
            "status_code": resp.status_code,
            "latency_ms": latency_ms,
            "request": {**payload, "messages": messages},
            "response": data,
            "content": content,
            "finish_reason": finish_reason,
            "usage": data.get("usage") if isinstance(data, dict) else None,
        }


def _extract_message_content(data: Any) -> str:
    """兼容 content 字符串 / 分段数组；忽略仅有 reasoning 的空正文。"""
    try:
        msg = data["choices"][0]["message"]
    except Exception:
        return ""
    content = msg.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text") or part.get("content")
                if text:
                    parts.append(str(text))
        content = "".join(parts)
    if content is None:
        return ""
    return str(content).strip()
