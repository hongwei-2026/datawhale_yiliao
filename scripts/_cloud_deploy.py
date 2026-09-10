#!/usr/bin/env python3
"""One-shot: pack local AISP, replace remote aisp-datawhale, start on :6008."""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time
from pathlib import Path

import paramiko

HOST = "connect.westc.seetacloud.com"
PORT = 46150
USER = "root"
PASSWORD = os.environ.get("AISP_SSH_PASS", "kBzO16USFxOk")
REMOTE_DIR = "/root/autodl-tmp/aisp-datawhale"
LOCAL_ROOT = Path(__file__).resolve().parents[1]
APP_PORT = 6008

EXCLUDE_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    ".cursor",
    "musetalk-models",
    "MuseTalk",
    "agent-transcripts",
    "_extracted",
}
EXCLUDE_SUFFIXES = {".pyc", ".pyo", ".log"}
EXCLUDE_NAME_PARTS = {"manifest.json.bak"}


def should_skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = set(rel.parts)
    if parts & EXCLUDE_DIR_NAMES:
        return True
    if path.suffix.lower() in EXCLUDE_SUFFIXES:
        return True
    if path.name in EXCLUDE_NAME_PARTS:
        return True
    # skip huge binary dumps under data/
    if "musetalk-models" in rel.parts:
        return True
    return False


def make_tarball() -> bytes:
    buf = io.BytesIO()
    count = 0
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
        for dirpath, dirnames, filenames in os.walk(LOCAL_ROOT):
            p = Path(dirpath)
            # prune excluded dirs in-place
            dirnames[:] = [
                d
                for d in dirnames
                if d not in EXCLUDE_DIR_NAMES and not should_skip(p / d, LOCAL_ROOT)
            ]
            for name in filenames:
                fp = p / name
                if should_skip(fp, LOCAL_ROOT):
                    continue
                arc = fp.relative_to(LOCAL_ROOT).as_posix()
                tar.add(fp, arcname=arc, recursive=False)
                count += 1
    data = buf.getvalue()
    print(f"packed {count} files, {len(data) / 1e6:.1f} MB gzip")
    return data


def ssh_connect() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("STDERR:", err.rstrip()[:3000])
    print(f"=> exit {code}")
    return code, out, err


def main() -> int:
    print("LOCAL_ROOT", LOCAL_ROOT)
    blob = make_tarball()

    c = ssh_connect()
    try:
        # stop old service
        run(
            c,
            f"bash {REMOTE_DIR}/stop.sh 2>/dev/null || true; "
            f"pkill -f 'uvicorn server.app.main:app' 2>/dev/null || true; "
            f"sleep 1; echo stopped",
        )

        # wipe old project (keep MuseTalk sibling)
        run(
            c,
            f"rm -rf {REMOTE_DIR} && mkdir -p {REMOTE_DIR} data logs && "
            f"mkdir -p {REMOTE_DIR}/logs",
        )

        # upload tarball
        remote_tar = "/tmp/aisp-deploy.tgz"
        print(f"uploading to {remote_tar} ...")
        sftp = c.open_sftp()
        with sftp.file(remote_tar, "wb") as rf:
            rf.write(blob)
        sftp.close()
        print("upload done")

        code, _, _ = run(
            c,
            f"tar -xzf {remote_tar} -C {REMOTE_DIR} && rm -f {remote_tar} && "
            f"ls -la {REMOTE_DIR} | head -30 && du -sh {REMOTE_DIR}",
            timeout=300,
        )
        if code != 0:
            return code

        # ensure .env present (from local pack); force MuseTalk off for video demo stability
        run(
            c,
            f"cd {REMOTE_DIR} && "
            f"test -f .env || cp .env.example .env; "
            f"grep -q '^MUSETALK_ENABLED=' .env && "
            f"sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED=false/' .env || "
            f"echo 'MUSETALK_ENABLED=false' >> .env; "
            f"grep -q '^TALKING_HEAD_ENABLED=' .env && "
            f"sed -i 's/^TALKING_HEAD_ENABLED=.*/TALKING_HEAD_ENABLED=false/' .env || "
            f"echo 'TALKING_HEAD_ENABLED=false' >> .env; "
            f"mkdir -p data logs",
        )

        # venv + deps
        code, _, _ = run(
            c,
            f"cd {REMOTE_DIR} && "
            f"/root/miniconda3/bin/python -m venv .venv && "
            f"source .venv/bin/activate && "
            f"pip install -U pip -q && "
            f"pip install -r server/requirements.txt -q && "
            f"python -c 'import fastapi,uvicorn; print(\"ok\", fastapi.__version__)'",
            timeout=600,
        )
        if code != 0:
            return code

        # start scripts
        start_sh = f"""#!/bin/bash
set -euo pipefail
cd {REMOTE_DIR}
mkdir -p data logs
if [ -f logs/aisp.pid ] && kill -0 "$(cat logs/aisp.pid)" 2>/dev/null; then
  echo already running pid=$(cat logs/aisp.pid); exit 0
fi
source .venv/bin/activate
export PYTHONUNBUFFERED=1
nohup python -m uvicorn server.app.main:app --host 0.0.0.0 --port {APP_PORT} >> logs/aisp.log 2>&1 &
echo $! > logs/aisp.pid
sleep 2
echo started pid=$(cat logs/aisp.pid)
"""
        stop_sh = f"""#!/bin/bash
cd {REMOTE_DIR}
if [ -f logs/aisp.pid ]; then kill $(cat logs/aisp.pid) 2>/dev/null; rm -f logs/aisp.pid; fi
pkill -f 'uvicorn server.app.main:app.*--port {APP_PORT}' 2>/dev/null || true
"""
        sftp = c.open_sftp()
        with sftp.file(f"{REMOTE_DIR}/start.sh", "w") as f:
            f.write(start_sh)
        with sftp.file(f"{REMOTE_DIR}/stop.sh", "w") as f:
            f.write(stop_sh)
        sftp.chmod(f"{REMOTE_DIR}/start.sh", 0o755)
        sftp.chmod(f"{REMOTE_DIR}/stop.sh", 0o755)
        sftp.close()

        run(c, f"bash {REMOTE_DIR}/start.sh")
        time.sleep(2)
        run(
            c,
            f"sleep 2; "
            f"curl -sS -m 10 http://127.0.0.1:{APP_PORT}/health || true; echo; "
            f"curl -sS -m 10 -o /dev/null -w 'HTTP %{{http_code}}\\n' http://127.0.0.1:{APP_PORT}/; "
            f"tail -n 40 {REMOTE_DIR}/logs/aisp.log || true; "
            f"ps aux | grep uvicorn | grep -v grep || true",
        )
        print("\nDONE. AutoDL custom service port should map to", APP_PORT)
        print("Open the instance's 自定义服务 / port", APP_PORT, "URL in AutoDL console.")
        return 0
    finally:
        c.close()


if __name__ == "__main__":
    sys.exit(main())
