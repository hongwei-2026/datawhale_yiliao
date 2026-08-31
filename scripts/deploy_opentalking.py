#!/usr/bin/env python3
"""在 SeetaCloud GPU 上部署 OpenTalking 实时数字人。

OpenTalking: https://github.com/datascale-ai/opentalking
RTX 4080 推荐: --backend local --model quicktalk

用法:
  set CLOUD_SSH_PASSWORD=你的密码
  python scripts/deploy_opentalking.py              # QuickTalk 真口型
  python scripts/deploy_opentalking.py --mock       # 仅验证链路，无需模型权重
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("CLOUD_SSH_HOST", "connect.weste.seetacloud.com")
PORT = int(os.environ.get("CLOUD_SSH_PORT", "48396"))
USER = os.environ.get("CLOUD_SSH_USER", "root")
PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")

DH_HOME = os.environ.get("DIGITAL_HUMAN_HOME", "/root/autodl-tmp/digital-human")
OT_DIR = os.environ.get("OPENTALKING_DIR", f"{DH_HOME}/opentalking")
OT_REPO = os.environ.get(
    "OPENTALKING_REPO", "https://github.com/datascale-ai/opentalking.git"
)
OT_REPO_MIRRORS = [
    OT_REPO,
    "https://ghproxy.net/https://github.com/datascale-ai/opentalking.git",
    "https://mirror.ghproxy.com/https://github.com/datascale-ai/opentalking.git",
    "https://gitclone.com/github.com/datascale-ai/opentalking.git",
]
API_PORT = int(os.environ.get("OPENTALKING_API_PORT", "8210"))
WEB_PORT = int(os.environ.get("OPENTALKING_WEB_PORT", "5280"))

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"


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


def read_local_env() -> dict[str, str]:
    if not ENV_FILE.is_file():
        return {}
    data: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        data[key.strip()] = value.strip()
    return data


def build_opentalking_env(local: dict[str, str], mock: bool) -> str:
    llm_key = local.get("AGNES_API_KEY") or local.get("OPENTALKING_LLM_API_KEY", "")
    llm_base = local.get("AGNES_BASE_URL") or local.get(
        "OPENTALKING_LLM_BASE_URL", "https://apihub.agnes-ai.com/v1"
    )
    llm_model = local.get("AGNES_MODEL") or local.get(
        "OPENTALKING_LLM_MODEL", "agnes-2.0-flash"
    )
    dash_key = local.get("DASHSCOPE_API_KEY", "")

    lines = [
        f"DIGITAL_HUMAN_HOME={DH_HOME}",
        f"OPENTALKING_HOME={OT_DIR}",
        f"OPENTALKING_MODEL_ROOT={DH_HOME}/models",
        f"OPENTALKING_MODEL_REPO_ROOT={DH_HOME}/model-repos",
        f"OPENTALKING_RUNTIME_ROOT={DH_HOME}/runtimes",
        "OPENTALKING_API_HOST=0.0.0.0",
        f"OPENTALKING_API_PORT={API_PORT}",
        "OPENTALKING_WEB_HOST=0.0.0.0",
        f"OPENTALKING_WEB_PORT={WEB_PORT}",
        f"VITE_BACKEND_PORT={API_PORT}",
        "OPENTALKING_TTS_DEFAULT_PROVIDER=edge",
        "OPENTALKING_TTS_EDGE_VOICE=zh-CN-XiaoxiaoNeural",
        "OPENTALKING_LLM_PROVIDER=openai_compatible",
        f"OPENTALKING_LLM_BASE_URL={llm_base}",
        f"OPENTALKING_LLM_API_KEY={llm_key}",
        f"OPENTALKING_LLM_MODEL={llm_model}",
        "OPENTALKING_LLM_SYSTEM_PROMPT=你是一位友善的数字人患者，用简洁口语化的中文回答。",
        "OPENTALKING_TORCH_DEVICE=cuda:0",
        "HF_ENDPOINT=https://hf-mirror.com",
        "HUGGINGFACE_HUB_CACHE=/root/autodl-tmp/digital-human/hf-cache",
    ]
    if dash_key:
        lines.extend(
            [
                "OPENTALKING_STT_DEFAULT_PROVIDER=dashscope",
                f"OPENTALKING_STT_DASHSCOPE_API_KEY={dash_key}",
            ]
        )
    if mock:
        lines.append("OPENTALKING_DEFAULT_MODEL=mock")
    else:
        lines.extend(
            [
                "OPENTALKING_DEFAULT_MODEL=quicktalk",
                "OPENTALKING_QUICKTALK_BACKEND=local",
                f"OPENTALKING_QUICKTALK_ASSET_ROOT={DH_HOME}/models/quicktalk",
                "OPENTALKING_QUICKTALK_DEVICE=cuda:0",
                "OPENTALKING_QUICKTALK_WORKER_CACHE=1",
            ]
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy OpenTalking to SeetaCloud GPU")
    parser.add_argument("--mock", action="store_true", help="Mock mode, no GPU weights")
    args = parser.parse_args()

    if not PASSWORD:
        print("请设置环境变量 CLOUD_SSH_PASSWORD", file=sys.stderr)
        return 1

    local_env = read_local_env()
    ot_env = build_opentalking_env(local_env, args.mock)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=180)

    run(ssh, "nvidia-smi -L || true", check=False)
    run(ssh, f"mkdir -p {DH_HOME}/models {DH_HOME}/model-repos {DH_HOME}/runtimes")

    _, out, _ = ssh.exec_command(f"test -d {OT_DIR}/.git && echo yes || echo no")
    has_git = "yes" in out.read().decode()
    if has_git:
        run(ssh, f"cd {OT_DIR} && git pull --ff-only || true", check=False)
    else:
        cloned = False
        for repo_url in OT_REPO_MIRRORS:
            try:
                run(
                    ssh,
                    f"rm -rf {OT_DIR} && git clone --depth 1 {repo_url} {OT_DIR}",
                    check=True,
                )
                cloned = True
                break
            except RuntimeError:
                print(f"clone failed: {repo_url}")
        if not cloned:
            raise RuntimeError("all OpenTalking git mirrors failed")

    sftp = ssh.open_sftp()
    with sftp.file(f"{OT_DIR}/.env", "w") as remote_env:
        remote_env.write(ot_env)
    sftp.close()
    print(f"Wrote {OT_DIR}/.env")

    install_cmd = f"""
