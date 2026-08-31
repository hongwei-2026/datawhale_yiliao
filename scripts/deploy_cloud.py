#!/usr/bin/env python3
"""Deploy AISP to SeetaCloud/AutoDL (project-isolated)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

# 新 GPU 实例（2026-08-29 克隆容器）
HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westb.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "16655"))
USER = os.environ.get("CLOUD_SSH_USER", "root")
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

PROJECT_DIR = os.environ.get("CLOUD_PROJECT_DIR", "/root/autodl-tmp/aisp-datawhale")
REPO = os.environ.get("CLOUD_GIT_REPO", "https://gitcode.com/hongwei-2026/datawhale_yiliao.git")
APP_PORT = int(os.environ.get("CLOUD_APP_PORT", "6008"))
PYTHON = os.environ.get("CLOUD_PYTHON", "/root/miniconda3/bin/python")

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = True) -> tuple[int, str, str]:
    print(f"\n$ {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=False)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if check and code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd}")
    return code, out, err


def main() -> None:
    if not PASSWORD:
        print("Set CLOUD_SSH_PASSWORD env var", file=sys.stderr)
        sys.exit(1)
    if not ENV_FILE.is_file():
        print(f"Missing local env file: {ENV_FILE}", file=sys.stderr)
        sys.exit(1)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=60)

    run(ssh, "nvidia-smi -L || true", check=False)

    run(ssh, f"mkdir -p {PROJECT_DIR}")

    _, out, _ = run(ssh, f"test -d {PROJECT_DIR}/.git && echo yes || echo no", check=False)
    if "yes" in out:
        run(ssh, f"cd {PROJECT_DIR} && git fetch origin && git reset --hard origin/main")
    else:
        run(ssh, f"git clone {REPO} {PROJECT_DIR}")

    sftp = ssh.open_sftp()
    sftp.put(str(ENV_FILE), f"{PROJECT_DIR}/.env")
    sftp.close()
    print("Uploaded .env")

    run(
        ssh,
        f"""{PYTHON} <<'PY'
from pathlib import Path
p = Path('{PROJECT_DIR}/.env')
lines = []
for line in p.read_text(encoding='utf-8').splitlines():
    if line.startswith('APP_HOST='):
        lines.append('APP_HOST=0.0.0.0')
    elif line.startswith('APP_PORT='):
        lines.append('APP_PORT={APP_PORT}')
    elif line.startswith('TALKING_HEAD_ENABLED='):
        lines.append('TALKING_HEAD_ENABLED=false')
    else:
        lines.append(line)
if not any(x.startswith('APP_HOST=') for x in lines):
    lines.append('APP_HOST=0.0.0.0')
if not any(x.startswith('APP_PORT=') for x in lines):
    lines.append('APP_PORT={APP_PORT}')
if not any(x.startswith('TALKING_HEAD_ENABLED=') for x in lines):
    lines.append('TALKING_HEAD_ENABLED=false')
p.write_text('\\n'.join(lines) + '\\n', encoding='utf-8')
PY""",
    )

    run(
        ssh,
        f"cd {PROJECT_DIR} && {PYTHON} -m venv .venv && "
        f". .venv/bin/activate && pip install -U pip -q && pip install -r server/requirements.txt -q",
    )

    start_sh = f"""#!/bin/bash
set -euo pipefail
cd {PROJECT_DIR}
mkdir -p data logs
if [ -f logs/aisp.pid ] && kill -0 "$(cat logs/aisp.pid)" 2>/dev/null; then
  echo "AISP already running pid=$(cat logs/aisp.pid)"
  exit 0
fi
source .venv/bin/activate
export PYTHONUNBUFFERED=1
nohup python -m uvicorn server.app.main:app --host 0.0.0.0 --port {APP_PORT} \\
  >> logs/aisp.log 2>&1 &
echo $! > logs/aisp.pid
sleep 2
echo "Started AISP pid=$(cat logs/aisp.pid) port={APP_PORT}"
"""

    stop_sh = f"""#!/bin/bash
set -euo pipefail
cd {PROJECT_DIR}
if [ -f logs/aisp.pid ]; then
  pid=$(cat logs/aisp.pid)
  if kill -0 "$pid" 2>/dev/null; then kill "$pid"; fi
  rm -f logs/aisp.pid
else
  pkill -f 'uvicorn server.app.main:app.*--port {APP_PORT}' 2>/dev/null || true
fi
"""

    status_sh = f"""#!/bin/bash
cd {PROJECT_DIR}
if [ -f logs/aisp.pid ] && kill -0 "$(cat logs/aisp.pid)" 2>/dev/null; then
  echo "running pid=$(cat logs/aisp.pid) port={APP_PORT}"
else
  echo "not running"
fi
curl -s -m 5 http://127.0.0.1:{APP_PORT}/health || true
"""

    for name, content in [("start.sh", start_sh), ("stop.sh", stop_sh), ("status.sh", status_sh)]:
        remote = f"{PROJECT_DIR}/{name}"
        sftp = ssh.open_sftp()
        with sftp.file(remote, "w") as f:
            f.write(content)
        sftp.close()
        run(ssh, f"chmod +x {remote}")

    run(ssh, f"cd {PROJECT_DIR} && ./stop.sh", check=False)
    run(ssh, f"cd {PROJECT_DIR} && ./start.sh")

    _, health, _ = run(ssh, f"curl -s -m 10 http://127.0.0.1:{APP_PORT}/health", check=False)
    print("\n=== Health ===")
    print(health.strip() or "(no response)")

    ssh.close()
    print("\n=== Deploy done ===")
    print(f"SSH : ssh -p {PORT} {USER}@{HOST}")
    print(f"Project: {PROJECT_DIR}")
    print(f"Port  : {APP_PORT} (控制台 -> 自定义服务)")
    print("Next  : python scripts/deploy_opentalking.py  # GPU 实时数字人 (OpenTalking)")


if __name__ == "__main__":
    main()
