#!/usr/bin/env python3
"""Direct-start MuseTalk with full error capture."""
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
PY = "/root/miniconda3/envs/musetalk/bin/python"


def run(ssh, cmd, timeout=120):
    print(f"\n$ {cmd[:160]}", flush=True)
    _, o, e = ssh.exec_command(cmd, get_pty=True, timeout=timeout)
    body = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(body[-4000:] if len(body) > 4000 else body, flush=True)
    return body


def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, "root", PASSWORD, timeout=120)

    # Pin opencv for numpy 1.26; use env python binary directly (no conda activate)
    run(
        ssh,
        f"""
{PY} -c "import numpy,torch,mmcv,mmpose,diffusers; print('ok', numpy.__version__, torch.__version__)"
{PY} -m pip install 'opencv-python-headless==4.9.0.80' -q
pkill -f 'api_server.py' 2>/dev/null || true
sleep 1
cd {MT}
export MUSETALK_PORTRAITS={MT}/data/persona_portraits
export MUSETALK_PORT=8770
export CUDA_VISIBLE_DEVICES=0
export PATH=/root/miniconda3/envs/musetalk/bin:$PATH
mkdir -p logs api_cache
: > logs/musetalk.log
nohup {PY} api_server.py --host 0.0.0.0 --port 8770 >> logs/musetalk.log 2>&1 &
echo $! > logs/musetalk.pid
echo pid=$(cat logs/musetalk.pid)
sleep 3
ps -p $(cat logs/musetalk.pid) -o pid,cmd || echo DEAD
wc -l logs/musetalk.log
head -40 logs/musetalk.log
""",
        timeout=180,
    )

    ready = False
    for i in range(20):
        time.sleep(20)
        body = run(
            ssh,
            f"curl -s -m 5 http://127.0.0.1:8770/health; echo; "
            f"ps -p $(cat {MT}/logs/musetalk.pid 2>/dev/null) >/dev/null 2>&1 && echo RUNNING || echo DEAD; "
            f"tail -20 {MT}/logs/musetalk.log",
        )
        if '"ok":true' in body.replace(" ", ""):
            ready = True
            break
        if "DEAD" in body and i >= 2:
            break

    flag = "true" if ready else "false"
    run(
        ssh,
        f"""
cd {AISP}
grep -q MUSETALK_ENABLED .env && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED={flag}/' .env || echo MUSETALK_ENABLED={flag} >> .env
grep -q MUSETALK_BASE_URL .env && sed -i 's|^MUSETALK_BASE_URL=.*|MUSETALK_BASE_URL=http://127.0.0.1:8770|' .env || echo MUSETALK_BASE_URL=http://127.0.0.1:8770 >> .env
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
