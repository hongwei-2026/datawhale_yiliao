#!/usr/bin/env python3
"""Finish mmpose install and start MuseTalk on westc."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

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
    body = (out.read() + err.read()).decode("utf-8", errors="replace")
    print(body[-4000:] if len(body) > 4000 else body, flush=True)
    return body


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username="root", password=PASSWORD, timeout=120)

    body = run(
        ssh,
        """
set -e
source /root/miniconda3/etc/profile.d/conda.sh
conda activate musetalk
python -c "import torch,mmcv; print('base', torch.__version__, mmcv.__version__, torch.cuda.is_available())"
pip install -U 'setuptools<70' wheel pip -q
# chumpy is ancient; disable build isolation
pip install chumpy --no-build-isolation -q || pip install git+https://github.com/mattloper/chumpy.git --no-build-isolation -q
pip install mmpose==1.3.2 --no-build-isolation -q
python -c "import torch,mmcv,mmpose; print('DEPS_OK', torch.__version__, mmcv.__version__, mmpose.__version__, torch.cuda.is_available())"
""",
        timeout=900,
    )
    if "DEPS_OK" not in body:
        print("FAILED", flush=True)
        ssh.close()
        return 2

    sftp = ssh.open_sftp()
    sftp.put(str(ROOT / "scripts/musetalk_api_server.py"), f"{MT}/api_server.py")
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
    with sftp.file(f"{MT}/run_api.sh", "w") as f:
        f.write(run_api)
    sftp.close()
    run(ssh, f"chmod +x {MT}/run_api.sh && {MT}/run_api.sh")

    ready = False
    for i in range(24):
        time.sleep(15)
        last = run(
            ssh,
            "curl -s -m 5 http://127.0.0.1:8770/health; echo; tail -15 /root/autodl-tmp/MuseTalk/logs/musetalk.log",
        )
        if '"ok":true' in last.replace(" ", ""):
            ready = True
            break
        if ("No module named" in last or "Error" in last) and '"ok":false' in last.replace(" ", "") and i >= 4:
            # still loading vs hard fail — if error field set and process alive, keep waiting a bit
            if "Waiting for application startup" in last:
                continue
            if i >= 8:
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
curl -s http://127.0.0.1:6008/health; echo
curl -s http://127.0.0.1:6008/api/voice/status
""",
    )
    ssh.close()
    print("DONE ready=", ready, flush=True)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
