"""受试者旁白韵律：用停顿 / 语速 / 音量 / 音高模拟情绪听感。"""

from __future__ import annotations

import re
from typing import Any

# MiniMax t2a：speed 0.5–2，vol 0–10，pitch -12–12；停顿 <#秒#>
STANCE_PROSODY: dict[str, dict[str, Any]] = {
    "cooperative": {
        "speed": 0.98,
        "vol": 1.0,
        "pitch": 0,
        "pause_sec": 0.28,
        "comma_pause_sec": 0.0,
        "prefix_tag": "",
        "label": "平稳自然",
    },
    "guarded": {
        "speed": 0.88,
        "vol": 0.90,
        "pitch": -1,
        "pause_sec": 0.48,
        "comma_pause_sec": 0.18,
        "prefix_tag": "(emm)",
        "label": "偏慢、略轻、句间犹豫",
    },
    "defensive": {
        "speed": 1.12,
        "vol": 1.18,
        "pitch": 1,
        "pause_sec": 0.18,
        "comma_pause_sec": 0.0,
        "prefix_tag": "",
        "label": "略快、略响、短促",
    },
    "withdrawn": {
        "speed": 0.78,
        "vol": 0.72,
        "pitch": -2,
        "pause_sec": 0.72,
        "comma_pause_sec": 0.28,
        "prefix_tag": "(sighs)",
        "label": "更慢、更轻、长停顿",
    },
    "relieved": {
        "speed": 1.02,
        "vol": 1.06,
        "pitch": 1,
        "pause_sec": 0.32,
        "comma_pause_sec": 0.0,
        "prefix_tag": "(breath)",
        "label": "松一口气后略轻快",
    },
}


def build_tts_prosody(
    stance: str | None,
    *,
    trust: int | float | None = None,
    tts_emotion: str | None = None,
) -> dict[str, Any]:
    """根据 stance（及信任度微调）生成 TTS 韵律参数。"""
    key = stance if stance in STANCE_PROSODY else "cooperative"
    base = dict(STANCE_PROSODY[key])
    speed = float(base["speed"])
    vol = float(base["vol"])
    pitch = int(base["pitch"])
    pause_sec = float(base["pause_sec"])
    comma_pause = float(base["comma_pause_sec"])

    # 信任越低：更慢、更轻、停顿更长（在 stance 基础上微调）
    try:
        t = int(trust) if trust is not None else 55
    except (TypeError, ValueError):
        t = 55
    t = max(0, min(100, t))
    if t < 35:
        speed = max(0.5, speed - 0.06)
        vol = max(0.5, vol - 0.08)
        pause_sec = min(1.2, pause_sec + 0.12)
        pitch = max(-12, pitch - 1)
    elif t > 75 and key in ("cooperative", "relieved"):
        speed = min(1.25, speed + 0.03)
        vol = min(1.4, vol + 0.04)

    return {
        "stance": key,
        "emotion": tts_emotion or None,
        "speed": round(speed, 2),
        "vol": round(vol, 2),
        "pitch": pitch,
        "pause_sec": round(pause_sec, 2),
        "comma_pause_sec": round(comma_pause, 2),
        "prefix_tag": base.get("prefix_tag") or "",
        "label": base.get("label") or "",
    }


_SENT_SPLIT = re.compile(r"(?<=[。！？；])\s+|(?<=[。！？；])(?=[^。！？；])|(?<=……)\s*")
_PAUSE_RE = re.compile(r"<#\d+(?:\.\d{1,2})?#>")


def _clamp_pause(sec: float) -> float:
    return max(0.01, min(2.5, float(sec)))


def inject_speech_pauses(text: str, prosody: dict[str, Any] | None) -> str:
    """在句间（必要时逗号后）插入 MiniMax 停顿标记 <#x#>。"""
    raw = (text or "").strip()
    if not raw or not prosody:
        return raw

    # 去掉已有停顿，避免叠加
    cleaned = _PAUSE_RE.sub("", raw)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    # 规范省略号，避免单个「…」被误切
    cleaned = cleaned.replace("...", "……").replace("…", "……")
    cleaned = re.sub(r"……{2,}", "……", cleaned)

    pause = _clamp_pause(float(prosody.get("pause_sec") or 0.3))
    comma_pause = float(prosody.get("comma_pause_sec") or 0)
    marker = f"<#{pause:.2f}#>"

    # 只在句号/问叹/分号/成对省略号后切开
    parts = re.split(r"(?<=[。！？；])|(?<=……)", cleaned)
    parts = [p.strip() for p in parts if p and p.strip()]
    if len(parts) >= 2:
        spoken = marker.join(parts)
    else:
        spoken = cleaned
        if comma_pause > 0:
            c_mark = f"<#{_clamp_pause(comma_pause):.2f}#>"
            out: list[str] = []
            count = 0
            for ch in spoken:
                out.append(ch)
                if ch in "，、," and count < 2:
                    out.append(c_mark)
                    count += 1
            spoken = "".join(out)

    prefix = (prosody.get("prefix_tag") or "").strip()
    if prefix and not spoken.startswith(prefix):
        spoken = f"{prefix}{spoken}"

    spoken = re.sub(r"(<#\d+(?:\.\d{1,2})?#>){2,}", r"\1", spoken)
    return spoken.strip()
