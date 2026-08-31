"""用 MiniMax Image-01 生成诊室背景与受试者半身像。



说明：

- MiniMax 可生成 2D 场景/肖像参考图，不能生成可直接使用的 Live2D 模型（需 Cubism 工程）。

- 背景保存到 web/live2d/backgrounds/；肖像保存到 web/live2d/portraits/（.webp）。

- 需要 .env 中配置 MINIMAX_API_KEY（与 TTS 共用）。



用法：

  python scripts/generate_persona_assets.py

  python scripts/generate_persona_assets.py --portraits

  python scripts/generate_persona_assets.py --persona PER-HTN-TAXI-01 --portraits

  python scripts/generate_persona_assets.py --dry-run

"""



from __future__ import annotations



import argparse

import base64

import json

import os

import shutil

import sys

import urllib.request

from pathlib import Path



ROOT = Path(__file__).resolve().parents[1]

BG_DIR = ROOT / "web" / "live2d" / "backgrounds"

PORTRAIT_DIR = ROOT / "web" / "live2d" / "portraits"

MANIFEST = ROOT / "web" / "live2d" / "manifest.json"

STATIC_MANIFEST = ROOT / "server" / "app" / "static" / "live2d" / "manifest.json"

STATIC_BG = ROOT / "server" / "app" / "static" / "live2d" / "backgrounds"

STATIC_PORTRAIT = ROOT / "server" / "app" / "static" / "live2d" / "portraits"



PERSONA_PROMPTS = {

    "PER-HTN-TAXI-01": (

        "中国社区医院随访诊室室内场景，写实插画风格，柔和日光，"

        "白墙、诊桌、血压计海报、木椅、窗外城市天际线，无人物，"

        "干净专业，galgame 视觉小说背景，横构图"

    ),

    "PER-ELDER-BASIC-01": (

        "中国老年科门诊随访室，写实温暖色调，绿植、健康宣传栏、"

        "诊桌与椅子，无人物，安静舒适，galgame 背景，横构图"

    ),

    "PER-ELDER-FEMALE-02": (

        "中国社区医院女性随访诊室，柔和粉蓝配色，整洁明亮，"

        "诊桌、窗帘、医疗海报，无人物，galgame 背景，横构图"

    ),

    "default": (

        "中国现代医院随访诊室室内，写实插画，专业整洁，无人物，"

        "galgame 视觉小说背景，横构图"

    ),

}



PORTRAIT_PROMPTS = {

    "PER-HTN-TAXI-01": (

        "中国中年男性出租车司机半身像，写实插画，略疲惫但友善，"

        "深色夹克，社区医院随访场景光，上半身，无文字水印，"

        "galgame 视觉小说立绘风格，透明感柔和背景"

    ),

    "PER-ELDER-BASIC-01": (

        "中国老年男性患者半身像，写实温暖，花白短发，朴素衬衫，"

        "和蔼略带疑虑，社区医院随访，上半身，无文字，galgame 立绘"

    ),

    "PER-ELDER-FEMALE-02": (

        "中国老年女性患者半身像，写实柔和，短发，浅色开衫，"

        "亲切朴实，社区医院随访，上半身，无文字，galgame 立绘"

    ),

    "default": (

        "中国中老年医院随访受试者半身像，写实插画，上半身，"

        "无文字水印，galgame 立绘风格"

    ),

}





def load_env() -> dict[str, str]:

    env: dict[str, str] = {}

    env_path = ROOT / ".env"

    if not env_path.is_file():

        return env

    for line in env_path.read_text(encoding="utf-8").splitlines():

        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:

            continue

        k, v = line.split("=", 1)

        env[k.strip()] = v.strip().strip('"').strip("'")

    return env





