#!/usr/bin/env python3
import os
import time
import paramiko

PASSWORD = os.environ.get("CLOUD_SSH_PASSWORD", "")
PY = "/root/miniconda3/bin/python"
MT = "/root/autodl-tmp/MuseTalk"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("connect.westb.seetacloud.com", 16655, "root", PASSWORD, timeout=120)

dl = f"""
cd {MT}
{PY} -m pip install -U "huggingface_hub[cli]" -q
source /etc/network_turbo 2>/dev/null || true

{PY} <<'PY'
from huggingface_hub import snapshot_download, hf_hub_download
import os
os.chdir("{MT}")

print("sd-vae...")
snapshot_download(repo_id="stabilityai/sd-vae-ft-mse", local_dir="models/sd-vae")

print("musetalkV15 unet...")
hf_hub_download(repo_id="TMElyralab/MuseTalk", filename="musetalkV15/unet.pth", local_dir="models")

print("whisper...")
snapshot_download(repo_id="openai/whisper-tiny", local_dir="models/whisper")

print("dwpose...")
try:
    hf_hub_download(repo_id="TMElyralab/MuseTalk", filename="dwpose/dw-ll_ucoco_384.pth", local_dir="models")
except Exception as e:
    print("dwpose skip", e)

print("done")
PY

ls -lh models/sd-vae/ | head -6
ls -lh models/musetalkV15/
du -sh models/sd-vae models/musetalkV15 models/whisper
"""
print("=== download via Python API ===")
_, o, e = ssh.exec_command(dl, get_pty=True)
print((o.read() + e.read()).decode()[-10000:])

_, o, _ = ssh.exec_command(f"pkill -f api_server.py 2>/dev/null; sleep 2; {MT}/run_api.sh && sleep 3 && cat {MT}/logs/musetalk.pid")
print("restart:", o.read().decode())

print("polling health (up to 8 min)...")
for i in range(16):
    time.sleep(30)
    _, o, _ = ssh.exec_command(
        f"curl -s -m 5 http://127.0.0.1:8770/health; echo; "
        f"ps -p $(cat {MT}/logs/musetalk.pid 2>/dev/null) >/dev/null 2>&1 && echo running || echo dead; "
        f"tail -2 {MT}/logs/musetalk.log 2>/dev/null"
    )
    body = o.read().decode()
    print(f"--- {(i+1)*30}s ---", body[:500])
    if '"ok":true' in body.replace(" ", "") or '"ok": true' in body:
        break

_, o, _ = ssh.exec_command(
    "cd /root/autodl-tmp/aisp-datawhale && ./stop.sh 2>/dev/null; ./start.sh; "
    "sleep 2; curl -s http://127.0.0.1:6008/api/voice/status"
)
print("\nAISP:\n", o.read().decode())
ssh.close()
