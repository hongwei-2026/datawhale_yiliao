#!/usr/bin/env python3
"""Upload 3D avatar assets to cloud AISP."""
from __future__ import annotations

import os
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/root/autodl-tmp/aisp-datawhale"
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

FILES = [
    "web/js/avatar3d.js",
    "web/js/digital-human.js",
    "web/live2d/manifest.json",
    "web/css/main.css",
    "web/live2d/portraits/PER-HTN-TAXI-01.webp",
    "web/live2d/portraits/PER-ELDER-BASIC-01.webp",
    "web/live2d/portraits/PER-ELDER-FEMALE-02.webp",
]


def main() -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("CLOUD_SSH_HOST", "connect.weste.seetacloud.com"),
        port=int(os.environ.get("CLOUD_SSH_PORT", "48396")),
        username="root",
        password=PASSWORD,
        timeout=60,
    )
    sftp = ssh.open_sftp()
    for rel in FILES:
        local = ROOT / rel
        remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        if not local.is_file():
            print("skip", rel)
            continue
        sftp.put(str(local), remote)
        print("ok", rel)

    manifest = ROOT / "web/live2d/manifest.json"
    sftp.put(str(manifest), f"{REMOTE}/server/app/static/live2d/manifest.json")
    for p in (ROOT / "web/live2d/portraits").glob("*.webp"):
        for base in (
            f"{REMOTE}/server/app/static/live2d/portraits",
            f"{REMOTE}/web/live2d/portraits",
        ):
            sftp.put(str(p), f"{base}/{p.name}")

    sftp.close()
    _, out, _ = ssh.exec_command(f"cd {REMOTE} && ./stop.sh && ./start.sh && curl -s http://127.0.0.1:6008/health")
    print(out.read().decode())
    ssh.close()


if __name__ == "__main__":
    main()
