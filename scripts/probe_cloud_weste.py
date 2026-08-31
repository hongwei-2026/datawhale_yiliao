#!/usr/bin/env python3
import os
import paramiko

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.weste.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "48396"))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username="root", password=os.environ["CLOUD_SSH_PASSWORD"], timeout=60)

cmds = [
    "hostname",
    "ss -lntp",
    "curl -s -m 5 http://127.0.0.1:6008/health",
    "cd /root/autodl-tmp/aisp-datawhale && ./status.sh",
    "tail -20 /root/autodl-tmp/aisp-datawhale/logs/aisp.log 2>/dev/null || echo no_log",
    "ls -la /init 2>/dev/null | head -20",
    "grep -r seetacloud /init 2>/dev/null | head -10",
    "python3 -c \"import sqlite3; c=sqlite3.connect('/root/autodl-tmp/.autodl/autopanel.security.db'); print(c.execute('select name from sqlite_master').fetchall())\" 2>/dev/null || echo no_db",
]
for c in cmds:
    print(f"\n=== {c} ===")
    _, stdout, stderr = ssh.exec_command(c)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print((out + err)[:5000])

ssh.close()
