#!/usr/bin/env python3
"""将 AISP 从旧云迁移到新云，并仅清理旧云上本项目目录。

旧云（weste）只删除：
  - /root/autodl-tmp/aisp-datawhale
  - /root/autodl-tmp/MuseTalk
  - /root/autodl-tmp/linly-talker（若存在）

不触碰 models、shiping_*、video-platform、hf-cache 等其它项目。

用法:
  set CLOUD_SSH_PASSWORD_NEW=xskX7guMPguz
  set CLOUD_SSH_PASSWORD_OLD=lDceMezDApu7   # 可选，默认旧密码
  python scripts/migrate_cloud_aisp.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "/root/autodl-tmp/aisp-datawhale"
MUSETALK = "/root/autodl-tmp/MuseTalk"
LINLY = "/root/autodl-tmp/linly-talker"

OLD_HOST = os.environ.get("CLOUD_SSH_HOST_OLD", "connect.weste.seetacloud.com")
OLD_PORT = int(os.environ.get("CLOUD_SSH_PORT_OLD", "48396"))
NEW_HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westb.seetacloud.com")
NEW_PORT = int(os.environ.get("CLOUD_SSH_PORT", "16655"))
USER = "root"
OLD_PW = os.environ.get("CLOUD_SSH_PASSWORD_OLD", os.environ.get("CLOUD_SSH_PASSWORD", ""))
NEW_PW = os.environ.get("CLOUD_SSH_PASSWORD_NEW", os.environ.get("CLOUD_SSH_PASSWORD", ""))
PYTHON = "/root/miniconda3/bin/python"
APP_PORT = 6008

SYNC_FILES = [
    "server/app/main.py",
    "server/app/config.py",
    "server/app/auth.py",
    "server/app/musetalk.py",
    "server/app/sessions.py",
    "server/app/db.py",
    "server/app/patient_agent.py",
    "server/app/talking_head.py",
    "server/app/minimax_tts.py",
    "web/js/app.js",
    "web/js/voice.js",
    "web/js/digital-human.js",
    "web/js/live2d-loader.js",
    "web/index.html",
    "web/css/main.css",
    "web/live2d/manifest.json",
]


def connect(host: str, port: int, password: str) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, port, USER, password, timeout=120)
    return ssh


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = False) -> str:
    print(f"\n[{ssh.get_transport().getpeername()[0]}] $ {cmd[:140]}")
    _, o, e = ssh.exec_command(cmd, get_pty=True)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out.strip():
        print(out[-4000:] if len(out) > 4000 else out)
    if check and code != 0:
        raise RuntimeError(f"failed ({code}): {cmd}")
    return out


def pull_from_old(old: paramiko.SSHClient, tmp: Path) -> None:
    sftp = old.open_sftp()
    for rel in ("data/sp_training.db", ".env"):
        remote = f"{PROJECT}/{rel}"
        local = tmp / rel.replace("/", "_")
        try:
            sftp.get(remote, str(local))
            print("pulled", rel)
        except OSError as exc:
            print("skip pull", rel, exc)
    sftp.close()


def push_to_new(new: paramiko.SSHClient, tmp: Path) -> None:
    sftp = new.open_sftp()
    run(new, f"mkdir -p {PROJECT}/data {PROJECT}/logs")
    db_local = tmp / "data_sp_training.db"
    if db_local.is_file():
        sftp.put(str(db_local), f"{PROJECT}/data/sp_training.db")
        print("uploaded database")
    env_local = tmp / ".env"
    if env_local.is_file():
        sftp.put(str(env_local), f"{PROJECT}/.env")
        print("uploaded .env from old cloud")
    elif (ROOT / ".env").is_file():
        sftp.put(str(ROOT / ".env"), f"{PROJECT}/.env")
        print("uploaded local .env")
    for rel in SYNC_FILES:
        local = ROOT / rel
        if local.is_file():
            remote = f"{PROJECT}/{rel.replace(chr(92), '/')}"
            parts = remote.rsplit("/", 1)[0]
            try:
                sftp.stat(parts)
            except OSError:
                run(new, f"mkdir -p {parts}", check=False)
            sftp.put(str(local), remote)
    manifest = ROOT / "web/live2d/manifest.json"
    if manifest.is_file():
        static_live2d = f"{PROJECT}/server/app/static/live2d"
        run(new, f"mkdir -p {static_live2d}", check=False)
        sftp.put(str(manifest), f"{static_live2d}/manifest.json")
    portraits_local = ROOT / "web/live2d/portraits"
    if portraits_local.is_dir():
        for base in (f"{PROJECT}/web/live2d/portraits", f"{PROJECT}/server/app/static/live2d/portraits"):
            run(new, f"mkdir -p {base}", check=False)
            for p in portraits_local.glob("*.webp"):
                sftp.put(str(p), f"{base}/{p.name}")
    sftp.close()


def deploy_new(new: paramiko.SSHClient) -> None:
    repo = "https://gitcode.com/hongwei-2026/datawhale_yiliao.git"
    has_git = "yes" in run(new, f"test -d {PROJECT}/.git && echo yes || echo no")
    if not has_git:
        run(new, f"git clone {repo} {PROJECT}")
    run(
        new,
        f"""{PYTHON} <<'PY'
