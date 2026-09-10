"""管理端：病例导入/删除、账号、场景与数字人形象配置。"""

from __future__ import annotations

import base64
import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .auth import hash_password, get_user_by_username
from .case_loader import (
    CASES_DIR,
    INDEX_PATH,
    ROOT,
    invalidate_case_caches,
    load_cases_index,
)
from .config import get_settings
from .db import connect, new_id, utc_now

SCENES_PATH = ROOT / "web" / "data" / "scenes.json"
LIVE2D_MANIFEST = ROOT / "web" / "live2d" / "manifest.json"
PORTRAITS_DIR = ROOT / "web" / "live2d" / "portraits"

ADMIN_USERNAME = "admin"
ADMIN_DEFAULT_PASSWORD = "Admin2026"
ADMIN_DISPLAY_NAME = "系统管理员"

PORTRAIT_PROMPTS = {
    "PER-HTN-TAXI-01": (
        "中国中年男性出租车司机半身像，写实插画，略疲惫但友善，"
        "深色夹克，社区医院随访场景光，上半身，无文字水印，"
        "galgame 视觉小说立绘风格，柔和背景"
    ),
    "PER-ELDER-BASIC-01": (
        "中国老年男性患者半身像，写实温暖，花白短发，朴素衬衫，"
        "和蔼略带疑虑，社区医院随访，上半身，无文字，galgame 立绘"
    ),
    "PER-ELDER-FEMALE-02": (
        "中国老年女性患者半身像，写实柔和，短发，浅色开衫，"
        "亲切朴实，社区医院随访，上半身，无文字，galgame 立绘"
    ),
}


