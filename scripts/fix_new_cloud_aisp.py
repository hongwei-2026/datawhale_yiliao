#!/usr/bin/env python3
"""修复新云上不完整的 AISP 部署。"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = "connect.westb.seetacloud.com"
PORT = 16655
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PROJECT = "/root/autodl-tmp/aisp-datawhale"
PYTHON = "/root/miniconda3/bin/python"
APP_PORT = 6008


def run(ssh, cmd):
    print(f"$ {cmd[:120]}")
    _, o, e = ssh.exec_command(cmd, get_pty=True)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    if out.strip():
        print(out[-3000:])
    return out


def upload_tree(sftp, local: Path, remote: str, skip_dirs=None):
    skip_dirs = skip_dirs or {".git", "__pycache__", ".venv", "node_modules", "data"}
    for item in local.rglob("*"):
        if any(p in item.parts for p in skip_dirs):
            continue
        rel = item.relative_to(local)
        rpath = f"{remote}/{rel.as_posix()}"
        if item.is_dir():
            try:
                sftp.stat(rpath)
            except OSError:
                sftp.mkdir(rpath)
        else:
            parent = "/".join(rpath.split("/")[:-1])
            try:
                sftp.stat(parent)
            except OSError:
                parts = parent.split("/")
                cur = ""
                for p in parts:
                    if not p:
                        continue
                    cur += "/" + p
                    try:
                        sftp.stat(cur)
                    except OSError:
                        sftp.mkdir(cur)
            sftp.put(str(item), rpath)


def main():
    if not PASSWORD:
        sys.exit("需要 CLOUD_SSH_PASSWORD")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, "root", PASSWORD, timeout=120)

    tmp = Path(tempfile.mkdtemp())
    sftp = ssh.open_sftp()
    try:
        sftp.get(f"{PROJECT}/data/sp_training.db", str(tmp / "sp_training.db"))
        print("backed up db")
    except OSError:
        print("no db to backup")
    sftp.close()

    run(ssh, f"cd {PROJECT} && ./stop.sh 2>/dev/null; true")
    sftp = ssh.open_sftp()
    upload_tree(sftp, ROOT / "server", f"{PROJECT}/server")
    for sub in ("js", "css", "data", "avatars"):
        p = ROOT / "web" / sub
        if p.exists():
            upload_tree(sftp, p, f"{PROJECT}/web/{sub}")
    for rel in ("index.html",):
        sftp.put(str(ROOT / "web" / rel), f"{PROJECT}/web/{rel}")
    live2d = ROOT / "web" / "live2d"
    if live2d.is_dir():
        for sub in ("manifest.json", "portraits"):
            p = live2d / sub
            if p.exists():
                if p.is_file():
                    run(ssh, f"mkdir -p {PROJECT}/web/live2d")
                    sftp.put(str(p), f"{PROJECT}/web/live2d/{sub}")
                else:
                    upload_tree(sftp, p, f"{PROJECT}/web/live2d/{sub}")
        run(ssh, f"mkdir -p {PROJECT}/server/app/static/live2d/portraits {PROJECT}/web/live2d/portraits")
        sftp.put(str(live2d / "manifest.json"), f"{PROJECT}/server/app/static/live2d/manifest.json")
        for wp in (live2d / "portraits").glob("*.webp"):
            sftp.put(str(wp), f"{PROJECT}/server/app/static/live2d/portraits/{wp.name}")
            sftp.put(str(wp), f"{PROJECT}/web/live2d/portraits/{wp.name}")
    if (ROOT / ".env").is_file():
        sftp.put(str(ROOT / ".env"), f"{PROJECT}/.env")
    sftp.put(str(tmp / "sp_training.db"), f"{PROJECT}/data/sp_training.db")
    sftp.close()

    run(
        ssh,
        f"cd {PROJECT} && {PYTHON} -m venv .venv && . .venv/bin/activate && "
        f"pip install -U pip -q && pip install -r server/requirements.txt -q",
    )
    run(ssh, f"cd {PROJECT} && ./start.sh")
    run(ssh, f"curl -s http://127.0.0.1:{APP_PORT}/health")
    run(ssh, f"curl -s http://127.0.0.1:{APP_PORT}/api/voice/status")
    ssh.close()
    print("\nOK:", f"https://uu865426-848e-3b794105.westb.seetacloud.com:8443/")


if __name__ == "__main__":
    main()
