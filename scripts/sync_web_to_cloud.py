#!/usr/bin/env python3
"""Upload critical web JS/CSS to cloud AISP and restart."""
from __future__ import annotations

import os
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/root/autodl-tmp/aisp-datawhale"
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

FILES = [
    "web/js/app.js",
    "web/js/voice.js",
    "web/js/digital-human.js",
    "web/js/live2d-loader.js",
    "web/index.html",
    "web/css/main.css",
    "web/live2d/manifest.json",
    "server/app/config.py",
    "server/app/main.py",
    "server/app/musetalk.py",
]


def main() -> None:
    if not PASSWORD:
        raise SystemExit("Set CLOUD_SSH_PASSWORD")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("CLOUD_SSH_HOST", "connect.westb.seetacloud.com"),
        port=int(os.environ.get("CLOUD_SSH_PORT", "16655")),
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
    if manifest.is_file():
        sftp.put(str(manifest), f"{REMOTE}/server/app/static/live2d/manifest.json")

    sftp.close()
    _, out, err = ssh.exec_command(
        f"cd {REMOTE} && "
        "(grep -q '^MUSETALK_ENABLED=' .env 2>/dev/null && "
        "sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED=true/' .env || "
        "echo 'MUSETALK_ENABLED=true' >> .env) && "
        "(grep -q '^MUSETALK_BASE_URL=' .env 2>/dev/null && "
        "sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:8770|' .env || "
        "echo 'MUSETALK_BASE_URL=http://127.0.0.1:8770' >> .env) && "
        "(grep -q '^TALKING_HEAD_ENABLED=' .env 2>/dev/null && "
        "sed -i 's/^TALKING_HEAD_ENABLED=.*/TALKING_HEAD_ENABLED=false/' .env || "
        "echo 'TALKING_HEAD_ENABLED=false' >> .env) && "
        "./stop.sh 2>/dev/null; ./start.sh && sleep 2 && curl -s http://127.0.0.1:6008/health && "
        "curl -s http://127.0.0.1:6008/api/voice/status"
    )
    print(out.read().decode())
    e = err.read().decode()
    if e:
        print(e)
    ssh.close()


if __name__ == "__main__":
    main()