def minimax_image(api_key: str, base_url: str, prompt: str, aspect_ratio: str = "16:9") -> bytes:

    url = f"{base_url.rstrip('/')}/image_generation"

    payload = {

        "model": "image-01",

        "prompt": prompt,

        "aspect_ratio": aspect_ratio,

        "response_format": "base64",

        "n": 1,

    }

    req = urllib.request.Request(

        url,

        data=json.dumps(payload).encode("utf-8"),

        headers={

            "Authorization": f"Bearer {api_key}",

            "Content-Type": "application/json",

        },

        method="POST",

    )

    with urllib.request.urlopen(req, timeout=120) as res:

        data = json.loads(res.read().decode("utf-8"))



    base = data.get("base_resp") or {}

    if base.get("status_code") not in (None, 0):

        raise RuntimeError(base.get("status_msg") or f"MiniMax 错误: {data}")



    images = (data.get("data") or {}).get("image_base64") or []

    if not images:

        urls = (data.get("data") or {}).get("image_urls") or []

        if urls:

            with urllib.request.urlopen(urls[0], timeout=60) as img_res:

                return img_res.read()

        raise RuntimeError(f"无图片数据: {json.dumps(data, ensure_ascii=False)[:400]}")



    return base64.b64decode(images[0])





def save_webp(png_or_jpeg: bytes, dest: Path) -> Path:

    try:

        from PIL import Image

        import io



        img = Image.open(io.BytesIO(png_or_jpeg)).convert("RGB")

        dest.parent.mkdir(parents=True, exist_ok=True)

        img.save(dest, "WEBP", quality=88, method=6)

        return dest

    except ImportError:

        dest = dest.with_suffix(".jpg")

        dest.parent.mkdir(parents=True, exist_ok=True)

        dest.write_bytes(png_or_jpeg)

        return dest





def sync_manifest(*, backgrounds: dict[str, str] | None = None, portraits: dict[str, str] | None = None) -> None:

    for path in (MANIFEST, STATIC_MANIFEST):

        if not path.is_file():

            continue

        data = json.loads(path.read_text(encoding="utf-8"))

        if backgrounds:

            data.setdefault("backgrounds", {}).update(backgrounds)

        if portraits:

            data.setdefault("portraits", {}).update(portraits)

        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")





def copy_static_assets() -> None:

    for src_dir, dest_dir in ((BG_DIR, STATIC_BG), (PORTRAIT_DIR, STATIC_PORTRAIT)):

        if not src_dir.is_dir():

            continue

        dest_dir.mkdir(parents=True, exist_ok=True)

        for f in src_dir.iterdir():

            if f.is_file():

                shutil.copy2(f, dest_dir / f.name)





def generate_backgrounds(api_key: str, base_url: str, targets: list[str], dry_run: bool) -> tuple[int, dict[str, str]]:

    BG_DIR.mkdir(parents=True, exist_ok=True)

    manifest_updates: dict[str, str] = {}

    generated = 0



    for persona_id in targets:

        prompt = PERSONA_PROMPTS.get(persona_id)

        if not prompt:

            print(f"跳过未知 persona: {persona_id}")

            continue



        out_webp = BG_DIR / f"{persona_id}.webp"

        rel = f"/live2d/backgrounds/{persona_id}.webp"

        print(f"\n[背景 {persona_id}]")

        print(f"  prompt: {prompt[:80]}…")



        if dry_run:

            manifest_updates[persona_id] = rel

            continue



        if not api_key or api_key == "your_key_here":

            print("  跳过：未配置 MINIMAX_API_KEY")

            continue



        if out_webp.is_file():

            print(f"  已存在 {out_webp.name}，跳过")

            manifest_updates[persona_id] = rel

            continue



        print("  调用 MiniMax image-01…")

        try:

            raw = minimax_image(api_key, base_url, prompt, aspect_ratio="16:9")

            actual = save_webp(raw, out_webp)

            rel_actual = f"/live2d/backgrounds/{actual.name}"

            manifest_updates[persona_id] = rel_actual

            generated += 1

            print(f"  已保存 → {actual.relative_to(ROOT)}")

        except Exception as exc:

            print(f"  失败: {exc}", file=sys.stderr)



    default_path = BG_DIR / "clinic-default.webp"

    if default_path.is_file():

        manifest_updates.setdefault("default", "/live2d/backgrounds/clinic-default.webp")



    return generated, manifest_updates





