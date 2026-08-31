#!/usr/bin/env python3
"""Bootstrap MuseTalk on westc GPU: py3.10 env + mmcv/mmpose + start services."""
from __future__ import annotations

import os
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westc.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "46150"))
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
MT = "/root/autodl-tmp/MuseTalk"
AISP = "/root/autodl-tmp/aisp-datawhale"
ROOT = Path(__file__).resolve().parents[1]


def run(ssh: paramiko.SSHClient, cmd: str, timeout: int = 600) -> str:
    print(f"\n$ {cmd[:180]}{'...' if len(cmd) > 180 else ''}")
    _, out, err = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
    body = (out.read() + err.read()).decode("utf-8", errors="replace")
    print(body[-5000:] if len(body) > 5000 else body)
    return body


def main() -> int:
    if not PASSWORD:
        print("Set CLOUD_SSH_PASSWORD")
        return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username="root", password=PASSWORD, timeout=120)

    # 1) Start AISP first (product usable even without MuseTalk)
    run(
        ssh,
        f"cd {AISP} && ./stop.sh 2>/dev/null; ./start.sh && sleep 2 && curl -s http://127.0.0.1:6008/health",
        timeout=60,
    )

    # 2) Ensure api_server patch is latest
    sftp = ssh.open_sftp()
    sftp.put(str(ROOT / "scripts/musetalk_api_server.py"), f"{MT}/api_server.py")
    sftp.close()
    print("uploaded api_server.py")

    # 3) Create Python 3.10 conda env for MuseTalk (mmcv/mmpose need <=3.11 ideally)
    setup = f"""
set -e
source /etc/network_turbo 2>/dev/null || true
source /root/miniconda3/etc/profile.d/conda.sh

if ! conda env list | grep -q '^musetalk '; then
  conda create -y -n musetalk python=3.10
fi
conda activate musetalk
python -V
pip install -U pip wheel setuptools -q

# torch cu12
python -c "import torch; print(torch.__version__, torch.cuda.is_available())" 2>/dev/null || \
  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

cd {MT}
pip install -r requirements.txt -q 2>&1 | tail -20 || true
pip install fastapi uvicorn python-multipart pillow omegaconf -q

# mmcv / mmpose via openmim
pip install -U openmim -q
mim install mmengine -y
mim install "mmcv==2.1.0" -y
pip install "mmpose==1.3.2" -q

python -c "import torch, mmcv, mmpose; print('ok', torch.__version__, mmcv.__version__, mmpose.__version__, torch.cuda.is_available())"
"""
    run(ssh, setup, timeout=1800)

    # 4) Rewrite run_api.sh to use musetalk conda env
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
    run(ssh, f"chmod +x {MT}/run_api.sh && {MT}/run_api.sh", timeout=30)

    # 5) Poll MuseTalk health (model load can take minutes)
    ready = False
    for i in range(24):
        time.sleep(15)
        body = run(ssh, "curl -s -m 5 http://127.0.0.1:8770/health; echo; tail -5 /root/autodl-tmp/MuseTalk/logs/musetalk.log", timeout=30)
        if '"ok": true' in body or '"ok":true' in body.replace(" ", ""):
            ready = True
            break
        if "No module named" in body or "ModuleNotFoundError" in body:
            print("dependency still missing, stop polling early")
            break

    # 6) Enable MuseTalk in AISP if ready, else keep false
    flag = "true" if ready else "false"
    run(
        ssh,
        f"""
cd {AISP}
grep -q '^MUSETALK_ENABLED=' .env && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED={flag}/' .env || echo 'MUSETALK_ENABLED={flag}' >> .env
grep -q '^MUSETALK_BASE_URL=' .env && sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:8770|' .env || echo 'MUSETALK_BASE_URL=http://127.0.0.1:8770' >> .env
./stop.sh 2>/dev/null; ./start.sh
sleep 2
curl -s http://127.0.0.1:6008/health
echo
curl -s http://127.0.0.1:6008/api/voice/status
""",
        timeout=60,
    )

    ssh.close()
    print("\nDONE ready=", ready)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
