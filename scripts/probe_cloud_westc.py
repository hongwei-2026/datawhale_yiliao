#!/usr/bin/env python3
"""Probe new SeetaCloud instance for AISP + MuseTalk + GPU."""
from __future__ import annotations

import os
import paramiko

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westc.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "46150"))
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

CMDS = [
    "nvidia-smi -L; nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader",
    "df -h /root/autodl-tmp | tail -1",
    "ls -la /root/autodl-tmp/ | head -30",
    "test -d /root/autodl-tmp/aisp-datawhale && echo AISP_OK || echo AISP_MISSING",
    "test -d /root/autodl-tmp/MuseTalk && echo MT_OK || echo MT_MISSING",
    "ls -lh /root/autodl-tmp/MuseTalk/models/musetalkV15/unet.pth 2>/dev/null || echo no_unet",
    "du -sh /root/autodl-tmp/MuseTalk/models/* 2>/dev/null | head -20",
    "ss -lntp | grep -E '6008|8770' || echo no_ports",
    "curl -s -m 3 http://127.0.0.1:6008/health || echo aisp_down",
    "curl -s -m 3 http://127.0.0.1:6008/api/voice/status || echo voice_down",
    "curl -s -m 3 http://127.0.0.1:8770/health || echo musetalk_down",
    "ps aux | grep -E 'uvicorn|api_server|start.sh' | grep -v grep | head -10",
]


def main() -> None:
    if not PASSWORD:
        raise SystemExit("Set CLOUD_SSH_PASSWORD")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username="root", password=PASSWORD, timeout=60)
    for cmd in CMDS:
        print(f"\n=== {cmd[:80]} ===")
        _, out, err = ssh.exec_command(cmd, timeout=60)
        body = (out.read() + err.read()).decode("utf-8", errors="replace").strip()
        print(body[:3000] if body else "(empty)")
    ssh.close()


if __name__ == "__main__":
    main()
