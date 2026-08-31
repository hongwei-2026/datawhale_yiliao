#!/usr/bin/env python3
import os
import time
import paramiko

PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PY = "/root/miniconda3/bin/python"
MT = "/root/autodl-tmp/MuseTalk"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("connect.westb.seetacloud.com", 16655, "root", PASSWORD, timeout=120)

start_sh = f"""#!/bin/bash
cd {MT}
export MUSETALK_PORTRAITS={MT}/data/persona_portraits
export MUSETALK_PORT=8770
export CUDA_VISIBLE_DEVICES=0
mkdir -p logs api_cache
pkill -f 'api_server.py' 2>/dev/null || true
sleep 1
: > logs/musetalk.log
nohup {PY} api_server.py --host 0.0.0.0 --port 8770 >> logs/musetalk.log 2>&1 &
echo $! > logs/musetalk.pid
echo started_pid=$(cat logs/musetalk.pid)
"""
sftp = ssh.open_sftp()
with sftp.file(f"{MT}/run_api.sh", "w") as f:
    f.write(start_sh)
sftp.close()

_, o, _ = ssh.exec_command(f"chmod +x {MT}/run_api.sh && {MT}/run_api.sh")
print(o.read().decode())

for sec in [5, 30, 60, 120, 180, 240]:
    time.sleep(5 if sec == 5 else 25)
    _, o, _ = ssh.exec_command(
        f"curl -s -m 5 http://127.0.0.1:8770/health; echo; "
        f"ps -p $(cat {MT}/logs/musetalk.pid 2>/dev/null) -o pid,cmd 2>/dev/null || echo dead; "
        f"tail -3 {MT}/logs/musetalk.log"
    )
    print(f"--- t~{sec}s ---")
    print(o.read().decode())

_, o, _ = ssh.exec_command(
    f"cd /root/autodl-tmp/aisp-datawhale && ./stop.sh 2>/dev/null; ./start.sh; "
    f"sleep 2; curl -s http://127.0.0.1:6008/api/voice/status"
)
print("=== AISP ===")
print(o.read().decode())
ssh.close()
