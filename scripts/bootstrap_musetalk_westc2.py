#!/usr/bin/env python3
"""Continue MuseTalk setup on westc; safe for Windows console encoding."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

# Avoid Windows GBK crash on conda unicode progress bars
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westc.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "46150"))
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
MT = "/root/autodl-tmp/MuseTalk"
AISP = "/root/autodl-tmp/aisp-datawhale"
ROOT = Path(__file__).resolve().parents[1]


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 600) -> str:
    print(f"\n$ {cmd[:160]}", flush=True)
    _, out, err = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
    raw = out.read() + err.read()
    body = raw.decode("utf-8", errors="replace")
    print(body[-4000:] if len(body) > 4000 else body, flush=True)
    return body


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {HOST}:{PORT}", flush=True)
    ssh.connect(HOST, port=PORT, username="root", password=PASSWORD, timeout=120)

    # Status
    run(ssh, "curl -s -m 3 http://127.0.0.1:6008/health || echo aisp_down")
    run(ssh, "source /root/miniconda3/etc/profile.d/conda.sh && conda env list | grep musetalk || echo no_env")

    # Ensure AISP up
    run(
        ssh,
        f"cd {AISP} && (curl -s -m 2 http://127.0.0.1:6008/health >/dev/null || (./stop.sh 2>/dev/null; ./start.sh && sleep 2)) && curl -s http://127.0.0.1:6008/health",
        timeout=60,
    )

    sftp = ssh.open_sftp()
    sftp.put(str(ROOT / "scripts/musetalk_api_server.py"), f"{MT}/api_server.py")
    sftp.close()

    setup = f"""
set -e
source /etc/network_turbo 2>/dev/null || true
source /root/miniconda3/etc/profile.d/conda.sh
conda env list | grep -q '^musetalk ' || conda create -y -n musetalk python=3.10
conda activate musetalk
python -V
python -c "import torch; print('torch', torch.__version__, torch.cuda.is_available())" 2>/dev/null || \
  pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu124
cd {MT}
pip install -U pip wheel 'setuptools<70' -q
pip install fastapi uvicorn python-multipart pillow omegaconf einops opencv-python-headless soundfile librosa imageio imageio-ffmpeg moviepy ffmpeg-python gdown requests diffusers==0.30.2 accelerate==0.28.0 transformers==4.39.2 huggingface_hub==0.30.2 -q
pip install -U openmim -q
mim install mmengine -y
mim install "mmcv==2.1.0" -y
pip install "mmpose==1.3.2" -q
python -c "import torch,mmcv,mmpose; print('DEPS_OK', torch.__version__, mmcv.__version__, mmpose.__version__, torch.cuda.is_available())"
"""
    body = run(ssh, setup, timeout=2400)
    if "DEPS_OK" not in body:
        print("DEPS install failed", flush=True)
        ssh.close()
        return 2

    run_api = f"""#!/bin/bash
set -euo pipefail
cd {MT}
source /root/miniconda3/etc/profile.d/conda.sh
conda activate musetalk
export MUSETALK_PORTRAITS={MT}/data/persona_portraits
export MUSETALK_PORT=8770
export CUDA_VISIBLE_DEVICES=0
mkdir -p logs api_cache
pkill -f 'api_server.py' 2>/dev/null || true
sleep 1
: > logs/musetalk.log
nohup python api_server.py --host 0.0.0.0 --port 8770 >> logs/musetalk.log 2>&1 &
echo $! > logs/musetalk.pid
echo started_pid=$(cat logs/musetalk.pid)
"""
    sftp = ssh.open_sftp()
    with sftp.file(f"{MT}/run_api.sh", "w") as f:
        f.write(run_api)
    sftp.close()
    run(ssh, f"chmod +x {MT}/run_api.sh && {MT}/run_api.sh")

    ready = False
    for i in range(20):
        time.sleep(15)
        body = run(
            ssh,
            "curl -s -m 5 http://127.0.0.1:8770/health; echo; tail -8 /root/autodl-tmp/MuseTalk/logs/musetalk.log",
        )
        compact = body.replace(" ", "")
        if '"ok":true' in compact:
            ready = True
            break
        if "No module named" in body and i >= 2:
            break

    flag = "true" if ready else "false"
    run(
        ssh,
        f"""
cd {AISP}
grep -q '^MUSETALK_ENABLED=' .env && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED={flag}/' .env || echo 'MUSETALK_ENABLED={flag}' >> .env
grep -q '^MUSETALK_BASE_URL=' .env && sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:8770|' .env || echo 'MUSETALK_BASE_URL=http://127.0.0.1:8770' >> .env
./stop.sh 2>/dev/null; ./start.sh
sleep 2
curl -s http://127.0.0.1:6008/api/voice/status
""",
        timeout=60,
    )
    ssh.close()
    print("DONE ready=", ready, flush=True)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