set -e
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
cd {OT_DIR}
uv sync --extra dev --extra models --python 3.11
"""
    run(ssh, install_cmd, check=False)

    if args.mock:
        start_mode = (
            f"bash scripts/start_unified.sh --mock --api-port {API_PORT} "
            f"--web-port {WEB_PORT} --host 0.0.0.0"
        )
    else:
        start_mode = (
            f"export DIGITAL_HUMAN_HOME={DH_HOME} "
            f"OPENTALKING_MODEL_ROOT={DH_HOME}/models "
            f"OPENTALKING_TORCH_DEVICE=cuda:0 "
            f"OPENTALKING_QUICKTALK_ASSET_ROOT={DH_HOME}/models/quicktalk "
            f"OPENTALKING_QUICKTALK_WORKER_CACHE=1; "
            f"bash scripts/start_unified.sh --backend local --model quicktalk "
            f"--api-port {API_PORT} --web-port {WEB_PORT} --host 0.0.0.0"
        )

    start_sh = f"""#!/bin/bash
set -euo pipefail
cd {OT_DIR}
mkdir -p logs
if [ -f logs/opentalking.pid ]; then
  old=$(cat logs/opentalking.pid)
  if kill -0 "$old" 2>/dev/null; then
    echo "OpenTalking already running pid=$old"
    exit 0
  fi
fi
bash scripts/quickstart/stop_all.sh 2>/dev/null || true
source .venv/bin/activate
set -a && source .env && set +a
nohup bash -lc '{start_mode}' >> logs/opentalking.log 2>&1 &
echo $! > logs/opentalking.pid
sleep 8
echo "OpenTalking pid=$(cat logs/opentalking.pid) api={API_PORT} web={WEB_PORT}"
"""

    remote_start = f"{OT_DIR}/start_opentalking.sh"
    sftp = ssh.open_sftp()
    with sftp.file(remote_start, "w") as remote_script:
        remote_script.write(start_sh)
    sftp.close()
    run(ssh, f"chmod +x {remote_start}")
    run(ssh, f"cd {OT_DIR} && ./start_opentalking.sh", check=False)

    run(ssh, f"tail -n 30 {OT_DIR}/logs/opentalking.log 2>/dev/null || true", check=False)

    print("\n=== OpenTalking 部署已触发 ===")
    print(f"目录: {OT_DIR}")
    print(f"WebUI 端口: {WEB_PORT}（AutoDL 控制台 -> 自定义服务）")
    print(f"API  端口: {API_PORT}")
    print(f"日志: ssh -p {PORT} {USER}@{HOST} 'tail -f {OT_DIR}/logs/opentalking.log'")
    if args.mock:
        print("\nMock 模式：无需下载 QuickTalk 权重，可在 WebUI 验证 LLM/TTS/WebRTC 链路。")
    else:
        print("\nQuickTalk 模式：首次启动会自动下载模型权重，约 5-15 分钟。")
        print("在 WebUI 选择 quicktalk 驱动，上传患者正面照或模板视频即可实时口型。")

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
