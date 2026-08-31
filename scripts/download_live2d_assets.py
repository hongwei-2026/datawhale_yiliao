"""下载 Live2D 运行库与官方示例模型（Mark 男 / Hiyori 女 / Natori 男）。"""

from __future__ import annotations

import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE2D = ROOT / "web" / "live2d"
GITHUB_TREE = "https://api.github.com/repos/Live2D/CubismWebSamples/git/trees/master?recursive=1"
CDN = "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@master"
HARU_CDN = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/haru"

CUBISM_CORE_URL = "https://cdn.jsdelivr.net/npm/live2dcubismcore@1.0.2/live2dcubismcore.min.js"
PIXI_URL = "https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js"
CUBISM4_PLUGIN_URL = "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js"

CHARACTERS = ("Mark", "Hiyori", "Natori")


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  {dest.relative_to(ROOT)}")
    urllib.request.urlretrieve(url, dest)


def download_character(name: str) -> None:
    tree = json.load(urllib.request.urlopen(GITHUB_TREE))
    prefix = f"Samples/Resources/{name}/"
    files = [t["path"] for t in tree["tree"] if t["path"].startswith(prefix) and t["type"] == "blob"]
    dest_root = LIVE2D / "models" / name.lower()
    for path in files:
        rel = path[len(prefix):]
        fetch(f"{CDN}/{path}", dest_root / rel)


def main() -> None:
    lib_dir = LIVE2D / "lib"
    fetch(CUBISM_CORE_URL, lib_dir / "live2dcubismcore.min.js")
    fetch(PIXI_URL, lib_dir / "pixi.min.js")
    fetch(CUBISM4_PLUGIN_URL, lib_dir / "cubism4.min.js")

    for name in CHARACTERS:
        print(f"Downloading {name}...")
        download_character(name)

    manifest = {
        "version": 3,
        "models": {
            "mark": {
                "path": "/live2d/models/mark/Mark.model3.json",
                "label": "Mark（官方·成年男性）",
                "gender": "male",
                "kScale": 0.16,
                "reserveBottom": 0.34,
                "anchorX": 0.5,
                "anchorY": 1,
                "initialXshift": 0,
                "initialYshift": 24,
                "idleMotionGroupName": "Idle",
                "emotionMap": {"neutral": None, "thinking": None, "speaking": None},
            },
            "natori": {
                "path": "/live2d/models/natori/Natori.model3.json",
                "label": "Natori（官方·男性）",
                "gender": "male",
                "kScale": 0.14,
                "reserveBottom": 0.36,
                "anchorX": 0.5,
                "anchorY": 1,
                "initialXshift": 0,
                "initialYshift": 18,
                "idleMotionGroupName": "Idle",
                "emotionMap": {"neutral": "Normal", "thinking": "Sad", "speaking": "Smile"},
            },
            "hiyori": {
                "path": "/live2d/models/hiyori/Hiyori.model3.json",
                "label": "Hiyori（官方·女性）",
                "gender": "female",
                "kScale": 0.15,
                "reserveBottom": 0.34,
                "anchorX": 0.5,
                "anchorY": 1,
                "initialXshift": 0,
                "initialYshift": 28,
                "idleMotionGroupName": "Idle",
                "emotionMap": {"neutral": None, "thinking": None, "speaking": None},
            },
        },
        "persona_map": {
            "PER-HTN-TAXI-01": "mark",
            "PER-ELDER-BASIC-01": "natori",
            "PER-ELDER-FEMALE-02": "hiyori",
            "default": "mark",
        },
        "backgrounds": {
            "PER-HTN-TAXI-01": "/live2d/backgrounds/PER-HTN-TAXI-01.webp",
            "PER-ELDER-BASIC-01": "/live2d/backgrounds/PER-ELDER-BASIC-01.webp",
            "PER-ELDER-FEMALE-02": "/live2d/backgrounds/PER-ELDER-FEMALE-02.webp",
            "default": "/live2d/backgrounds/clinic-default.webp",
        },
    }
    manifest_path = LIVE2D / "manifest.json"
    if manifest_path.is_file():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            if existing.get("backgrounds"):
                manifest["backgrounds"].update(existing["backgrounds"])
        except Exception:
            pass
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {manifest_path.relative_to(ROOT)}")

    static_live2d = ROOT / "server" / "app" / "static" / "live2d"
    if static_live2d.exists():
        shutil.rmtree(static_live2d)
    shutil.copytree(LIVE2D, static_live2d)
    print(f"Mirrored to {static_live2d.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
