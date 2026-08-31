"""管理端：病例导入/删除、账号、场景与数字人形象配置。"""

from __future__ import annotations

import json
import shutil
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
from .db import connect, new_id, utc_now

SCENES_PATH = ROOT / "web" / "data" / "scenes.json"
LIVE2D_MANIFEST = ROOT / "web" / "live2d" / "manifest.json"
PORTRAITS_DIR = ROOT / "web" / "live2d" / "portraits"

ADMIN_USERNAME = "admin"
ADMIN_DEFAULT_PASSWORD = "Admin2026"
ADMIN_DISPLAY_NAME = "系统管理员"


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
    disease_code = disease.get("disease_code") or meta.get("disease_code") or "CUSTOM"
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
    # 去掉空 code，避免污染
    if not entry["code"]:
        entry.pop("code", None)
    hit = next((s for s in scenes if (s.get("id") or s.get("scene_key")) == sid), None)
    if hit:
        # 保留原有 standards / status，除非调用方显式传入
        for keep in ("primaryStandards", "status", "statusLabel"):
            if keep not in scene and hit.get(keep) is not None:
                entry[keep] = hit[keep]
        hit.clear()
        hit.update(entry)
    else:
        scenes.append(entry)
    _write_json(SCENES_PATH, raw)
    return {"ok": True, "scene": entry}


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
                label = p.get("display_label") or pid
                persona_labels[pid] = label
                personas.append({
                    "persona_id": pid,
                    "display_label": label,
                    "case_id": c.get("case_id"),
                    "case_title": case_title,
                    "visual": (manifest.get("persona_visual") or {}).get(pid)
                    or manifest.get("default_visual"),
                    "portrait": (manifest.get("portraits") or {}).get(pid),
                    "model": persona_map.get(pid),
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
            path = f"/live2d/portraits/{p.name}"
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
