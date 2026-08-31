#!/usr/bin/env python3
"""部署「Speech-to-Speech + OpenTalking」数字人组合栈。

各取所长：
- speech-to-speech (HF)：低延迟 VAD→STT→LLM→TTS，OpenAI Realtime WebSocket
- OpenTalking：QuickTalk 实时口型 + WebUI 形象管理 + WebRTC 视频

架构：
  用户麦克风 → S2S(:8765) 负责对话大脑
            → OpenTalking(:5280) QuickTalk 把 TTS 音频驱动口型视频

用法:
  set CLOUD_SSH_PASSWORD=你的密码
  python scripts/deploy_digital_human_stack.py
  python scripts/deploy_digital_human_stack.py --s2s-only   # 只装语音链路（快）
  python scripts/deploy_digital_human_stack.py --ot-only    # 只装 OpenTalking 口型
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
OT_DIR = f"{DH_HOME}/opentalking"
S2S_PORT = int(os.environ.get("S2S_PORT", "8765"))
OT_API_PORT = int(os.environ.get("OPENTALKING_API_PORT", "8210"))
OT_WEB_PORT = int(os.environ.get("OPENTALKING_WEB_PORT", "5280"))
PYTHON = os.environ.get("CLOUD_PYTHON", "/root/miniconda3/bin/python")

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"

# 国内加速：AutoDL 学术加速（GitHub/HF）+ HF 镜像
# 注意：开启 network_turbo 后 pip 清华源反而更慢，S2S 安装时不设 PIP_INDEX_URL
NET_PREFIX = """
if [ -f /etc/network_turbo ]; then source /etc/network_turbo; fi
export HF_ENDPOINT=https://hf-mirror.com
export HUGGINGFACE_HUB_CACHE=/root/autodl-tmp/hf-cache
"""

NET_PREFIX_UV = NET_PREFIX + """
export UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
"""


def run(ssh: paramiko.SSHClient, cmd: str, check: bool = True) -> str:
    print(f"\n$ {cmd[:200]}{'...' if len(cmd) > 200 else ''}")
    _, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    combined = (out + err).strip()
    if combined:
        print(combined[-4000:] if len(combined) > 4000 else combined)
    if check and code != 0:
        raise RuntimeError(f"failed ({code})")
    return combined


def read_local_env() -> dict[str, str]:
    if not ENV_FILE.is_file():
        return {}
    data: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        data[k.strip()] = v.strip()
    return data


def deploy_s2s(ssh: paramiko.SSHClient, env: dict[str, str]) -> None:
    """S2S 走 PyPI，无需 git clone，安装最快。"""
    llm_key = env.get("AGNES_API_KEY", "")
    llm_base = env.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1")
    llm_model = env.get("AGNES_MODEL", "agnes-2.0-flash")

    cmd = f"""
{NET_PREFIX}
set -e
mkdir -p {DH_HOME}/s2s/logs
cd {DH_HOME}/s2s
if [ ! -d .venv ]; then {PYTHON} -m venv .venv; fi
source .venv/bin/activate
pip install -U pip wheel -q
pip install -U "speech-to-speech" -q
cat > start_s2s.sh <<'SH'
#!/bin/bash
set -euo pipefail
cd {DH_HOME}/s2s
source .venv/bin/activate
{NET_PREFIX.strip()}
if [ -f logs/s2s.pid ] && kill -0 "$(cat logs/s2s.pid)" 2>/dev/null; then kill "$(cat logs/s2s.pid)" 2>/dev/null || true; fi
nohup speech-to-speech --mode realtime \\
  --ws_host 0.0.0.0 \\
  --ws_port {S2S_PORT} \\
  --responses_api_base_url "{llm_base}" \\
  --responses_api_api_key "{llm_key}" \\
  --model_name "{llm_model}" \\
  --llm_backend responses-api \\
  >> logs/s2s.log 2>&1 &
