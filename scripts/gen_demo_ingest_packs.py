# -*- coding: utf-8 -*-
"""Generate all three admin-ingest demo packs + a single zip for video recording."""
from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "web" / "data" / "samples"
BUNDLE = SAMPLES / "AISP-三路径导入演示包.zip"


def main() -> None:
    # regenerate material zip first
    from gen_sample_material_zip import main as gen_material

    gen_material()

    files = [
        SAMPLES / "README.md",
        SAMPLES / "sample-rough-liudashan-htn-followup.txt",
        SAMPLES / "sample-material-zhouminghua-icf-with-junk.zip",
        SAMPLES / "sample-human-chenmeiling-followup.txt",
    ]
    missing = [p for p in files if not p.exists()]
    if missing:
        raise SystemExit(f"missing: {missing}")

    with zipfile.ZipFile(BUNDLE, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            zf.write(p, p.name)
    print("wrote", BUNDLE)
    print("size", BUNDLE.stat().st_size)
    with zipfile.ZipFile(BUNDLE) as zf:
        for n in zf.namelist():
            print(" -", n)


if __name__ == "__main__":
    main()
