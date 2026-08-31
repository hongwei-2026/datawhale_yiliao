#!/usr/bin/env python3
"""本地下载 MuseTalk 权重，可选上传到 SeetaCloud。

用法:
  set HTTP_PROXY=http://127.0.0.1:7890
  set HTTPS_PROXY=http://127.0.0.1:7890
  python scripts/download_musetalk_weights_local.py
  python scripts/download_musetalk_weights_local.py --upload
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "data" / "musetalk-models"
REMOTE_MT = "/root/autodl-tmp/MuseTalk"
REMOTE_HOST = os.environ.get("CLOUD_SSH_HOST", "connect.westb.seetacloud.com")
REMOTE_PORT = int(os.environ.get("CLOUD_SSH_PORT", "16655"))


def _need(pkg: str) -> None:
    try:
        __import__(pkg.replace("-", "_").split("[")[0])
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])


def download_all(models_dir: Path) -> None:
    _need("huggingface_hub")
    from huggingface_hub import hf_hub_download, snapshot_download

    models_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(models_dir)

    print("==> sd-vae (~335 MB)")
    snapshot_download(
        repo_id="stabilityai/sd-vae-ft-mse",
        local_dir=str(models_dir / "sd-vae"),
    )

    print("==> musetalkV15 unet.pth (~3.4 GB)")
    hf_hub_download(
        repo_id="TMElyralab/MuseTalk",
        filename="musetalkV15/unet.pth",
        local_dir=str(models_dir),
    )
    hf_hub_download(
        repo_id="TMElyralab/MuseTalk",
        filename="musetalkV15/musetalk.json",
        local_dir=str(models_dir),
    )

    print("==> whisper-tiny (~150 MB)")
    snapshot_download(
        repo_id="openai/whisper-tiny",
        local_dir=str(models_dir / "whisper"),
    )

    print("==> dwpose (~200 MB)")
    hf_hub_download(
        repo_id="yzd-v/DWPose",
        filename="dw-ll_ucoco_384.pth",
        local_dir=str(models_dir / "dwpose"),
    )

    print("==> face-parse-bisent")
    fp_dir = models_dir / "face-parse-bisent"
    fp_dir.mkdir(parents=True, exist_ok=True)
    resnet = fp_dir / "resnet18-5c106cde.pth"
    if not resnet.is_file() or resnet.stat().st_size < 1_000_000:
        import urllib.request

        print("    resnet18...")
        urllib.request.urlretrieve(
            "https://download.pytorch.org/models/resnet18-5c106cde.pth",
            resnet,
        )
    iter_pth = fp_dir / "79999_iter.pth"
    if not iter_pth.is_file() or iter_pth.stat().st_size < 1_000_000:
        _need("gdown")
        import gdown

        print("    79999_iter.pth (Google Drive)...")
        gdown.download(
            id="154JgKpzCPW82qINcVieuPH3fZ2e0P812",
            output=str(iter_pth),
            quiet=False,
        )

    print("\n==> 校验")
    checks = [
        models_dir / "sd-vae" / "diffusion_pytorch_model.bin",
        models_dir / "musetalkV15" / "unet.pth",
        models_dir / "musetalkV15" / "musetalk.json",
        models_dir / "whisper" / "config.json",
        models_dir / "dwpose" / "dw-ll_ucoco_384.pth",
        fp_dir / "79999_iter.pth",
        fp_dir / "resnet18-5c106cde.pth",
    ]
    ok = True
    for p in checks:
        if p.is_file():
            mb = p.stat().st_size / (1024 * 1024)
            print(f"  OK  {p.relative_to(models_dir)}  ({mb:.1f} MB)")
        else:
            print(f"  MISSING  {p.relative_to(models_dir)}")
            ok = False
    if not ok:
        raise SystemExit("部分文件缺失，请重试")
    total = sum(f.stat().st_size for f in models_dir.rglob("*") if f.is_file())
    print(f"\n全部完成，共 {total / (1024**3):.2f} GB -> {models_dir}")


def pack_and_upload(models_dir: Path) -> None:
    password = os.environ.get("CLOUD_SSH_PASSWORD", "")
    if not password:
        raise SystemExit("上传需设置 CLOUD_SSH_PASSWORD")

    _need("paramiko")
    import paramiko

    print("\n==> 打包...")
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        archive = Path(tmp.name)
    with tarfile.open(archive, "w:gz") as tar:
        for p in models_dir.rglob("*"):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(models_dir)).replace("\\", "/"))

    size_gb = archive.stat().st_size / (1024**3)
    print(f"    压缩包 {size_gb:.2f} GB")

    print(f"==> 上传到 {REMOTE_HOST}:{REMOTE_PORT} ...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(REMOTE_HOST, port=REMOTE_PORT, username="root", password=password, timeout=120)
    sftp = ssh.open_sftp()
    remote_archive = f"{REMOTE_MT}/musetalk-models.tar.gz"
    sftp.put(str(archive), remote_archive)
    sftp.close()
    archive.unlink(missing_ok=True)

    print("==> 云端解压并启动 MuseTalk ...")
    cmd = f"""
set -e
cd {REMOTE_MT}
mkdir -p models
tar -xzf musetalk-models.tar.gz -C models
rm -f musetalk-models.tar.gz
du -sh models/sd-vae models/musetalkV15 models/whisper models/dwpose models/face-parse-bisent 2>/dev/null || true
pkill -f 'api_server.py' 2>/dev/null || true
sleep 2
if [ -x run_api.sh ]; then ./run_api.sh; elif [ -f start_musetalk.sh ]; then ./start_musetalk.sh; else
  source .venv/bin/activate 2>/dev/null || true
  mkdir -p logs
  nohup python api_server.py --host 0.0.0.0 --port 8770 >> logs/musetalk.log 2>&1 &
  echo $! > logs/musetalk.pid
fi
sleep 5
curl -s -m 10 http://127.0.0.1:8770/health || tail -30 logs/musetalk.log
"""
    _, out, err = ssh.exec_command(cmd, get_pty=True)
    print((out.read() + err.read()).decode()[-8000:])
    ssh.close()
    print("\n上传完成。若 health 为 ok，可在 .env 设 MUSETALK_ENABLED=true 并重启 AISP。")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true", help="下载完成后上传到云端")
    parser.add_argument("--upload-only", action="store_true", help="仅上传已有本地权重")
    args = parser.parse_args()

    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if proxy:
        print(f"代理: {proxy}")
    else:
        print("提示: 未检测到 HTTP_PROXY/HTTPS_PROXY，若下载慢请设置代理")

    if not args.upload_only:
        download_all(MODELS_DIR)
    elif not MODELS_DIR.is_dir():
        raise SystemExit(f"本地目录不存在: {MODELS_DIR}")

    if args.upload or args.upload_only:
        pack_and_upload(MODELS_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