echo $! > logs/s2s.pid
SH
chmod +x start_s2s.sh
./start_s2s.sh
sleep 3
echo "S2S ws://0.0.0.0:{S2S_PORT}/v1/realtime"
"""
    run(ssh, cmd, check=False)


def deploy_opentalking(ssh: paramiko.SSHClient, env: dict[str, str], mock: bool) -> None:
    llm_key = env.get("AGNES_API_KEY", "")
    llm_base = env.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1")
    llm_model = env.get("AGNES_MODEL", "agnes-2.0-flash")

    ot_env_lines = [
        f"DIGITAL_HUMAN_HOME={DH_HOME}",
        f"OPENTALKING_HOME={OT_DIR}",
        f"OPENTALKING_MODEL_ROOT={DH_HOME}/models",
        f"OPENTALKING_API_HOST=0.0.0.0",
        f"OPENTALKING_API_PORT={OT_API_PORT}",
        f"OPENTALKING_WEB_HOST=0.0.0.0",
        f"OPENTALKING_WEB_PORT={OT_WEB_PORT}",
        f"VITE_BACKEND_PORT={OT_API_PORT}",
        "OPENTALKING_TTS_DEFAULT_PROVIDER=edge",
        "OPENTALKING_TTS_EDGE_VOICE=zh-CN-YunxiNeural",
        "OPENTALKING_LLM_PROVIDER=openai_compatible",
        f"OPENTALKING_LLM_BASE_URL={llm_base}",
        f"OPENTALKING_LLM_API_KEY={llm_key}",
        f"OPENTALKING_LLM_MODEL={llm_model}",
        "OPENTALKING_TORCH_DEVICE=cuda:0",
        "HF_ENDPOINT=https://hf-mirror.com",
    ]
    if mock:
        ot_env_lines.append("OPENTALKING_DEFAULT_MODEL=mock")
    else:
        ot_env_lines.extend(
            [
                "OPENTALKING_DEFAULT_MODEL=quicktalk",
                "OPENTALKING_QUICKTALK_BACKEND=local",
                f"OPENTALKING_QUICKTALK_ASSET_ROOT={DH_HOME}/models/quicktalk",
                "OPENTALKING_QUICKTALK_DEVICE=cuda:0",
                "OPENTALKING_QUICKTALK_WORKER_CACHE=1",
            ]
        )
    ot_env = "\n".join(ot_env_lines) + "\n"

    if mock:
        start_mode = (
            f"bash scripts/start_unified.sh --mock --api-port {OT_API_PORT} "
            f"--web-port {OT_WEB_PORT} --host 0.0.0.0"
        )
    else:
        start_mode = (
            f"export DIGITAL_HUMAN_HOME={DH_HOME} OPENTALKING_MODEL_ROOT={DH_HOME}/models "
            f"OPENTALKING_TORCH_DEVICE=cuda:0 "
            f"OPENTALKING_QUICKTALK_ASSET_ROOT={DH_HOME}/models/quicktalk "
            f"OPENTALKING_QUICKTALK_WORKER_CACHE=1; "
            f"bash scripts/start_unified.sh --backend local --model quicktalk "
            f"--api-port {OT_API_PORT} --web-port {OT_WEB_PORT} --host 0.0.0.0"
        )

    clone_urls = [
        "https://github.com/datascale-ai/opentalking.git",
        "https://ghproxy.net/https://github.com/datascale-ai/opentalking.git",
    ]
    clone_block = "\n".join(
        [
            f'if GIT_SSL_NO_VERIFY=true git clone --depth 1 "{u}" {OT_DIR} 2>/dev/null; then break; fi'
            for u in clone_urls
        ]
    )

    cmd = f"""
{NET_PREFIX_UV}
set -e
mkdir -p {DH_HOME}/models {DH_HOME}/model-repos
if [ ! -d {OT_DIR}/.git ]; then
  rm -rf {OT_DIR}
  for i in 1 2 3; do
    {clone_block}
    if [ -f {OT_DIR}/pyproject.toml ]; then break; fi
    sleep 5
  done
fi
if [ ! -f {OT_DIR}/pyproject.toml ]; then echo "OpenTalking clone failed"; exit 1; fi
cat > {OT_DIR}/.env <<'ENVEOF'
{ot_env}ENVEOF
cd {OT_DIR}
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
uv sync --extra dev --extra models --python 3.11
cat > start_opentalking.sh <<'SH'
#!/bin/bash
set -euo pipefail
cd {OT_DIR}
mkdir -p logs
if [ -f logs/opentalking.pid ] && kill -0 "$(cat logs/opentalking.pid)" 2>/dev/null; then exit 0; fi
bash scripts/quickstart/stop_all.sh 2>/dev/null || true
source .venv/bin/activate
set -a && source .env && set +a
{NET_PREFIX.strip()}
nohup bash -lc '{start_mode}' >> logs/opentalking.log 2>&1 &
echo $! > logs/opentalking.pid
SH
chmod +x start_opentalking.sh
./start_opentalking.sh
"""
    run(ssh, cmd, check=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--s2s-only", action="store_true", help="只部署 Speech-to-Speech")
    parser.add_argument("--ot-only", action="store_true", help="只部署 OpenTalking")
    parser.add_argument("--mock", action="store_true", help="OpenTalking Mock 模式（无口型权重）")
    args = parser.parse_args()

    if not PASSWORD:
        print("请设置 CLOUD_SSH_PASSWORD", file=sys.stderr)
        return 1

    env = read_local_env()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"连接 {HOST}:{PORT} ...")
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=60)

    run(ssh, "nvidia-smi -L || true", check=False)

    deploy_s2s_flag = not args.ot_only
    deploy_ot_flag = not args.s2s_only

    if deploy_s2s_flag:
        print("\n=== [1/2] Speech-to-Speech（PyPI 安装，对话大脑）===")
        deploy_s2s(ssh, env)

    if deploy_ot_flag:
        print("\n=== [2/2] OpenTalking（QuickTalk 口型视频）===")
        deploy_opentalking(ssh, env, mock=args.mock)

    print("\n=== 部署完成 ===")
    if deploy_s2s_flag:
        print(f"S2S Realtime : ws://<公网IP>:{S2S_PORT}/v1/realtime")
        print(f"  测试: speech-to-speech talk --url ws://127.0.0.1:{S2S_PORT}/v1/realtime")
    if deploy_ot_flag:
        print(f"OpenTalking UI : http://<公网IP>:{OT_WEB_PORT}")
        print("  在 WebUI 选 quicktalk，上传患者正面照/模板视频")

    print("\n组合用法：S2S 负责低延迟语音对话，OpenTalking 负责真口型视频。")
    print("AutoDL 控制台 -> 自定义服务，开放端口:", end=" ")
    ports = []
    if deploy_s2s_flag:
        ports.append(str(S2S_PORT))
    if deploy_ot_flag:
        ports.append(str(OT_WEB_PORT))
    print(", ".join(ports))

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