def generate_portraits(api_key: str, base_url: str, targets: list[str], dry_run: bool) -> tuple[int, dict[str, str]]:

    PORTRAIT_DIR.mkdir(parents=True, exist_ok=True)

    manifest_updates: dict[str, str] = {}

    generated = 0



    for persona_id in targets:

        prompt = PORTRAIT_PROMPTS.get(persona_id)

        if not prompt:

            print(f"跳过未知 persona: {persona_id}")

            continue



        out_webp = PORTRAIT_DIR / f"{persona_id}.webp"

        rel = f"/live2d/portraits/{persona_id}.webp"

        print(f"\n[肖像 {persona_id}]")

        print(f"  prompt: {prompt[:80]}…")



        if dry_run:

            manifest_updates[persona_id] = rel

            continue



        if not api_key or api_key == "your_key_here":

            print("  跳过：未配置 MINIMAX_API_KEY")

            continue



        if out_webp.is_file():

            print(f"  已存在 {out_webp.name}，跳过")

            manifest_updates[persona_id] = rel

            continue



        print("  调用 MiniMax image-01（竖构图）…")

        try:

            raw = minimax_image(api_key, base_url, prompt, aspect_ratio="3:4")

            actual = save_webp(raw, out_webp)

            rel_actual = f"/live2d/portraits/{actual.name}"

            manifest_updates[persona_id] = rel_actual

            generated += 1

            print(f"  已保存 → {actual.relative_to(ROOT)}")

        except Exception as exc:

            print(f"  失败: {exc}", file=sys.stderr)



    svg_default = PORTRAIT_DIR / "PER-ELDER-BASIC-01.svg"

    if svg_default.is_file():

        manifest_updates.setdefault("default", "/live2d/portraits/PER-ELDER-BASIC-01.svg")



    return generated, manifest_updates





def main() -> int:

    parser = argparse.ArgumentParser(description="MiniMax 生成诊室背景 / 受试者肖像")

    parser.add_argument("--persona", action="append", help="仅生成指定 persona_id")

    parser.add_argument("--portraits", action="store_true", help="生成半身像（默认只生成背景）")

    parser.add_argument("--backgrounds", action="store_true", help="生成背景（默认开启）")

    parser.add_argument("--all", action="store_true", help="同时生成背景与肖像")

    parser.add_argument("--dry-run", action="store_true", help="只打印 prompt，不调用 API")

    args = parser.parse_args()



    do_bg = args.backgrounds or args.all or (not args.portraits)

    do_portrait = args.portraits or args.all



    env = load_env()

    api_key = os.environ.get("MINIMAX_API_KEY") or env.get("MINIMAX_API_KEY", "")

    base_url = os.environ.get("MINIMAX_BASE_URL") or env.get("MINIMAX_BASE_URL", "https://api.minimaxi.com/v1")



    targets = args.persona or list(PERSONA_PROMPTS.keys())

    bg_updates: dict[str, str] = {}

    portrait_updates: dict[str, str] = {}

    total = 0



    if do_bg:

        n, bg_updates = generate_backgrounds(api_key, base_url, targets, args.dry_run)

        total += n



    if do_portrait:

        pt_targets = args.persona or list(PORTRAIT_PROMPTS.keys())

        n, portrait_updates = generate_portraits(api_key, base_url, pt_targets, args.dry_run)

        total += n



    if bg_updates or portrait_updates:

        sync_manifest(backgrounds=bg_updates or None, portraits=portrait_updates or None)

        parts = []

        if bg_updates:

            parts.append(f"{len(bg_updates)} 条背景")

        if portrait_updates:

            parts.append(f"{len(portrait_updates)} 条肖像")

        print(f"\n已更新 manifest.json（{', '.join(parts)}）")



    copy_static_assets()

    print(f"\n完成：新生成 {total} 张。")

    print("默认展示：项目 SVG 肖像 + CSS 诊室；可用 --portraits / 背景脚本替换为 MiniMax 写实图。")

    return 0





if __name__ == "__main__":

    raise SystemExit(main())


