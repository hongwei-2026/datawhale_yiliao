#!/usr/bin/env python3
"""Fix numpy/TF conflict and restart MuseTalk."""
from __future__ import annotations

import os
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westc.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "46150"))
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
MT = "/root/autodl-tmp/MuseTalk"
AISP = "/root/autodl-tmp/aisp-datawhale"


def run(ssh, cmd, timeout=300):
    print(f"\n$ {cmd[:140]}", flush=True)
    _, o, e = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
    body = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(body[-3500:] if len(body) > 3500 else body, flush=True)
    return body


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, "root", PASSWORD, timeout=120)

    # MuseTalk inference path uses torch; TF from requirements.txt breaks numpy ABI
    run(
        ssh,
        f"""
source /root/miniconda3/etc/profile.d/conda.sh
conda activate musetalk
pip uninstall -y tensorflow tensorboard 2>/dev/null || true
pip install 'numpy==1.26.4' -q
python -c "import numpy,torch,mmcv,mmpose,diffusers,transformers; print('IMPORT_OK', numpy.__version__, torch.__version__)"
pkill -f api_server.py 2>/dev/null || true
sleep 2
cd {MT} && ./run_api.sh
""",
        timeout=180,
    )

    ready = False
    for i in range(16):
        time.sleep(15)
        body = run(ssh, "curl -s -m 5 http://127.0.0.1:8770/health; echo; tail -5 /root/autodl-tmp/MuseTalk/logs/musetalk.log")
        if '"ok":true' in body.replace(" ", ""):
            ready = True
            break
        if "No module named" in body or "_ARRAY_API" in body:
            if i >= 3:
                break

    flag = "true" if ready else "false"
    run(
        ssh,
        f"""
cd {AISP}
sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED={flag}/' .env
./stop.sh 2>/dev/null; ./start.sh
sleep 2
curl -s http://127.0.0.1:6008/api/voice/status
""",
    )
    ssh.close()
    print("READY=", ready, flush=True)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
