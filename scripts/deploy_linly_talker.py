#!/usr/bin/env python3
"""在 SeetaCloud GPU 上部署 Linly-Talker（MuseTalk 实时口型数字人）。

说明：
- HuggingFace speech-to-speech 是「语音 Agent」(VAD→STT→LLM→TTS)，**没有脸部视频**。
- 真正「会说话的脸」需要 MuseTalk / Wav2Lip / Linly-Talker 等 GPU 项目。
- 本脚本在云端克隆 Kedreamix/Linly-Talker 并启动 Gradio WebUI（默认 7860）。

用法（本地）：
  set CLOUD_SSH_PASSWORD=你的密码
  python scripts/deploy_linly_talker.py
"""

from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.weste.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "48396"))
USER = os.environ.get("CLOUD_SSH_USER", "root")
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PYTHON = os.environ.get("CLOUD_PYTHON", "/root/miniconda3/bin/python")

LINLY_DIR = "/root/autodl-tmp/linly-talker"
LINLY_REPO = "https://github.com/Kedreamix/Linly-Talker.git"
WEBUI_PORT = int(os.environ.get("LINLY_WEBUI_PORT", "7860"))


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = True) -> str:
    print(f"\n$ {cmd}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    combined = (out + err).strip()
    if combined:
        print(combined)
    if check and code != 0:
        raise RuntimeError(f"failed ({code}): {cmd}")
    return combined


def main() -> int:
    if not PASSWORD:
        print("请设置环境变量 CLOUD_SSH_PASSWORD", file=sys.stderr)
        return 1

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=120)

    run(ssh, "nvidia-smi -L || true", check=False)

    run(ssh, f"mkdir -p {LINLY_DIR}")
    _, out, _ = ssh.exec_command(f"test -d {LINLY_DIR}/.git && echo yes || echo no")
    has_git = "yes" in out.read().decode()
    if has_git:
        run(ssh, f"cd {LINLY_DIR} && git pull --ff-only || true", check=False)
    else:
        run(ssh, f"git clone --depth 1 {LINLY_REPO} {LINLY_DIR}")

    # 依赖安装（首次较慢，约 10–20 分钟）
    install_cmd = f"""
set -e
cd {LINLY_DIR}
if [ ! -d .venv ]; then {PYTHON} -m venv .venv; fi
source .venv/bin/activate
pip install -U pip wheel -q
if [ -f requirements_webui.txt ]; then
  pip install -r requirements_webui.txt -q
elif [ -f requirements.txt ]; then
  pip install -r requirements.txt -q
fi
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 -q || true
"""
    run(ssh, install_cmd, check=False)

    start_sh = f"""#!/bin/bash
set -euo pipefail
cd {LINLY_DIR}
source .venv/bin/activate
mkdir -p logs
if [ -f logs/linly.pid ] && kill -0 "$(cat logs/linly.pid)" 2>/dev/null; then
  echo "Linly-Talker already running pid=$(cat logs/linly.pid)"
  exit 0
fi
# WebUI：实时 MuseTalk 对话（具体入口以仓库 webui.py / app.py 为准）
ENTRY=""
for f in webui.py app.py WebUI.py; do
  if [ -f "$f" ]; then ENTRY="$f"; break; fi
done
if [ -z "$ENTRY" ]; then
  echo "未找到 WebUI 入口，请手动进入 {LINLY_DIR} 查看 README"
  exit 1
fi
export CUDA_VISIBLE_DEVICES=0
nohup python "$ENTRY" --server_name 0.0.0.0 --server_port {WEBUI_PORT} \\
  >> logs/linly.log 2>&1 &
echo $! > logs/linly.pid
sleep 3
echo "Linly-Talker WebUI pid=$(cat logs/linly.pid) port={WEBUI_PORT}"
"""

    remote_start = f"{LINLY_DIR}/start_linly.sh"
    sftp = ssh.open_sftp()
    with sftp.file(remote_start, "w") as f:
        f.write(start_sh)
    sftp.close()
    run(ssh, f"chmod +x {remote_start}")
    run(ssh, f"cd {LINLY_DIR} && ./start_linly.sh", check=False)

    print("\n=== Linly-Talker 部署已触发 ===")
    print(f"目录: {LINLY_DIR}")
    print(f"WebUI 端口: {WEBUI_PORT}（在 AutoDL 控制台 -> 自定义服务 添加）")
    print(f"日志: ssh -p {PORT} {USER}@{HOST} 'tail -f {LINLY_DIR}/logs/linly.log'")
    print("\n在 WebUI 中选择「实时 MuseTalk 对话」，上传受试者正面照即可看到真口型。")

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
