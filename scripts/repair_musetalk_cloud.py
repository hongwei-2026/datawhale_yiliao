#!/usr/bin/env python3
"""清理磁盘并用 conda Python 重装 MuseTalk（不重复下载 torch）。"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westb.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "16655"))
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PYTHON = "/root/miniconda3/bin/python"
MUSETALK_DIR = "/root/autodl-tmp/MuseTalk"
AISP_DIR = "/root/autodl-tmp/aisp-datawhale"
PORT_MT = 8770


def run(ssh, cmd: str) -> str:
    print(f"\n$ {cmd[:160]}")
    _, o, e = ssh.exec_command(cmd, get_pty=True)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out[-6000:] if len(out) > 6000 else out)
    return out


def main() -> int:
    if not PASSWORD:
        print("需要 CLOUD_SSH_PASSWORD", file=sys.stderr)
        return 1
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, "root", PASSWORD, timeout=120)

    run(ssh, "df -h /root/autodl-tmp")
    run(ssh, "rm -rf /root/autodl-tmp/MuseTalk")
    run(ssh, f"{PYTHON} -m pip cache purge 2>/dev/null; rm -rf /root/.cache/pip 2>/dev/null; true")
    run(ssh, "df -h /root/autodl-tmp")

    run(ssh, f"git clone --depth 1 https://github.com/TMElyralab/MuseTalk.git {MUSETALK_DIR}")

    install = f"""
cd {MUSETALK_DIR}
{PYTHON} -m pip install -U pip wheel -q
{PYTHON} -m pip install -r requirements.txt -q 2>&1 | tail -5
{PYTHON} -m pip install fastapi uvicorn python-multipart pillow omegaconf -q
apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null || true
bash download_weights.sh 2>&1 | tail -20 || true
"""
    run(ssh, install)

    sftp = ssh.open_sftp()
    sftp.put(str(ROOT / "scripts" / "musetalk_api_server.py"), f"{MUSETALK_DIR}/api_server.py")
    portraits = f"{MUSETALK_DIR}/data/persona_portraits"
    run(ssh, f"mkdir -p {portraits}")
    for p in (ROOT / "web" / "live2d" / "portraits").glob("*.webp"):
        sftp.put(str(p), f"{portraits}/{p.name}")
    sftp.close()

    start = f"""#!/bin/bash
set -euo pipefail
cd {MUSETALK_DIR}
export MUSETALK_PORTRAITS={portraits}
export MUSETALK_PORT={PORT_MT}
export CUDA_VISIBLE_DEVICES=0
mkdir -p logs api_cache
pkill -f 'api_server.py' 2>/dev/null || true
sleep 1
nohup {PYTHON} api_server.py --host 0.0.0.0 --port {PORT_MT} >> logs/musetalk.log 2>&1 &
echo $! > logs/musetalk.pid
sleep 5
curl -s http://127.0.0.1:{PORT_MT}/health || tail -20 logs/musetalk.log
"""
    sftp = ssh.open_sftp()
    with sftp.file(f"{MUSETALK_DIR}/start_musetalk.sh", "w") as f:
        f.write(start)
    sftp.close()
    run(ssh, f"chmod +x {MUSETALK_DIR}/start_musetalk.sh && cd {MUSETALK_DIR} && ./start_musetalk.sh")

    run(ssh, f"""cd {AISP_DIR} && (
grep -q '^MUSETALK_ENABLED=' .env && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED=true/' .env || echo MUSETALK_ENABLED=true >> .env
) && (
grep -q '^MUSETALK_BASE_URL=' .env && sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:{PORT_MT}|' .env || echo MUSETALK_BASE_URL=http://127.0.0.1:{PORT_MT} >> .env
) && ./stop.sh 2>/dev/null; ./start.sh && sleep 2 && curl -s http://127.0.0.1:6008/api/voice/status""")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
