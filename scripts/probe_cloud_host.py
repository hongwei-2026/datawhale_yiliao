#!/usr/bin/env python3
"""探测云主机目录，仅列出 autodl-tmp 下内容。"""
from __future__ import annotations

import os
import sys

import paramiko

HOST = sys.argv[1] if len(sys.argv) > 1 else ""
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 22
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

AISP_MARKERS = (
    "aisp-datawhale",
    "MuseTalk",
    "digital-human",
    "linly-talker",
    "opentalking",
)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, "root", PASSWORD, timeout=60)

cmds = [
    "hostname",
    "nvidia-smi -L 2>/dev/null || echo no_gpu",
    "df -h / /root/autodl-tmp 2>/dev/null",
    "du -sh /root/autodl-tmp/* 2>/dev/null | sort -hr | head -20",
    "ss -lntp 2>/dev/null | grep -E '6008|8770|7860' || netstat -lntp 2>/dev/null | grep -E '6008|8770|7860' || echo no_listeners",
    f"test -d /root/autodl-tmp/aisp-datawhale && cat /root/autodl-tmp/aisp-datawhale/logs/aisp.pid 2>/dev/null && curl -s -m 3 http://127.0.0.1:6008/health || echo aisp_down",
    "grep -r seetacloud /init/others/help 2>/dev/null | head -5",
]
for c in cmds:
    print(f"\n=== [{HOST}:{PORT}] {c} ===")
    _, o, e = ssh.exec_command(c)
    print((o.read() + e.read()).decode("utf-8", errors="replace")[:4000])

print("\n=== AISP 相关目录 ===")
_, o, _ = ssh.exec_command("ls -la /root/autodl-tmp/ 2>/dev/null")
for line in o.read().decode().splitlines():
    name = line.split()[-1] if line.split() else ""
    if any(m.lower() in name.lower() for m in AISP_MARKERS):
        print(line)

ssh.close()
