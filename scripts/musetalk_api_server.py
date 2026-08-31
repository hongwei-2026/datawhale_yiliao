#!/usr/bin/env python3
"""MuseTalk 常驻 API：预烘焙受试者肖像，按音频生成口型视频（音画合一）。

在 MuseTalk 仓库根目录运行：
  MUSETALK_PORTRAITS=/path/to/portraits python api_server.py
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))


def _patch_torch_load() -> None:
    """PyTorch 2.6+ defaults weights_only=True; MuseTalk checkpoints need False."""
    import torch

    if getattr(torch.load, "_musetalk_patched", False):
        return
    _orig = torch.load

    def _load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _orig(*args, **kwargs)

    _load._musetalk_patched = True  # type: ignore[attr-defined]
    torch.load = _load  # type: ignore[assignment]


_patch_torch_load()

PERSONA_IDS = [
    "PER-HTN-TAXI-01",
    "PER-ELDER-BASIC-01",
    "PER-ELDER-FEMALE-02",
]

app = FastAPI(title="MuseTalk API", version="1.0")
_state: dict = {"ready": False, "error": "", "avatars": {}}
_jobs: dict[str, dict] = {}


def _portrait_dir() -> Path:
    raw = os.environ.get("MUSETALK_PORTRAITS", "")
    if raw:
        return Path(raw)
    return ROOT / "data" / "persona_portraits"


def _find_portrait(persona_id: str) -> Path | None:
    d = _portrait_dir()
    for ext in (".webp", ".png", ".jpg", ".jpeg"):
        p = d / f"{persona_id}{ext}"
        if p.is_file():
            return p
    return None


def _load_models():
    import torch
    from transformers import WhisperModel

    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.face_parsing import FaceParsing
    from musetalk.utils.utils import load_all_model

    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    version = os.environ.get("MUSETALK_VERSION", "v15")
    unet_config = "./models/musetalkV15/musetalk.json"
    unet_model = "./models/musetalkV15/unet.pth"
    if version == "v1":
        unet_config = "./models/musetalk/musetalk.json"
        unet_model = "./models/musetalk/pytorch_model.bin"

    vae, unet, pe = load_all_model(
        unet_model_path=unet_model,
        vae_type="sd-vae",
        unet_config=unet_config,
        device=device,
    )
    timesteps = torch.tensor([0], device=device)
    pe = pe.half().to(device)
    vae.vae = vae.vae.half().to(device)
    unet.model = unet.model.half().to(device)

    whisper_dir = "./models/whisper"
    audio_processor = AudioProcessor(feature_extractor_path=whisper_dir)
    weight_dtype = unet.model.dtype
    whisper = WhisperModel.from_pretrained(whisper_dir)
    whisper = whisper.to(device=device, dtype=weight_dtype).eval()
    whisper.requires_grad_(False)

    fp = FaceParsing(left_cheek_width=90, right_cheek_width=90) if version == "v15" else FaceParsing()

    return {
        "device": device,
        "version": version,
        "vae": vae,
        "unet": unet,
        "pe": pe,
        "timesteps": timesteps,
        "audio_processor": audio_processor,
        "whisper": whisper,
        "weight_dtype": weight_dtype,
        "fp": fp,
        "batch_size": int(os.environ.get("MUSETALK_BATCH_SIZE", "8")),
        "fps": int(os.environ.get("MUSETALK_FPS", "25")),
        "extra_margin": 10,
        "parsing_mode": "jaw",
    }


def _prepare_avatar(models: dict, persona_id: str, image_path: Path):
    """Import Avatar from realtime_inference after models loaded."""
    from scripts.realtime_inference import Avatar  # noqa: WPS433

    class Args:
        version = models["version"]
        extra_margin = models["extra_margin"]
        parsing_mode = models["parsing_mode"]
        audio_padding_length_left = 2
        audio_padding_length_right = 2
        skip_save_images = False

    import scripts.realtime_inference as ri

    ri.args = Args()
    ri.device = models["device"]
    ri.vae = models["vae"]
    ri.unet = models["unet"]
    ri.pe = models["pe"]
    ri.timesteps = models["timesteps"]
    ri.audio_processor = models["audio_processor"]
    ri.whisper = models["whisper"]
    ri.weight_dtype = models["weight_dtype"]
    ri.fp = models["fp"]

    avatar_id = persona_id.replace("-", "_").lower()
    prep = os.environ.get("MUSETALK_FORCE_PREP", "").lower() in ("1", "true", "yes")
    avatar = Avatar(
        avatar_id=avatar_id,
        video_path=str(image_path),
        bbox_shift=0,
        batch_size=models["batch_size"],
        preparation=prep or not (ROOT / "results" / models["version"] / "avatars" / avatar_id).exists(),
    )
    return avatar


@app.on_event("startup")
def startup() -> None:
    import builtins

    builtins.input = lambda *a, **k: "n"  # noqa: ARG005 — 禁用 MuseTalk 交互提示
    try:
        models = _load_models()
        portraits = _portrait_dir()
        portraits.mkdir(parents=True, exist_ok=True)
        for pid in PERSONA_IDS:
            src = _find_portrait(pid)
            if not src:
                continue
            dst = portraits / f"{pid}.jpg"
            if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
                from PIL import Image

                img = Image.open(src).convert("RGB")
                w, h = img.size
                if min(w, h) < 512:
                    scale = 512 / min(w, h)
                    img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
                img.save(dst, quality=92)
            _state["avatars"][pid] = _prepare_avatar(models, pid, dst)
        _state["models"] = models
        _state["ready"] = bool(_state["avatars"])
        if not _state["ready"]:
            _state["error"] = f"未找到肖像，请设置 MUSETALK_PORTRAITS={portraits}"
    except Exception as exc:
        _state["error"] = str(exc)
        _state["ready"] = False


@app.get("/health")
def health():
    return {
        "ok": _state["ready"],
        "error": _state.get("error") or None,
        "avatars": list(_state.get("avatars", {}).keys()),
        "gpu": os.environ.get("CUDA_VISIBLE_DEVICES", "0"),
    }


def _run_inference(persona_id: str, audio_path: Path) -> Path:
    avatar = _state["avatars"].get(persona_id)
    if not avatar:
        raise HTTPException(404, f"未烘焙肖像: {persona_id}")
    models = _state["models"]
    import scripts.realtime_inference as ri

    ri.args = type("A", (), {
        "version": models["version"],
        "extra_margin": models["extra_margin"],
        "parsing_mode": models["parsing_mode"],
        "audio_padding_length_left": 2,
        "audio_padding_length_right": 2,
        "skip_save_images": False,
    })()
    ri.device = models["device"]
    ri.vae = models["vae"]
    ri.unet = models["unet"]
    ri.pe = models["pe"]
    ri.timesteps = models["timesteps"]
    ri.audio_processor = models["audio_processor"]
    ri.whisper = models["whisper"]
    ri.weight_dtype = models["weight_dtype"]
    ri.fp = models["fp"]

    out_name = hashlib.sha256(audio_path.read_bytes()).hexdigest()[:16]
    avatar.inference(str(audio_path), out_name, models["fps"], False)
    out = Path(avatar.video_out_path) / f"{out_name}.mp4"
    if not out.is_file():
        raise HTTPException(500, "MuseTalk 未生成视频")
    return out


@app.post("/generate")
async def generate(
    persona_id: str = Form(...),
    audio: UploadFile = File(...),
):
    if not _state["ready"]:
        raise HTTPException(503, _state.get("error") or "MuseTalk 未就绪")
    suffix = Path(audio.filename or "audio.mp3").suffix or ".mp3"
    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / f"in{suffix}"
        raw.write_bytes(await audio.read())
        wav = Path(td) / "in.wav"
        os.system(f'ffmpeg -y -loglevel error -i "{raw}" -ar 16000 -ac 1 "{wav}"')
        if not wav.is_file():
            raise HTTPException(400, "音频转码失败")
        t0 = time.time()
        out = _run_inference(persona_id, wav)
        cache_dir = ROOT / "api_cache"
        cache_dir.mkdir(exist_ok=True)
        cached = cache_dir / f"{persona_id}_{out.stem}.mp4"
        shutil.copy2(out, cached)
        return {
            "ok": True,
            "video_path": str(cached),
            "latency_sec": round(time.time() - t0, 2),
        }


@app.get("/video/{name}")
def get_video(name: str):
    path = ROOT / "api_cache" / name
    if not path.is_file() or ".." in name:
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MUSETALK_PORT", "8770")))
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