from pathlib import Path
p = Path('{PROJECT}/.env')
lines = p.read_text(encoding='utf-8').splitlines() if p.is_file() else []
out = []
keys = {{'APP_HOST': '0.0.0.0', 'APP_PORT': '{APP_PORT}', 'TALKING_HEAD_ENABLED': 'false',
          'MUSETALK_ENABLED': 'true', 'MUSETALK_BASE_URL': 'http://127.0.0.1:8770'}}
seen = set()
for line in lines:
    k = line.split('=', 1)[0] if '=' in line else ''
    if k in keys:
        out.append(f"{{k}}={{keys[k]}}"); seen.add(k)
    else:
        out.append(line)
for k, v in keys.items():
    if k not in seen:
        out.append(f"{{k}}={{v}}")
p.write_text('\\n'.join(out) + '\\n', encoding='utf-8')
PY""",
    )
    run(
        new,
        f"cd {PROJECT} && {PYTHON} -m venv .venv && . .venv/bin/activate && "
        f"pip install -U pip -q && pip install -r server/requirements.txt -q",
        check=False,
    )
    start = f"""#!/bin/bash
set -euo pipefail
cd {PROJECT}
mkdir -p data logs
if [ -f logs/aisp.pid ] && kill -0 "$(cat logs/aisp.pid)" 2>/dev/null; then exit 0; fi
source .venv/bin/activate
export PYTHONUNBUFFERED=1
nohup python -m uvicorn server.app.main:app --host 0.0.0.0 --port {APP_PORT} >> logs/aisp.log 2>&1 &
echo $! > logs/aisp.pid
sleep 2
echo started pid=$(cat logs/aisp.pid)
"""
    stop = f"""#!/bin/bash
cd {PROJECT}
if [ -f logs/aisp.pid ]; then kill $(cat logs/aisp.pid) 2>/dev/null; rm -f logs/aisp.pid; fi
pkill -f 'uvicorn server.app.main:app.*--port {APP_PORT}' 2>/dev/null || true
"""
    sftp = new.open_sftp()
    for name, body in [("start.sh", start), ("stop.sh", stop)]:
        with sftp.file(f"{PROJECT}/{name}", "w") as f:
            f.write(body)
    sftp.close()
    run(new, f"chmod +x {PROJECT}/start.sh {PROJECT}/stop.sh")
    run(new, f"cd {PROJECT} && ./stop.sh", check=False)
    run(new, f"cd {PROJECT} && ./start.sh", check=False)
    run(new, f"curl -s -m 10 http://127.0.0.1:{APP_PORT}/health", check=False)
    run(new, f"curl -s -m 5 http://127.0.0.1:{APP_PORT}/api/voice/status", check=False)


def cleanup_old(old: paramiko.SSHClient) -> None:
    print("\n=== 清理旧云（仅 AISP 相关）===")
    run(old, f"cd {PROJECT} && ./stop.sh 2>/dev/null; true", check=False)
    run(old, f"pkill -f 'uvicorn server.app.main:app.*--port {APP_PORT}' 2>/dev/null; true", check=False)
    run(old, f"pkill -f '{MUSETALK}/api_server.py' 2>/dev/null; true", check=False)
    for path in (PROJECT, MUSETALK, LINLY):
        run(old, f"test -d {path} && rm -rf {path} && echo removed {path} || echo skip {path}", check=False)
    run(old, "du -sh /root/autodl-tmp/* 2>/dev/null | sort -hr | head -12", check=False)
    run(
        old,
        f"test ! -d {PROJECT} && test ! -d {MUSETALK} && echo cleanup_ok || echo cleanup_incomplete",
        check=False,
    )


def main() -> int:
    if not NEW_PW:
        print("请设置 CLOUD_SSH_PASSWORD_NEW", file=sys.stderr)
        return 1
    tmp = Path(tempfile.mkdtemp(prefix="aisp_migrate_"))
    try:
        print("=== 1. 从旧云拉取数据 ===")
        if OLD_PW:
            old = connect(OLD_HOST, OLD_PORT, OLD_PW)
            pull_from_old(old, tmp)
            old.close()
        else:
            print("未提供旧云密码，跳过拉取")

        print("\n=== 2. 部署到新云 ===")
        new = connect(NEW_HOST, NEW_PORT, NEW_PW)
        run(new, "nvidia-smi -L || true", check=False)
        push_to_new(new, tmp)
        deploy_new(new)
        new.close()

        print("\n=== 3. 清理旧云本项目 ===")
        if OLD_PW:
            old = connect(OLD_HOST, OLD_PORT, OLD_PW)
            cleanup_old(old)
            old.close()

        print("\n=== 迁移完成 ===")
        print(f"新云 SSH: ssh -p {NEW_PORT} {USER}@{NEW_HOST}")
        print(f"新公网（6008）: https://uu865426-848e-3b794105.westb.seetacloud.com:8443/")
        return 0
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