def ensure_admin_user(db_path: str) -> dict[str, Any]:
    """确保默认管理员账号存在；若已存在则校正角色，并保证默认密码可用。"""
    row = get_user_by_username(db_path, ADMIN_USERNAME)
    now = utc_now()
    if row:
        conn = connect(db_path)
        # 校正角色与显示名；内置账号密码重置为默认（便于本地/演示找回）
        conn.execute(
            """
            UPDATE app_user
            SET role=?, display_name=?, password_hash=?, updated_at=?
            WHERE id=?
            """,
            (
                "admin",
                ADMIN_DISPLAY_NAME,
                hash_password(ADMIN_DEFAULT_PASSWORD),
                now,
                row["id"],
            ),
        )
        conn.commit()
        conn.close()
        return {
            "ok": True,
            "created": False,
            "reset": True,
            "username": ADMIN_USERNAME,
            "password": ADMIN_DEFAULT_PASSWORD,
        }
    uid = new_id()
    conn = connect(db_path)
    conn.execute(
        """
        INSERT INTO app_user(id, username, password_hash, display_name, role, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (uid, ADMIN_USERNAME, hash_password(ADMIN_DEFAULT_PASSWORD), ADMIN_DISPLAY_NAME, "admin", now, now),
    )
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "created": True,
        "username": ADMIN_USERNAME,
        "password": ADMIN_DEFAULT_PASSWORD,
    }


def admin_stats(db_path: str) -> dict[str, Any]:
    conn = connect(db_path)
    users = conn.execute("SELECT COUNT(*) AS c FROM app_user").fetchone()["c"]
    trainees = conn.execute("SELECT COUNT(*) AS c FROM app_user WHERE role='trainee'").fetchone()["c"]
    admins = conn.execute("SELECT COUNT(*) AS c FROM app_user WHERE role='admin'").fetchone()["c"]
    instructors = conn.execute("SELECT COUNT(*) AS c FROM app_user WHERE role='instructor'").fetchone()["c"]
    sessions = conn.execute("SELECT COUNT(*) AS c FROM training_session").fetchone()["c"]
    conn.close()
    idx = load_cases_index()
    case_n = 0
    persona_n = 0
    for d in idx.get("diseases", []):
        for c in d.get("cases", []):
            case_n += 1
            persona_n += len(c.get("personas") or [])
    if not case_n:
        case_n = len(idx.get("cases") or [])
    scenes = []
    if SCENES_PATH.exists():
        try:
            scenes = (json.loads(SCENES_PATH.read_text(encoding="utf-8")).get("scenes") or [])
        except json.JSONDecodeError:
            scenes = []
    return {
        "ok": True,
        "users": users,
        "trainees": trainees,
        "admins": admins,
        "instructors": instructors,
        "sessions": sessions,
        "cases": case_n,
        "personas": persona_n,
        "scenes": len(scenes),
    }


def list_users(db_path: str) -> list[dict[str, Any]]:
    conn = connect(db_path)
    rows = conn.execute(
        """
        SELECT id, username, display_name, role, created_at,
          (SELECT COUNT(*) FROM training_session ts WHERE ts.trainee_user_id = app_user.id) AS session_count
        FROM app_user
        ORDER BY created_at DESC
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_user(
    db_path: str,
    *,
    username: str,
    password: str,
    display_name: str | None = None,
    role: str = "trainee",
) -> dict[str, Any]:
    username = (username or "").strip().lower()
    role = (role or "trainee").strip().lower()
    if role not in ("trainee", "admin", "instructor"):
        return {"ok": False, "error": "角色仅支持 trainee / admin / instructor"}
    if get_user_by_username(db_path, username):
        return {"ok": False, "error": "用户名已存在"}
    if len(password or "") < 6:
        return {"ok": False, "error": "密码至少 6 位"}
    uid = new_id()
    now = utc_now()
    name = (display_name or username).strip()[:64] or username
    conn = connect(db_path)
    conn.execute(
        """
        INSERT INTO app_user(id, username, password_hash, display_name, role, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (uid, username, hash_password(password), name, role, now, now),
    )
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "user": {"id": uid, "username": username, "display_name": name, "role": role},
    }


def update_user(
    db_path: str,
    user_id: str,
    *,
    role: str | None = None,
    display_name: str | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    conn = connect(db_path)
    row = conn.execute("SELECT * FROM app_user WHERE id=?", (user_id,)).fetchone()
    if not row:
        conn.close()
        return {"ok": False, "error": "用户不存在"}
    fields: list[str] = []
    vals: list[Any] = []
    if role is not None:
        role = role.strip().lower()
        if role not in ("trainee", "admin", "instructor"):
            conn.close()
            return {"ok": False, "error": "非法角色"}
        fields.append("role=?")
        vals.append(role)
    if display_name is not None:
        fields.append("display_name=?")
        vals.append(display_name.strip()[:64] or row["display_name"])
    if password:
        if len(password) < 6:
            conn.close()
            return {"ok": False, "error": "密码至少 6 位"}
        fields.append("password_hash=?")
        vals.append(hash_password(password))
    if not fields:
        conn.close()
        return {"ok": False, "error": "无更新项"}
    fields.append("updated_at=?")
    vals.append(utc_now())
    vals.append(user_id)
    conn.execute(f"UPDATE app_user SET {', '.join(fields)} WHERE id=?", tuple(vals))
    conn.commit()
    updated = conn.execute(
        "SELECT id, username, display_name, role, created_at FROM app_user WHERE id=?",
        (user_id,),
    ).fetchone()
    conn.close()
    return {"ok": True, "user": dict(updated)}


def delete_user(db_path: str, user_id: str, *, actor_id: str) -> dict[str, Any]:
    if user_id == actor_id:
        return {"ok": False, "error": "不能删除当前登录账号"}
    conn = connect(db_path)
    row = conn.execute("SELECT username, role FROM app_user WHERE id=?", (user_id,)).fetchone()
    if not row:
        conn.close()
        return {"ok": False, "error": "用户不存在"}
    if row["username"] == ADMIN_USERNAME:
        conn.close()
        return {"ok": False, "error": "不能删除内置管理员账号"}
    conn.execute("DELETE FROM app_user WHERE id=?", (user_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


def list_case_catalog() -> dict[str, Any]:
    idx = load_cases_index()
    items: list[dict[str, Any]] = []
    for d in idx.get("diseases", []):
        for c in d.get("cases", []):
            file_rel = c.get("file") or f"cases/{c.get('case_id')}.json"
            path = ROOT / "web" / "data" / file_rel
            items.append({
                "case_id": c.get("case_id"),
                "title": c.get("title") or c.get("short_title"),
                "short_title": c.get("short_title"),
                "disease_code": d.get("disease_code"),
                "disease_name": d.get("name_zh"),
                "phase": c.get("phase"),
                "file": file_rel,
                "exists": path.exists(),
                "personas": [
                    {
                        "persona_id": p.get("persona_id"),
                        "display_label": p.get("display_label"),
                        "is_trainable": p.get("is_trainable", True),
                        "file": p.get("file"),
                    }
                    for p in (c.get("personas") or [])
                ],
                "mvp_scenes": c.get("mvp_scenes") or [],
            })
    if not items:
        for c in idx.get("cases", []):
            items.append({
                "case_id": c.get("case_id"),
                "title": c.get("title") or c.get("short_title"),
                "short_title": c.get("short_title"),
                "disease_code": None,
                "disease_name": None,
                "phase": c.get("phase"),
                "file": c.get("file"),
                "exists": bool(c.get("file") and (ROOT / "web" / "data" / c["file"]).exists()),
                "personas": c.get("personas") or [],
                "mvp_scenes": c.get("mvp_scenes") or [],
            })
    return {"ok": True, "meta": idx.get("meta") or {}, "cases": items}


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def import_case_package(payload: dict[str, Any]) -> dict[str, Any]:
    """导入病例 JSON：写入 cases 目录、更新索引，并刷新 AI 病例缓存。"""
    if not isinstance(payload, dict):
        return {"ok": False, "error": "病例包须为 JSON 对象"}
    meta = payload.get("meta") or {}
    case_id = meta.get("case_id") or payload.get("case_id")
    if not case_id or not isinstance(case_id, str):
        return {"ok": False, "error": "缺少 meta.case_id"}
    if not case_id.startswith("CASE-"):
        return {"ok": False, "error": "case_id 建议以 CASE- 开头"}
    persona = payload.get("persona") or {}
    if not persona.get("persona_id"):
        return {"ok": False, "error": "病例包须包含 persona.persona_id（AI 训练人设）"}

    CASES_DIR.mkdir(parents=True, exist_ok=True)
    out_path = CASES_DIR / f"{case_id}.json"
    _write_json(out_path, payload)

    idx = load_cases_index()
    disease = payload.get("disease") or {}
    disease_code = disease.get("disease_code") or meta.get("disease_code") or "T2DM"
    disease_name = disease.get("name_zh") or disease_code
    short_title = meta.get("short_title") or meta.get("title") or case_id
    title = meta.get("title") or short_title
    phase = meta.get("phase") or ""
    file_rel = f"cases/{case_id}.json"
    persona_entry = {
        "persona_id": persona.get("persona_id"),
        "display_label": persona.get("display_label")
        or persona.get("display_name")
        or persona.get("persona_id"),
        "one_liner": persona.get("one_liner") or (persona.get("lay_bio") or "")[:48],
        "file": file_rel,
        "is_default": True,
        "is_trainable": True,
        "data_status": "imported",
    }

    diseases = idx.setdefault("diseases", [])
    disease_node = next((d for d in diseases if d.get("disease_code") == disease_code), None)
    if not disease_node:
        disease_node = {
            "disease_code": disease_code,
            "name_zh": disease_name,
            "summary": "管理端导入",
            "cases": [],
        }
        diseases.append(disease_node)
    else:
        disease_node["name_zh"] = disease_node.get("name_zh") or disease_name

    cases = disease_node.setdefault("cases", [])
    existing = next((c for c in cases if c.get("case_id") == case_id), None)
    case_entry = {
        "case_id": case_id,
        "short_title": short_title,
        "title": title,
        "data_status": "imported",
        "version": meta.get("version") or "0.1.0",
        "phase": phase,
        "mvp_scenes": meta.get("mvp_scenes") or ["S1"],
        "file": file_rel,
        "one_liner": meta.get("one_liner") or title,
        "personas": [persona_entry],
    }
    if existing:
        # 合并人设：同 persona_id 覆盖，否则追加
        personas = list(existing.get("personas") or [])
        replaced = False
        for i, p in enumerate(personas):
            if p.get("persona_id") == persona_entry["persona_id"]:
                personas[i] = persona_entry
                replaced = True
                break
        if not replaced:
            personas.append(persona_entry)
        case_entry["personas"] = personas
        existing.update({k: v for k, v in case_entry.items() if k != "personas"})
        existing["personas"] = personas
    else:
        cases.append(case_entry)

    # 扁平 cases 列表同步（兼容旧读取）
    flat = idx.setdefault("cases", [])
    flat_hit = next((c for c in flat if c.get("case_id") == case_id), None)
    flat_entry = {
        "case_id": case_id,
        "short_title": short_title,
        "title": title,
        "file": file_rel,
        "phase": phase,
    }
    if flat_hit:
        flat_hit.update(flat_entry)
    else:
        flat.append(flat_entry)

    _write_json(INDEX_PATH, idx)
    invalidate_case_caches()

    return {
        "ok": True,
        "case_id": case_id,
        "file": file_rel,
        "persona_id": persona_entry["persona_id"],
        "message": "已写入病例包并刷新索引；模拟对话将按此人设与病情事实回复。",
    }


def delete_case(case_id: str, *, delete_file: bool = True) -> dict[str, Any]:
    idx = load_cases_index()
    removed = False
    file_rel = None
    for d in idx.get("diseases", []):
        before = len(d.get("cases") or [])
        kept = []
        for c in d.get("cases") or []:
            if c.get("case_id") == case_id:
                removed = True
                file_rel = c.get("file")
            else:
                kept.append(c)
        d["cases"] = kept
        if len(kept) != before:
            removed = True
    if idx.get("cases"):
        idx["cases"] = [c for c in idx["cases"] if c.get("case_id") != case_id]
    if not removed:
        return {"ok": False, "error": "未找到该病例"}
    if delete_file:
        path = CASES_DIR / f"{case_id}.json"
        if file_rel:
            path = ROOT / "web" / "data" / file_rel
        if path.exists():
            path.unlink()
    _write_json(INDEX_PATH, idx)
    invalidate_case_caches()
    return {"ok": True, "case_id": case_id}


def list_scenes() -> dict[str, Any]:
    if not SCENES_PATH.exists():
        return {"ok": True, "scenes": []}
    raw = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    return {"ok": True, "meta": raw.get("meta"), "scenes": raw.get("scenes") or []}


def upsert_scene(scene: dict[str, Any]) -> dict[str, Any]:
    sid = (scene.get("id") or scene.get("scene_key") or "").strip()
    if not sid:
        return {"ok": False, "error": "缺少场景 id / scene_key"}
    raw = {"meta": {"version": "admin"}, "scenes": []}
    if SCENES_PATH.exists():
        try:
            raw = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    scenes = raw.setdefault("scenes", [])
    name = (scene.get("name") or scene.get("title") or sid).strip()
    description = (scene.get("description") or scene.get("summary") or "").strip()
    code = (scene.get("code") or "").strip()
    tier_raw = str(scene.get("tier") or "").strip().lower()
    if tier_raw not in ("test", "formal"):
        # 未传时：新建默认 test；更新时保留原值
        tier_raw = ""
    entry = {
        "id": sid,
        "code": code or None,
        "name": name,
        "title": name,
        "status": scene.get("status") or "mvp",
        "statusLabel": scene.get("statusLabel") or "启用",
        "description": description,
        "summary": description,
        "enabled": scene.get("enabled", True),
        "primaryStandards": scene.get("primaryStandards") or ["gcp-2020"],
    }
    if tier_raw in ("test", "formal"):
        entry["tier"] = tier_raw
        if tier_raw == "formal":
            entry["statusLabel"] = scene.get("statusLabel") or "正式"
        elif not scene.get("statusLabel"):
            entry["statusLabel"] = "测试"
    # 去掉空 code，避免污染
    if not entry["code"]:
        entry.pop("code", None)
    hit = next((s for s in scenes if (s.get("id") or s.get("scene_key")) == sid), None)
    if hit:
        # 保留原有 standards / status / tier，除非调用方显式传入
        for keep in ("primaryStandards", "status", "statusLabel", "tier"):
            if keep == "tier" and tier_raw in ("test", "formal"):
                continue
            if keep not in scene and hit.get(keep) is not None:
                entry[keep] = hit[keep]
        if "tier" not in entry and hit.get("tier"):
            entry["tier"] = hit["tier"]
        hit.clear()
        hit.update(entry)
    else:
        if "tier" not in entry:
            entry["tier"] = "test"
            entry["statusLabel"] = entry.get("statusLabel") or "测试"
        scenes.append(entry)
    _write_json(SCENES_PATH, raw)
    refreshed = 0
    try:
        from . import case_ingest

        refreshed = case_ingest.refresh_draft_hooks_for_scene(sid)
    except Exception:
        refreshed = 0
    return {"ok": True, "scene": entry, "refreshed_drafts": refreshed}


def delete_scene(scene_id: str) -> dict[str, Any]:
    if not SCENES_PATH.exists():
        return {"ok": False, "error": "场景文件不存在"}
    raw = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    before = len(raw.get("scenes") or [])
    raw["scenes"] = [
        s for s in (raw.get("scenes") or [])
        if (s.get("id") or s.get("scene_key")) != scene_id
    ]
    if len(raw["scenes"]) == before:
        return {"ok": False, "error": "未找到场景"}
    _write_json(SCENES_PATH, raw)
    return {"ok": True}


def _portrait_label(filename: str, persona_labels: dict[str, str]) -> str:
    stem = Path(filename).stem
    if stem in persona_labels:
        return persona_labels[stem]
    # 常见默认形象友好名
    friendly = {
        "PER-HTN-TAXI-01": "中年男性 · 出租车司机形象",
        "PER-ELDER-BASIC-01": "老年男性 · 基础形象",
        "PER-ELDER-FEMALE-02": "老年女性 · 基础形象",
    }
    return friendly.get(stem, stem)


def _portrait_public_url(path: str | None) -> str:
    """给前端可稳定刷新的肖像 URL（带文件 mtime 防缓存读坏）。"""
    if not path:
        return ""
    raw = str(path).split("?", 1)[0]
    name = Path(raw).name
    if not name:
        return str(path)
    local = PORTRAITS_DIR / name
    if local.is_file():
        return f"/live2d/portraits/{name}?v={int(local.stat().st_mtime)}"
    if raw.startswith("/"):
        return raw
    return f"/live2d/portraits/{name}"


def _minimax_image_bytes(*, prompt: str, aspect_ratio: str = "3:4") -> bytes:
    settings = get_settings()
    key = (settings.minimax_api_key or "").strip()
    if not key or key == "your_key_here":
        raise RuntimeError("未配置 MINIMAX_API_KEY，无法 AI 生成立绘")
    base = (settings.minimax_base_url or "https://api.minimaxi.com/v1").rstrip("/")
    url = f"{base}/image_generation"
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
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"MiniMax HTTP {exc.code}: {body}") from exc

    base_resp = data.get("base_resp") or {}
    if base_resp.get("status_code") not in (None, 0):
        raise RuntimeError(base_resp.get("status_msg") or f"MiniMax 错误: {data}")

    images = (data.get("data") or {}).get("image_base64") or []
    if images:
        return base64.b64decode(images[0])
    urls = (data.get("data") or {}).get("image_urls") or []
    if urls:
        with urllib.request.urlopen(urls[0], timeout=60) as img_res:
            return img_res.read()
    raise RuntimeError(f"无图片数据: {json.dumps(data, ensure_ascii=False)[:400]}")


def _save_portrait_bytes(raw: bytes, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(raw)).convert("RGB")
        if dest.suffix.lower() != ".webp":
            dest = dest.with_suffix(".webp")
        img.save(dest, "WEBP", quality=88, method=6)
        return dest
    except ImportError:
        dest = dest.with_suffix(".jpg")
        dest.write_bytes(raw)
        return dest


def generate_ai_portrait(
    *,
    persona_id: str,
    prompt: str | None = None,
    display_hint: str | None = None,
    bind: bool = True,
) -> dict[str, Any]:
    """用 MiniMax image-01 生成受试者立绘并写入形象库。"""
    from re import sub

    pid = (persona_id or "").strip()
    if not pid:
        return {"ok": False, "error": "缺少 persona_id"}
    safe = sub(r"[^\w\-]+", "_", pid)[:48] or "portrait"
    hint = (display_hint or "").strip()
    profile = _load_persona_profile(pid)
    use_prompt = _build_portrait_prompt(pid, prompt=prompt, display_hint=hint, profile=profile)
    try:
        raw = _minimax_image_bytes(prompt=use_prompt, aspect_ratio="3:4")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    out = _save_portrait_bytes(raw, PORTRAITS_DIR / f"{safe}.webp")
    static_portraits = ROOT / "server" / "app" / "static" / "live2d" / "portraits"
    if static_portraits.parent.exists():
        try:
            static_portraits.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out, static_portraits / out.name)
        except OSError:
            pass

    public = f"/live2d/portraits/{out.name}"
    public_bust = _portrait_public_url(public)
    result: dict[str, Any] = {
        "ok": True,
        "path": public,
        "path_bust": public_bust,
        "file": out.name,
        "prompt": use_prompt,
        "label": _portrait_label(out.name, {pid: profile.get("display_label") or hint} if (profile or hint) else {}),
        "message": "立绘已生成",
        "profile_used": {
            "display_label": profile.get("display_label"),
            "age_years": profile.get("age_years"),
            "sex": profile.get("sex"),
            "occupation": profile.get("occupation"),
        },
    }
    if bind:
        bind_res = update_avatar_binding(persona_id=pid, portrait_path=public)
        if not bind_res.get("ok"):
            return bind_res
        result["bound"] = True
        result["persona_id"] = pid
    return result


def _load_persona_profile(persona_id: str) -> dict[str, Any]:
    """从病例 JSON 读取人设，供立绘提示词使用。"""
    pid = (persona_id or "").strip()
    if not pid or not CASES_DIR.is_dir():
        return {}
    for path in CASES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        persona = data.get("persona") or {}
        if persona.get("persona_id") == pid:
            return dict(persona)
        for p in data.get("personas") or []:
            if isinstance(p, dict) and p.get("persona_id") == pid:
                return dict(p)
    return {}


def _infer_sex_zh(profile: dict[str, Any], hint: str = "") -> str:
    sex = (profile.get("sex") or "").lower()
    if sex in ("female", "f", "女"):
        return "女性"
    if sex in ("male", "m", "男"):
        return "男性"
    blob = f"{profile.get('display_label') or ''} {profile.get('occupation') or ''} {hint}"
    if any(k in blob for k in ("女", "阿姨", "秀英", "姐", "妇")):
        return "女性"
    if any(k in blob for k in ("男", "大爷", "叔叔", "师傅", "司机")):
        return "男性"
    return "成人"


def _occupation_zh(occ: Any) -> str:
    raw = str(occ or "").strip()
    if not raw:
        return ""
    mapping = {
        "taxi_driver": "出租车司机",
        "retired": "退休人员",
        "factory_worker": "工厂工人",
        "farmer": "务农",
    }
    return mapping.get(raw, raw)


def _build_portrait_prompt(
    persona_id: str,
    *,
    prompt: str | None,
    display_hint: str | None,
    profile: dict[str, Any],
) -> str:
    custom = (prompt or "").strip()
    if custom:
        return custom
    hint = (display_hint or "").strip()
    label = (profile.get("display_label") or hint or persona_id).strip()
    age = profile.get("age_years")
    age_s = f"{age}岁" if age else ""
    sex_zh = _infer_sex_zh(profile, hint)
    occ_zh = _occupation_zh(profile.get("occupation"))
    bio = str(profile.get("lay_bio") or "").strip()
    # 气质：去掉明显病情/漏服细节，只留性格口吻线索
    vibe = bio
    for cut in ("漏服", "服药", "头晕", "抽血", "副作用", "试验", "日记", "合并用药"):
        if cut in vibe:
            # 截到首个病情词之前，避免立绘被「病历」带偏
            vibe = vibe.split(cut, 1)[0].rstrip("，,；;。 ")
            break
    vibe = vibe[:80] if vibe else ""
    # 若气质太空，用职业+称呼兜底
    if not vibe and (occ_zh or label):
        vibe = f"{occ_zh or ''}，日常朴实，略紧张配合".strip("，")
    parts = [
        "中国人半身立绘肖像，单人特写，胸部以上，干净背景或浅色虚化诊室，",
        f"{age_s}{sex_zh}" if (age_s or sex_zh) else "中老年受试者",
        "，",
    ]
    if occ_zh:
        parts.append(f"身份/职业：{occ_zh}，穿着符合该身份的朴素日常服装，")
    parts.append(f"人物需一眼符合「{label}」，")
    if vibe:
        parts.append(f"气质参考（不要把文字画进图里）：{vibe}。")
    parts.append(
        "社区医院随访柔和室内光，写实插画/视觉小说立绘，表情自然略紧张或配合，"
        "五官清晰，不要网红脸，无文字、无水印、无多人、无夸张妆造。"
    )
    if hint and hint not in label:
        parts.append(f"老师补充外貌要求：{hint}。")
    # 仅当完全没有病例人设、且是预设 ID 时，才退回模板
    if not profile and persona_id in PORTRAIT_PROMPTS and not hint:
        return PORTRAIT_PROMPTS[persona_id]
    return "".join(parts)


def list_avatars() -> dict[str, Any]:
    manifest = {}
    if LIVE2D_MANIFEST.exists():
        manifest = json.loads(LIVE2D_MANIFEST.read_text(encoding="utf-8"))
    idx = load_cases_index()
    persona_labels: dict[str, str] = {}
    personas: list[dict[str, Any]] = []
    persona_map = manifest.get("persona_map") or manifest.get("persona_model") or {}
    for d in idx.get("diseases", []):
        for c in d.get("cases", []):
            case_title = c.get("short_title") or c.get("title") or c.get("case_id") or ""
            for p in c.get("personas") or []:
                pid = p.get("persona_id")
                if not pid:
                    continue
                profile = _load_persona_profile(pid)
                label = profile.get("display_label") or p.get("display_label") or pid
                persona_labels[pid] = label
                portrait = (manifest.get("portraits") or {}).get(pid)
                personas.append({
                    "persona_id": pid,
                    "display_label": label,
                    "case_id": c.get("case_id"),
                    "case_title": case_title,
                    "visual": (manifest.get("persona_visual") or {}).get(pid)
                    or manifest.get("default_visual"),
                    "portrait": portrait,
                    "portrait_url": _portrait_public_url(portrait),
                    "model": persona_map.get(pid),
                    "age_years": profile.get("age_years"),
                    "sex": profile.get("sex"),
                    "occupation": profile.get("occupation"),
                    "lay_bio": (profile.get("lay_bio") or "")[:160],
                })

    # 形象库：优先 webp，同 stem 去重
    gallery: list[dict[str, Any]] = []
    seen_stems: set[str] = set()
    if PORTRAITS_DIR.exists():
        files = sorted(
            p for p in PORTRAITS_DIR.iterdir()
            if p.suffix.lower() in (".webp", ".png", ".jpg", ".jpeg", ".svg")
        )
        # webp/png 优先于 svg
        files.sort(key=lambda p: (0 if p.suffix.lower() == ".webp" else 1 if p.suffix.lower() in (".png", ".jpg", ".jpeg") else 2, p.name))
        for p in files:
            stem = p.stem
            if stem in seen_stems:
                continue
            seen_stems.add(stem)
            bust = int(p.stat().st_mtime)
            path = f"/live2d/portraits/{p.name}?v={bust}"
            gallery.append({
                "file": p.name,
                "path": path,
                "label": _portrait_label(p.name, persona_labels),
            })

    models_raw = manifest.get("models") or {}
    models_meta = {
        mid: {"label": (meta or {}).get("label") or mid, "gender": (meta or {}).get("gender")}
        for mid, meta in models_raw.items()
    }
    return {
        "ok": True,
        "default_visual": manifest.get("default_visual"),
        "models": list(models_raw.keys()),
        "models_meta": models_meta,
        "portrait_files": [g["file"] for g in gallery],
        "portrait_gallery": gallery,
        "personas": personas,
        "manifest": {
            "persona_visual": manifest.get("persona_visual") or {},
            "portraits": manifest.get("portraits") or {},
            "persona_map": persona_map,
        },
    }


def save_portrait_upload(
    *,
    filename: str,
    content: bytes,
    persona_id: str | None = None,
) -> dict[str, Any]:
    """保存上传肖像到 web/live2d/portraits，可选绑定到受试者。"""
    from re import sub

    raw_name = Path(filename or "portrait.webp").name
    ext = Path(raw_name).suffix.lower()
    if ext not in (".webp", ".png", ".jpg", ".jpeg", ".svg"):
        return {"ok": False, "error": "仅支持 webp / png / jpg / svg"}
    if not content:
        return {"ok": False, "error": "空文件"}
    if len(content) > 8 * 1024 * 1024:
        return {"ok": False, "error": "文件过大（上限 8MB）"}

    safe_stem = sub(r"[^\w\-]+", "_", Path(raw_name).stem)[:48] or "portrait"
    if persona_id:
        safe_stem = sub(r"[^\w\-]+", "_", persona_id)[:48] or safe_stem
    out_name = f"{safe_stem}{ext}"
    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PORTRAITS_DIR / out_name
    out_path.write_bytes(content)

    # 同步 server static 副本
    static_portraits = ROOT / "server" / "app" / "static" / "live2d" / "portraits"
    if static_portraits.parent.exists():
        try:
            static_portraits.mkdir(parents=True, exist_ok=True)
            (static_portraits / out_name).write_bytes(content)
        except OSError:
            pass

    public_path = f"/live2d/portraits/{out_name}"
    result: dict[str, Any] = {
        "ok": True,
        "path": public_path,
        "file": out_name,
        "label": _portrait_label(out_name, {}),
    }
    if persona_id:
        bind = update_avatar_binding(persona_id=persona_id, portrait_path=public_path)
        if not bind.get("ok"):
            return bind
        result["persona_id"] = persona_id
        result["bound"] = True
    return result


def update_avatar_binding(
    *,
    persona_id: str,
    visual: str | None = None,
    portrait_path: str | None = None,
    model_id: str | None = None,
) -> dict[str, Any]:
    if not persona_id:
        return {"ok": False, "error": "缺少 persona_id"}
    if not LIVE2D_MANIFEST.exists():
        return {"ok": False, "error": "找不到 live2d/manifest.json"}
    # 备份
    bak = LIVE2D_MANIFEST.with_suffix(".json.bak")
    shutil.copy2(LIVE2D_MANIFEST, bak)
    manifest = json.loads(LIVE2D_MANIFEST.read_text(encoding="utf-8"))
    if visual:
        if visual not in ("live2d", "portrait", "avatar3d"):
            return {"ok": False, "error": "visual 仅支持 live2d / portrait / avatar3d"}
        manifest.setdefault("persona_visual", {})[persona_id] = visual
    if portrait_path is not None:
        manifest.setdefault("portraits", {})[persona_id] = portrait_path
    if model_id is not None:
        models = manifest.get("models") or {}
        if model_id and model_id not in models:
            return {"ok": False, "error": f"未知 Live2D 模型：{model_id}"}
        # 前端 live2d-loader 读的是 persona_map
        manifest.setdefault("persona_map", {})[persona_id] = model_id
        # 清理历史误写字段
        if "persona_model" in manifest and persona_id in (manifest.get("persona_model") or {}):
            del manifest["persona_model"][persona_id]
    _write_json(LIVE2D_MANIFEST, manifest)
    # 同步 server static 副本（若存在）
    static_copy = ROOT / "server" / "app" / "static" / "live2d" / "manifest.json"
    if static_copy.parent.exists():
        try:
            _write_json(static_copy, manifest)
        except OSError:
            pass
    return {"ok": True, "persona_id": persona_id}


def ensure_persona_portrait(
    persona_id: str,
    *,
    sex: str | None = None,
    display_hint: str | None = None,
) -> dict[str, Any]:
    """发布后保证有可访问的立绘文件；缺文件时按性别复制默认肖像并写入 manifest。"""
    from re import sub

    pid = (persona_id or "").strip()
    if not pid:
        return {"ok": False, "error": "缺少 persona_id"}
    safe = sub(r"[^\w\-]+", "_", pid)[:48] or "portrait"
    dest = PORTRAITS_DIR / f"{safe}.webp"
    if dest.exists() and dest.stat().st_size > 0:
        public = f"/live2d/portraits/{dest.name}"
        update_avatar_binding(persona_id=pid, visual="live2d", portrait_path=public)
        return {"ok": True, "path": public, "created": False}

    sex_zh = _infer_sex_zh({"sex": sex or ""}, display_hint or "")
    fallback_name = (
        "PER-ELDER-FEMALE-02.webp" if sex_zh == "女性" else "PER-ELDER-BASIC-01.webp"
    )
    # 优先用已有管理端立绘
    for candidate in (
        "PER-ADM-61A93613.webp" if sex_zh == "女性" else "PER-ADM-02F6DA23.webp",
        fallback_name,
        "PER-HTN-TAXI-01.webp",
    ):
        src = PORTRAITS_DIR / candidate
        if src.exists() and src.stat().st_size > 0:
            PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            static_portraits = ROOT / "server" / "app" / "static" / "live2d" / "portraits"
            if static_portraits.parent.exists():
                try:
                    static_portraits.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dest, static_portraits / dest.name)
                except OSError:
                    pass
            public = f"/live2d/portraits/{dest.name}"
            update_avatar_binding(persona_id=pid, visual="live2d", portrait_path=public)
            return {"ok": True, "path": public, "created": True, "from": candidate}
    return {"ok": False, "error": "找不到可用的默认立绘"}
