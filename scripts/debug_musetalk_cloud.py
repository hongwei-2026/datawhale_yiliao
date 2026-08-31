#!/usr/bin/env python3
import os
import paramiko

PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PY = "/root/miniconda3/bin/python"
MT = "/root/autodl-tmp/MuseTalk"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("connect.westb.seetacloud.com", 16655, "root", PASSWORD, timeout=120)

cmds = [
    "ps aux | grep -E 'api_server|musetalk' | grep -v grep",
    f"cd {MT} && {PY} -c \"import sys; sys.path.insert(0,'.'); from musetalk.utils.utils import load_all_model; print('musetalk ok')\" 2>&1",
    f"cd {MT} && MUSETALK_PORTRAITS={MT}/data/persona_portraits timeout 90 {PY} api_server.py --host 127.0.0.1 --port 8770 2>&1 | head -80",
]
for c in cmds:
    print("===", c[:100])
    _, o, e = ssh.exec_command(c, get_pty=True)
    print((o.read() + e.read()).decode("utf-8", errors="replace")[:6000])
ssh.close()
