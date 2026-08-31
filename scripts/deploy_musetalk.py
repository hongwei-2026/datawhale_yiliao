#!/usr/bin/env python3
"""在 SeetaCloud GPU 上部署 MuseTalk API（真口型，音画合一）。

用法:
  set CLOUD_SSH_PASSWORD=...
  python scripts/deploy_musetalk.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("CLOUD_SSH_HOST", "connect.weste.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "48396"))
USER = os.environ.get("CLOUD_SSH_USER", "root")
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PYTHON = os.environ.get("CLOUD_PYTHON", "/root/miniconda3/bin/python")

MUSETALK_DIR = "/root/autodl-tmp/MuseTalk"
AISP_DIR = "/root/autodl-tmp/aisp-datawhale"
MUSETALK_PORT = int(os.environ.get("MUSETALK_PORT", "8770"))
REPO = "https://github.com/TMElyralab/MuseTalk.git"


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = False) -> str:
    print(f"\n$ {cmd[:200]}{'...' if len(cmd) > 200 else ''}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    combined = (out + err).strip()
    if combined:
        print(combined[-8000:])
    if check and code != 0:
        raise RuntimeError(f"failed ({code})")
    return combined


def main() -> int:
    if not PASSWORD:
        print("请设置 CLOUD_SSH_PASSWORD", file=sys.stderr)
        return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=120)

    run(ssh, "nvidia-smi -L || true")
    run(ssh, "source /etc/network_turbo 2>/dev/null; echo network_turbo_ok", check=False)

    run(ssh, f"mkdir -p {MUSETALK_DIR}")
    has_git = "yes" in run(ssh, f"test -d {MUSETALK_DIR}/.git && echo yes || echo no")
    if has_git:
        run(ssh, f"cd {MUSETALK_DIR} && git pull --ff-only || true", check=False)
    else:
        run(ssh, f"git clone --depth 1 {REPO} {MUSETALK_DIR}", check=False)

    install = f"""
set -e
cd {MUSETALK_DIR}
source /etc/network_turbo 2>/dev/null || true
if [ ! -d .venv ]; then {PYTHON} -m venv .venv; fi
source .venv/bin/activate
pip install -U pip wheel -q
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 -q
pip install -r requirements.txt -q
pip install fastapi uvicorn python-multipart pillow -q
if [ ! -f models/musetalkV15/unet.pth ]; then
  bash download_weights.sh || python scripts/download_weights.py || true
fi
apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null || true
"""
    run(ssh, install, check=False)

    sftp = ssh.open_sftp()
    api_local = ROOT / "scripts" / "musetalk_api_server.py"
    sftp.put(str(api_local), f"{MUSETALK_DIR}/api_server.py")
    portraits_remote = f"{MUSETALK_DIR}/data/persona_portraits"
    run(ssh, f"mkdir -p {portraits_remote}")
    for p in (ROOT / "web" / "live2d" / "portraits").glob("*.webp"):
        sftp.put(str(p), f"{portraits_remote}/{p.name}")
    sftp.close()

    start_sh = f"""#!/bin/bash
set -euo pipefail
cd {MUSETALK_DIR}
source .venv/bin/activate
export MUSETALK_PORTRAITS={portraits_remote}
export MUSETALK_PORT={MUSETALK_PORT}
export CUDA_VISIBLE_DEVICES=0
mkdir -p logs api_cache
if [ -f logs/musetalk.pid ] && kill -0 "$(cat logs/musetalk.pid)" 2>/dev/null; then
  kill "$(cat logs/musetalk.pid)" 2>/dev/null || true
  sleep 2
fi
nohup python api_server.py --host 0.0.0.0 --port {MUSETALK_PORT} >> logs/musetalk.log 2>&1 &
echo $! > logs/musetalk.pid
echo "MuseTalk API pid=$(cat logs/musetalk.pid) port={MUSETALK_PORT}"
"""
    remote_start = f"{MUSETALK_DIR}/start_musetalk.sh"
    sftp = ssh.open_sftp()
    with sftp.file(remote_start, "w") as f:
        f.write(start_sh)
    sftp.close()
    run(ssh, f"chmod +x {remote_start}")

    # 首次启动会烘焙肖像（约 2–5 分钟），后台跑
    run(ssh, f"cd {MUSETALK_DIR} && ./start_musetalk.sh", check=False)

    # 更新 AISP 配置
    env_patch = f"""
cd {AISP_DIR}
grep -q '^MUSETALK_ENABLED=' .env 2>/dev/null && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED=true/' .env || echo 'MUSETALK_ENABLED=true' >> .env
grep -q '^MUSETALK_BASE_URL=' .env 2>/dev/null && sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:{MUSETALK_PORT}|' .env || echo 'MUSETALK_BASE_URL=http://127.0.0.1:{MUSETALK_PORT}' >> .env
grep -q '^TALKING_HEAD_ENABLED=' .env 2>/dev/null && sed -i 's/^TALKING_HEAD_ENABLED=.*/TALKING_HEAD_ENABLED=false/' .env || echo 'TALKING_HEAD_ENABLED=false' >> .env
./stop.sh 2>/dev/null; ./start.sh
sleep 3
curl -s http://127.0.0.1:6008/api/voice/status | head -c 500
echo
curl -s http://127.0.0.1:{MUSETALK_PORT}/health | head -c 300
"""
    run(ssh, env_patch, check=False)

    # 上传 AISP 后端/前端
    sync_files = [
        "server/app/musetalk.py",
        "server/app/config.py",
        "server/app/main.py",
        "web/js/voice.js",
        "web/js/app.js",
        "web/js/digital-human.js",
        "web/index.html",
    ]
    sftp = ssh.open_sftp()
    for rel in sync_files:
        local = ROOT / rel
        if local.is_file():
            sftp.put(str(local), f"{AISP_DIR}/{rel.replace(chr(92), '/')}")
            print("uploaded", rel)
    sftp.close()
    run(ssh, f"cd {AISP_DIR} && ./stop.sh 2>/dev/null; ./start.sh && sleep 2 && curl -s http://127.0.0.1:6008/api/voice/status", check=False)

    print("\n=== MuseTalk 部署完成 ===")
    print(f"MuseTalk API: http://127.0.0.1:{MUSETALK_PORT}/health")
    print(f"日志: tail -f {MUSETALK_DIR}/logs/musetalk.log")
    print("首次烘焙肖像需 2–5 分钟，就绪后 /api/voice/status 中 musetalk.ready=true")

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
