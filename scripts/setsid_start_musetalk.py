#!/usr/bin/env python3
"""Start MuseTalk detached from SSH session (setsid)."""
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


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, "root", PASSWORD, timeout=120)

    start = f"""
pkill -f 'api_server.py' 2>/dev/null || true
sleep 1
cd {MT}
export MUSETALK_PORTRAITS={MT}/data/persona_portraits
export CUDA_VISIBLE_DEVICES=0
export PATH=/root/miniconda3/envs/musetalk/bin:$PATH
# remove TF so transformers won't pull broken ABI
{PY} -m pip uninstall -y tensorflow tensorboard 2>/dev/null || true
mkdir -p logs api_cache
: > logs/musetalk.log
setsid {PY} api_server.py --host 0.0.0.0 --port 8770 >> logs/musetalk.log 2>&1 < /dev/null &
echo $! > logs/musetalk.pid
sleep 2
echo pid=$(cat logs/musetalk.pid)
ps -p $(cat logs/musetalk.pid) -o pid,etime,cmd || echo DEAD_IMMEDIATE
"""
    _, o, e = ssh.exec_command(start, timeout=120)
    print((o.read() + e.read()).decode("utf-8", errors="replace"), flush=True)

    ready = False
    for i in range(18):
        time.sleep(15)
        _, o, _ = ssh.exec_command(
            f"curl -s -m 5 http://127.0.0.1:8770/health; echo; "
            f"ps -p $(cat {MT}/logs/musetalk.pid) >/dev/null 2>&1 && echo RUNNING || echo DEAD; "
            f"tail -8 {MT}/logs/musetalk.log"
        )
        body = o.read().decode("utf-8", errors="replace")
        print(f"--- {(i+1)*15}s ---\n{body[-2000:]}", flush=True)
        if '"ok":true' in body.replace(" ", ""):
            ready = True
            break
        if "DEAD" in body and i >= 1 and "Waiting for application startup" not in body:
            # allow first minutes for model load; only break if dead early without startup
            if i >= 3:
                break

    flag = "true" if ready else "false"
    _, o, _ = ssh.exec_command(
        f"cd {AISP} && sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED={flag}/' .env && "
        f"grep -q '^MUSETALK_BASE_URL=' .env || echo 'MUSETALK_BASE_URL=http://127.0.0.1:8770' >> .env && "
        f"./stop.sh 2>/dev/null; ./start.sh && sleep 2 && curl -s http://127.0.0.1:6008/api/voice/status"
    )
    print(o.read().decode("utf-8", errors="replace"), flush=True)
    ssh.close()
    print("READY=", ready, flush=True)
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
