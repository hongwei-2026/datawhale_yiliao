"""MuseTalk GPU 口型视频：肖像 + TTS 音频 → 本地 GPU 生成（音画合一）。"""

from __future__ import annotations

import hashlib
import io
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
PORTRAIT_DIR = ROOT / "web" / "live2d" / "portraits"
CACHE_DIR = ROOT / "data" / "talking_cache"

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _cache_key(persona_id: str, text: str, audio_bytes: bytes) -> str:
    normalized = (text or "").strip()
    if normalized:
        digest = hashlib.sha256(f"musetalk:{persona_id}:{normalized}".encode()).hexdigest()[:20]
    else:
        digest = hashlib.sha256(audio_bytes).hexdigest()[:20]
    safe = (persona_id or "default").replace("/", "_")
    return f"mt_{safe}_{digest}"


class MuseTalkService:
    def __init__(self, settings):
        self.settings = settings
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def base_url(self) -> str:
        return (getattr(self.settings, "musetalk_base_url", "") or "http://127.0.0.1:8770").rstrip("/")

    @property
    def enabled(self) -> bool:
        return bool(getattr(self.settings, "musetalk_enabled", False))

    def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": "MuseTalk 未启用"}
        try:
            with httpx.Client(timeout=5.0) as client:
                res = client.get(f"{self.base_url}/health")
                return res.json() if res.status_code == 200 else {"ok": False, "error": res.text[:200]}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
    ) -> str:
        job_id = uuid.uuid4().hex
        with _jobs_lock:
            _jobs[job_id] = {"status": "queued", "persona_id": persona_id, "created_at": time.time()}

        def _run() -> None:
            with _jobs_lock:
                _jobs[job_id]["status"] = "running"
            result = self.generate(persona_id=persona_id, text=text, audio_bytes=audio_bytes)
            with _jobs_lock:
                if result.get("ok"):
                    _jobs[job_id] = {
                        "status": "succeeded",
                        "video_url": result.get("video_url"),
                        "cache_hit": result.get("cache_hit", False),
                        "latency_sec": result.get("latency_sec"),
                    }
                else:
                    _jobs[job_id] = {
                        "status": "failed",
                        "error": result.get("error") or "MuseTalk 生成失败",
                    }

        threading.Thread(target=_run, daemon=True).start()
        return job_id

    def generate(
        self,
        *,
        persona_id: str,
        text: str,
        audio_bytes: bytes,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "error": "MuseTalk 未启用"}

        cache_path = CACHE_DIR / f"{_cache_key(persona_id, text, audio_bytes)}.mp4"
        if cache_path.is_file() and cache_path.stat().st_size > 1024:
            return {
                "ok": True,
                "mode": "talking_video",
                "video_url": f"/media/talking/{cache_path.name}",
                "cache_hit": True,
            }

        timeout = float(getattr(self.settings, "musetalk_timeout_sec", 60) or 60)
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(
                    f"{self.base_url}/generate",
                    data={"persona_id": persona_id or "PER-ELDER-BASIC-01"},
                    files={"audio": ("speech.mp3", audio_bytes, "audio/mpeg")},
                )
                if res.status_code >= 400:
                    return {"ok": False, "error": f"MuseTalk HTTP {res.status_code}: {res.text[:200]}"}
                data = res.json()
                if not data.get("ok"):
                    return {"ok": False, "error": data.get("error") or "MuseTalk 失败"}

                remote_path = data.get("video_path", "")
                name = Path(remote_path).name
                vid_res = client.get(f"{self.base_url}/video/{name}", timeout=60.0)
                if vid_res.status_code >= 400:
                    return {"ok": False, "error": "下载 MuseTalk 视频失败"}
                cache_path.write_bytes(vid_res.content)
                return {
                    "ok": True,
                    "mode": "talking_video",
                    "video_url": f"/media/talking/{cache_path.name}",
                    "cache_hit": False,
                    "latency_sec": data.get("latency_sec"),
                }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
