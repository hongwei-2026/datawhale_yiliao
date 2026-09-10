"""管理端病例接入：三路径草稿 → 出处/原文预览/设计挂钩 → 人审发布。"""

from __future__ import annotations

import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .agnes import AgnesClient
from .admin_svc import ensure_persona_portrait, import_case_package
from .case_loader import (
    ROOT,
    RUBRIC_BY_SCENE,
    describe_effective_rubric,
    load_effective_rubric,
    load_rubric,
    scene_rubric_status,
)
from .config import get_settings
from .db import new_id

DRAFTS_DIR = ROOT / "data" / "admin_case_drafts"
SCENE_WHITELIST = {
    "informed_consent": {
        "label": "知情同意",
        "rubric_file": "scoring-rubric.json",
        "code": "S1",
    },
    "follow_up": {
        "label": "随访（询问）",
        "rubric_file": "scoring-rubric-followup.json",
        "code": "S5",
    },
}

_SCENES_JSON = ROOT / "web" / "data" / "scenes.json"


def _scenes_file_entries() -> list[dict[str, Any]]:
    try:
        data = json.loads(_SCENES_JSON.read_text(encoding="utf-8"))
        return list(data.get("scenes") or [])
    except Exception:
        return []


def known_scene_meta(scene_key: str) -> dict[str, Any] | None:
    """白名单正式场景，或 scenes.json 中的登记场景（含管理员选定的 test/formal）。"""
    key = (scene_key or "").strip()
    if not key:
        return None
    if key in SCENE_WHITELIST:
        return {
            **SCENE_WHITELIST[key],
            "publishable": True,
            "tier": "formal",
            "scene_key": key,
        }
    for s in _scenes_file_entries():
        sid = str(s.get("id") or s.get("scene_key") or "").strip()
        if sid != key:
            continue
        tier = str(s.get("tier") or "").strip().lower()
        if tier not in ("test", "formal"):
            # 旧数据无 tier：系统预留当测试；其余也默认测试（须管理员显式改正式）
            if s.get("status") == "planned" or s.get("statusLabel") == "预留":
                tier = "test"
            else:
                tier = "test"
        return {
            "scene_key": key,
            "label": str(s.get("name") or s.get("title") or sid),
            "rubric_file": "scoring-rubric.json",
            "code": str(s.get("code") or ""),
            "publishable": tier == "formal",
            "tier": tier,
            "description": str(s.get("description") or s.get("summary") or ""),
        }
    return None


def scene_display_label(scene_key: str) -> str:
    meta = known_scene_meta(scene_key)
    return str((meta or {}).get("label") or scene_key or "")


def scoring_scene_for(scene_key: str) -> str:
    """发布/评分用场景：白名单用自身；测试场景映射到最近生产表。"""
    key = (scene_key or "").strip()
    if key in SCENE_WHITELIST:
        return key
    meta = known_scene_meta(key) or {}
    blob = f"{key} {meta.get('label') or ''} {meta.get('description') or ''}".lower()
    if any(x in blob for x in ("follow", "随访", "依从", "adherence", "用药核查")):
        return "follow_up"
    # 家属协同 / 风险解释 / 其它新场景：默认用知情同意生产表做闭环评分兜底
    return "informed_consent"


def can_publish_scene(scene_key: str) -> bool:
    """已知场景均可发布；测试场景走评分兜底。"""
    return known_scene_meta(scene_key) is not None

# 病种与场景正交：场景=练哪类沟通；病种=挂到哪个试验病种目录
DISEASE_BUILTIN = {
    "T2DM": {
        "name_zh": "2型糖尿病",
        "icd10": "E11",
        "description": "2型糖尿病相关试验病例",
        "introduction": (
            "2型糖尿病是以胰岛素抵抗和/或胰岛素分泌不足为特征的慢性代谢病。"
            "受试者常关心血糖波动、低血糖、饮食运动限制、长期用药与并发症。"
            "沟通时需用通俗话讲清监测与用药时点，避免责备漏服或饮食「不听话」。"
        ),
        "builtin": True,
    },
    "HTN": {
        "name_zh": "高血压",
        "icd10": "I10",
        "description": "高血压相关试验病例",
        "introduction": (
            "原发性高血压以动脉血压持续升高为特征，常需长期服药与家庭血压监测。"
            "受试者可能漏服、自行加降压药，或隐瞒头晕等不适。"
            "随访沟通宜平和追问漏服原因、合并用药与血压记录，避免恐吓踢出试验。"
        ),
        "builtin": True,
    },
}
# 兼容旧引用名
DISEASE_WHITELIST = DISEASE_BUILTIN

DISEASES_EXTRA_PATH = ROOT / "web" / "data" / "diseases-extra.json"

PATH_MODES = ("rough", "material", "human")  # 甲 / 乙 / 丙


def ensure_drafts_dir() -> Path:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    return DRAFTS_DIR


def _load_extra_diseases() -> dict[str, dict[str, Any]]:
    if not DISEASES_EXTRA_PATH.exists():
        return {}
    try:
        raw = json.loads(DISEASES_EXTRA_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in raw.get("diseases") or []:
        code = str(row.get("disease_code") or "").strip().upper()
        if not code or not re.match(r"^[A-Z][A-Z0-9_]{1,15}$", code):
            continue
        out[code] = {
            "name_zh": str(row.get("name_zh") or code).strip() or code,
            "icd10": str(row.get("icd10") or "").strip() or None,
            "description": str(row.get("description") or "").strip() or f"{code} 相关试验病例",
            "introduction": str(row.get("introduction") or row.get("intro") or "").strip() or None,
            "builtin": False,
        }
    return out


def _save_extra_diseases(extra: dict[str, dict[str, Any]]) -> None:
    DISEASES_EXTRA_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": "1.1",
        "note": "管理端「新增病种」写入；含病种介绍 introduction，供带教了解与对话锚定",
        "diseases": [
            {
                "disease_code": code,
                "name_zh": meta.get("name_zh"),
                "icd10": meta.get("icd10"),
                "description": meta.get("description"),
                "introduction": meta.get("introduction"),
            }
            for code, meta in sorted(extra.items())
        ],
    }
    DISEASES_EXTRA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def all_diseases() -> dict[str, dict[str, Any]]:
    """内置 + 管理端新增病种。"""
    merged = {k: dict(v) for k, v in DISEASE_BUILTIN.items()}
    for code, meta in _load_extra_diseases().items():
        if code in merged and merged[code].get("builtin"):
            continue
        merged[code] = meta
    return merged


def list_whitelist_scenes() -> list[dict[str, Any]]:
    return [
        {
            "scene_key": key,
            "label": meta["label"],
            "code": meta["code"],
            "rubric_file": meta["rubric_file"],
        }
        for key, meta in SCENE_WHITELIST.items()
    ]


def list_whitelist_diseases() -> list[dict[str, Any]]:
    return [
        {
            "disease_code": code,
            "name_zh": meta["name_zh"],
            "icd10": meta.get("icd10"),
            "description": meta.get("description"),
            "introduction": meta.get("introduction"),
            "builtin": bool(meta.get("builtin")),
        }
        for code, meta in all_diseases().items()
    ]


def _heuristic_disease_code(name_zh: str, taken: set[str]) -> str:
    """无 AI 时的编码兜底：常见别名表 + 安全后缀。"""
    aliases = {
        "慢性阻塞性肺疾病": "COPD",
        "慢阻肺": "COPD",
        "哮喘": "ASTHMA",
        "冠心病": "CAD",
        "心力衰竭": "HF",
        "心衰": "HF",
        "房颤": "AF",
        "心房颤动": "AF",
        "脑卒中": "STROKE",
        "中风": "STROKE",
        "慢性肾病": "CKD",
        "肾病": "CKD",
        "骨质疏松": "OP",
        "类风湿": "RA",
        "肝癌": "HCC",
        "肺癌": "LUNGCA",
        "乳腺癌": "BREASTCA",
        "抑郁症": "DEPR",
        "焦虑": "ANX",
    }
    key = (name_zh or "").strip()
    base = aliases.get(key)
    if not base:
        # 仅保留已有拉丁字母数字；中文名则用 DX + 短哈希
        latin = re.sub(r"[^A-Za-z0-9]", "", key).upper()[:10]
        if len(latin) >= 2:
            base = latin
        else:
            digest = abs(hash(key)) % 10000
            base = f"DX{digest:04d}"
    base = re.sub(r"[^A-Z0-9_]", "", base.upper())[:12] or "DX0001"
    if not re.match(r"^[A-Z]", base):
        base = f"D{base}"[:12]
    candidate = base
    n = 2
    while candidate in taken or candidate in DISEASE_BUILTIN:
        suffix = str(n)
        candidate = f"{base[: max(1, 12 - len(suffix))]}{suffix}"
        n += 1
        if n > 99:
            candidate = f"DX{abs(hash(key + str(n))) % 10000:04d}"
            break
    return candidate


def _ai_suggest_disease_code(name_zh: str, description: str, taken: set[str]) -> tuple[str | None, str]:
    """调用 Agnes 生成短英文病种码；失败返回 (None, reason)。"""
    try:
        from .agnes import AgnesClient
        from .config import get_settings

        client = AgnesClient(get_settings())
        if not getattr(client, "configured", False):
            return None, "agnes_not_configured"
        prompt = (
            "你是医学试验编码助手。根据病种中文名与介绍，给出一个英文大写病种编码。\n"
            "要求：只输出编码本身，不要解释；2～10 个字符；仅大写字母与数字；以字母开头；"
            "优先用国际通用缩写（如 COPD、T2DM、HTN）。\n"
            f"病种名称：{name_zh}\n"
            f"病种介绍/说明：{description or '无'}\n"
            f"已被占用、请勿使用：{', '.join(sorted(taken)[:40]) or '无'}"
        )
        out = client.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=32,
        )
        if not isinstance(out, dict) or not out.get("ok"):
            return None, str((out or {}).get("error") or "agnes_failed") if isinstance(out, dict) else "agnes_failed"
        text = str(out.get("content") or "")
        m = re.search(r"\b([A-Z][A-Z0-9]{1,15})\b", text.upper())
        if not m:
            return None, "parse_failed"
        code = m.group(1)[:16]
        if code in taken or code in DISEASE_BUILTIN:
            return None, "collision"
        if not re.match(r"^[A-Z][A-Z0-9_]{1,15}$", code):
            return None, "invalid_format"
        return code, "ai"
    except Exception as exc:  # noqa: BLE001
        return None, f"ai_error:{exc}"


def suggest_disease_code(
    name_zh: str,
    *,
    description: str = "",
    prefer_ai: bool = True,
) -> dict[str, Any]:
    name_zh = (name_zh or "").strip()
    if not name_zh:
        return {"ok": False, "error": "请先填写病种名称"}
    taken = set(all_diseases().keys())
    source = "heuristic"
    code = None
    if prefer_ai:
        code, reason = _ai_suggest_disease_code(name_zh, description, taken)
        if code:
            source = "ai"
        else:
            source = f"heuristic_after_{reason}"
    if not code:
        code = _heuristic_disease_code(name_zh, taken)
        if source == "heuristic" or source.startswith("heuristic_after"):
            pass
        else:
            source = "heuristic"
    return {
        "ok": True,
        "disease_code": code,
        "source": source,
        "message": (
            f"AI 已生成编码 {code}"
            if source == "ai"
            else f"已自动生成编码 {code}（AI 不可用时用规则兜底）"
        ),
    }


def upsert_disease(body: dict[str, Any]) -> dict[str, Any]:
    name_zh = str(body.get("name_zh") or body.get("name") or "").strip()
    icd10 = str(body.get("icd10") or "").strip() or None
    description = str(body.get("description") or body.get("summary") or "").strip()
    introduction = str(body.get("introduction") or body.get("intro") or "").strip()
    if not name_zh:
        return {"ok": False, "error": "请填写病种名称"}
    if not introduction:
        return {"ok": False, "error": "请填写病种介绍（这个病是什么、受试者常担心什么），便于带教与对话锚定"}

    code = str(body.get("disease_code") or body.get("code") or "").strip().upper()
    auto = False
    gen_source = None
    # AI 生成编码时把介绍也喂进去
    hint_blob = "\n".join([p for p in (description, introduction) if p])
    if not code:
        sug = suggest_disease_code(name_zh, description=hint_blob, prefer_ai=True)
        if not sug.get("ok"):
            return sug
        code = sug["disease_code"]
        auto = True
        gen_source = sug.get("source")
    if not re.match(r"^[A-Z][A-Z0-9_]{1,15}$", code):
        return {"ok": False, "error": "病种编码须为 2～16 位英文大写/数字/下划线，且以字母开头（如 COPD）；也可留空由系统自动生成"}
    if code in DISEASE_BUILTIN:
        return {"ok": False, "error": f"「{code}」为内置病种，不能覆盖；请留空让系统另生成，或换一个编码"}

    extra = _load_extra_diseases()
    if auto and code in extra:
        sug = suggest_disease_code(name_zh + "_", description=hint_blob, prefer_ai=False)
        code = sug["disease_code"]
        gen_source = sug.get("source")

    extra[code] = {
        "name_zh": name_zh,
        "icd10": icd10,
        "description": description or f"{name_zh}相关试验病例",
        "introduction": introduction,
        "builtin": False,
    }
    _save_extra_diseases(extra)
    how = ""
    if auto:
        how = f"；编码 {code} 由{'AI' if gen_source == 'ai' else '系统'}自动生成"
    return {
        "ok": True,
        "message": f"病种「{name_zh}」已保存{how}",
        "auto_code": auto,
        "code_source": gen_source,
        "disease": {
            "disease_code": code,
            "name_zh": name_zh,
            "icd10": icd10,
            "description": extra[code]["description"],
            "introduction": introduction,
            "builtin": False,
        },
        "diseases": list_whitelist_diseases(),
    }


def delete_disease(disease_code: str) -> dict[str, Any]:
    code = (disease_code or "").strip().upper()
    if not code:
        return {"ok": False, "error": "缺少病种编码"}
    if code in DISEASE_BUILTIN:
        return {"ok": False, "error": "内置病种不可删除"}
    extra = _load_extra_diseases()
    if code not in extra:
        return {"ok": False, "error": "未找到该病种"}
    del extra[code]
    _save_extra_diseases(extra)
    return {"ok": True, "message": f"已删除病种 {code}", "diseases": list_whitelist_diseases()}


def resolve_disease_code(
    *,
    fields: dict[str, Any] | None = None,
    scene_key: str | None = None,
    source_text: str = "",
) -> str:
    """显式病种优先；否则从文案推断。场景不能单独决定病种（随访也可能是糖尿病）。"""
    fields = fields or {}
    catalog = all_diseases()
    raw = (fields.get("disease_code") or "").strip().upper()
    if raw in catalog:
        return raw
    blob = " ".join(
        [
            str(fields.get("disease_name") or ""),
            str(fields.get("visit_context") or ""),
            str(fields.get("protocol_title") or ""),
            source_text or "",
            json.dumps(fields.get("locked_facts") or [], ensure_ascii=False),
        ]
    )
    if re.search(r"高血压|降压|ARB|血压|HTN|hypertension", blob, re.I):
        return "HTN"
    if re.search(r"糖尿|降糖|血糖|T2DM|diabetes", blob, re.I):
        return "T2DM"
    # 最后才用演示默认：知情多挂糖尿病试验，随访多挂高血压试验
    if scene_key == "follow_up":
        return "HTN"
    return "T2DM"


def design_hooks_for_scene(scene_key: str, draft_fields: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = known_scene_meta(scene_key)
    if not meta:
        return {
            "ok": False,
            "scene_ok": False,
            "items": [
                {
                    "id": "scene",
                    "label": "场景",
                    "status": "fail",
                    "detail": f"未知场景：{scene_key or '（空）'}",
                }
            ],
        }
    # 测试场景：管理端可写草稿；不能发布到学员端（须管理员设为正式）
    if not meta.get("publishable"):
        return {
            "ok": False,
            "scene_ok": True,
            "items": [
                {
                    "id": "scene",
                    "label": "练哪一类沟通",
                    "status": "warn",
                    "detail": (
                        f"已选测试场景「{meta.get('label')}」。"
                        "可继续写材料/草稿；要进学员端请在「新增场景」设为正式，或改选正式场景。"
                    ),
                },
                {
                    "id": "rubric_pack",
                    "label": "评分包（场景×病种）",
                    "status": "fail",
                    "detail": "测试场景不能发布到学员端（仅正式可进）",
                },
            ],
        }
    scoring_key = scoring_scene_for(scene_key)
    score_meta = SCENE_WHITELIST[scoring_key]
    fields = draft_fields or {}
    disease_code = resolve_disease_code(fields=fields, scene_key=scoring_key)
    pack_status = scene_rubric_status(scoring_key)
    rubric = load_effective_rubric(scoring_key, disease_code)
    pack = describe_effective_rubric(rubric)
    groups = rubric.get("groups") or []
    group_names = [g.get("name") or g.get("id") for g in groups]
    persona = fields.get("persona") or {}
    session = fields.get("session_script") or {}
    facts = fields.get("locked_facts") or []
    concerns = fields.get("key_concerns") or []
    openings = fields.get("openings") or session.get("patient_greeting_seeds") or []

    def _st(ok: bool, warn: bool = False) -> str:
        if ok:
            return "ok"
        return "warn" if warn else "fail"

    dim_txt = "、".join(
        f"{d.get('name') or d.get('id')} {int(round(100 * float(d.get('weight') or 0)))}%"
        for d in (pack.get("dimensions") or [])
        if not d.get("isGate") and d.get("weight") is not None
    )
    ov_note = (
        f"已叠加病种 {disease_code}（v{pack.get('overlay_version') or '?'}）"
        if pack.get("overlay_applied")
        else f"病种 {disease_code}：暂无专用叠加，先用场景通用表"
    )
    if pack.get("overlay_disabled_ids"):
        ov_note += f"；已关闭 {', '.join(pack['overlay_disabled_ids'])}"

    if scene_key in SCENE_WHITELIST:
        scene_item = {
            "id": "scene",
            "label": "练哪一类沟通",
            "status": "ok",
            "detail": f"已选：{meta['label']}（正式 · 系统可练）",
        }
        pack_detail = (
            f"基表 {pack.get('rubric_file')} · 版本 {pack.get('version')} · "
            f"{ov_note} · 启用小项 {pack.get('enabled_item_count')} · 权重：{dim_txt}"
        )
    else:
        scene_item = {
            "id": "scene",
            "label": "练哪一类沟通",
            "status": "warn",
            "detail": (
                f"已选正式场景「{meta.get('label')}」。可进学员端；"
                f"评分暂用「{score_meta['label']}」生产表兜底，对话仍按本场景。"
            ),
        }
        pack_detail = (
            f"兜底评分场景 {score_meta['label']} · 基表 {pack.get('rubric_file')} · "
            f"版本 {pack.get('version')} · {ov_note} · 启用小项 {pack.get('enabled_item_count')}"
        )

    items = [
        scene_item,
        {
            "id": "rubric_pack",
            "label": "评分包（场景×病种）",
            "status": "ok" if pack_status.get("ok") else "fail",
            "detail": pack_detail,
            "pack": pack,
            "pack_status": pack_status,
        },
        {
            "id": "rubric",
            "label": "练完怎么对照检查",
            "status": "ok",
            "detail": "大类包括：" + "、".join(group_names[:6]),
            "groups": groups,
        },
        {
            "id": "emphasis",
            "label": "本局侧重点",
            "status": "ok" if pack.get("trainee_brief") else "warn",
            "detail": pack.get("trainee_brief") or "未配置病种侧重点文案（仍可用通用表）",
        },
        {
            "id": "progress",
            "label": "练习时侧边进度",
            "status": "ok",
            "detail": "跟评分场景同一套大类，不会另起一套",
        },
        {
            "id": "emotion",
            "label": "这个人容易紧张吗",
            "status": _st(bool(persona.get("emotion_baseline")), warn=True),
            "detail": persona.get("emotion_baseline") or "还没写，可后补",
        },
        {
            "id": "opening",
            "label": "一开口可能说什么",
            "status": _st(bool(openings or session.get("patient_greeting")), warn=True),
            "detail": f"已有 {len(openings) if isinstance(openings, list) else 0} 句开场参考"
            if openings
            else "还没写开场",
        },
        {
            "id": "concerns",
            "label": "TA 担心什么",
            "status": _st(bool(concerns or fields.get("dialogue_hints")), warn=True),
            "detail": f"{len(concerns)} 条担心点" if concerns else "还没写担心点",
        },
        {
            "id": "facts",
            "label": "必须记住的事实",
            "status": _st(bool(facts), warn=True),
            "detail": f"{len(facts)} 条" if facts else "建议至少写清关键事实",
        },
        {
            "id": "avatar",
            "label": "形象（数字人）",
            "status": "ok",
            "detail": "可以先不绑；发布后也能在「形象」分页里再绑",
        },
    ]
    blocking = [i for i in items if i["status"] == "fail"]
    return {
        "ok": len(blocking) == 0,
        "scene_ok": True,
        "scene_key": scene_key,
        "scene_label": meta["label"],
        "scoring_scene_key": scoring_key,
        "disease_code": disease_code,
        "rubric_file": score_meta["rubric_file"],
        "group_names": group_names,
        "scoring_pack": pack,
        "items": items,
    }


ALLOWED_MATERIAL_EXTS = {".txt", ".docx", ".pdf"}
ZIP_SKIP_PREFIXES = ("__macosx/",)
ZIP_SKIP_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}
TEXTISH_PREVIEW_EXTS = {
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".tsv",
    ".xml",
    ".html",
    ".htm",
    ".log",
    ".ini",
    ".cfg",
    ".yml",
    ".yaml",
}
PREVIEW_MAX_CHARS = 600


def _preview_clip(text: str, limit: int = PREVIEW_MAX_CHARS) -> str:
    s = (text or "").replace("\r\n", "\n").strip()
    if len(s) <= limit:
        return s
    return s[:limit].rstrip() + "…"


def _soft_text_preview(raw: bytes, ext: str) -> str:
    """尽量抽出可读预览，供人工审核看清「刷掉的是什么」。"""
    if not raw:
        return "（空文件）"
    if ext in TEXTISH_PREVIEW_EXTS or ext in ALLOWED_MATERIAL_EXTS:
        try:
            return _preview_clip(raw.decode("utf-8", errors="replace"))
        except Exception:
            pass
    # 二进制：展示可读片段 + 十六进制头
    ascii_bits = "".join(chr(b) if 32 <= b < 127 else "." for b in raw[:80])
    hex_bits = " ".join(f"{b:02x}" for b in raw[:24])
    return f"[二进制，无法作为病例正文]\n可读片段：{ascii_bits}\n十六进制头：{hex_bits}"


def _file_report(
    *,
    path: str,
    action: str,
    reason: str,
    bytes_n: int,
    preview: str = "",
    chars: int = 0,
    text: str = "",
    format_hint: str | None = None,
    includable: bool = False,
) -> dict[str, Any]:
    return {
        "path": path,
        "action": action,  # keep | reject | skip
        "reason": reason,
        "bytes": bytes_n,
        "preview": preview or "",
        "chars": chars,
        "text": text or "",
        "format": format_hint,
        "includable": bool(includable),
    }


def extract_text_from_bytes(filename: str, content: bytes) -> dict[str, Any]:
    name = (filename or "upload.bin").strip()
    lower = name.lower()
    if lower.endswith(".zip"):
        return _extract_zip(name, content)
    return _extract_single_as_report(name, content)


def merge_material_uploads(items: list[tuple[str, bytes]]) -> dict[str, Any]:
    """多文件上传：逐个扫描后合并报告，供人工审核。"""
    if not items:
        return {"ok": False, "error": "未收到文件", "files": [], "summary": _summarize_files([])}

    reports: list[dict[str, Any]] = []
    names: list[str] = []
    for filename, content in items:
        name = (filename or "upload.bin").strip() or "upload.bin"
        names.append(name)
        one = extract_text_from_bytes(name, content or b"")
        for f in one.get("files") or []:
            rep = dict(f)
            path = str(rep.get("path") or name)
            # 多文件时给路径加来源前缀，避免重名；ZIP 内条目标成 zip名/内路径
            if name.lower().endswith(".zip"):
                if path.replace("\\", "/") != name.replace("\\", "/"):
                    rep["path"] = f"{name}/{path}"
                else:
                    rep["path"] = path
            elif len(items) > 1:
                rep["path"] = path
            reports.append(rep)

    summary = _summarize_files(reports)
    kept_text = _merge_kept_text(reports)
    label = "、".join(names[:3]) + ("…" if len(names) > 3 else "")
    if summary["kept"] == 0:
        return {
            "ok": False,
            "error": "没有可用的 Word/TXT/PDF（垃圾文件已列出原因）",
            "format": "multi",
            "files": reports,
            "summary": summary,
            "filename": label,
            "text": "",
        }
    return {
        "ok": True,
        "text": kept_text,
        "format": "multi" if len(items) > 1 else (reports[0].get("format") if reports else "bin"),
        "files": reports,
        "summary": summary,
        "filename": label,
        "warning": (
            f"已保留 {summary['kept']} 个；刷掉 {summary['rejected']} 个；忽略 {summary['skipped']} 个"
            if (summary["rejected"] or summary["skipped"] or len(items) > 1)
            else None
        ),
    }


def _extract_allowed_body(name_lower: str, content: bytes) -> dict[str, Any]:
    """仅处理允许扩展名；成功返回 ok+text+format。"""
    if name_lower.endswith(".doc") and not name_lower.endswith(".docx"):
        return {"ok": False, "error": "不支持旧版 .doc，请另存为 .docx"}
    if name_lower.endswith(".txt"):
        text = content.decode("utf-8", errors="replace")
        if not text.strip():
            return {"ok": False, "error": "TXT 为空"}
        return {"ok": True, "text": text, "format": "txt"}
    if name_lower.endswith(".docx"):
        try:
            text = _docx_to_text(content)
            if not text.strip():
                return {"ok": False, "error": "Word 未抽出文字"}
            return {"ok": True, "text": text, "format": "docx"}
        except Exception as exc:
            return {"ok": False, "error": f"Word 解析失败：{exc}"}
    if name_lower.endswith(".pdf"):
        try:
            text = _pdf_to_text(content)
            if not text.strip():
                return {"ok": False, "error": "PDF 未抽出文字（可能是扫描件），请改 Word/TXT"}
            return {"ok": True, "text": text, "format": "pdf"}
        except Exception as exc:
            return {"ok": False, "error": f"PDF 解析失败：{exc}"}
    return {
        "ok": False,
        "error": "材料仅支持 Word（.docx）、TXT、PDF，或 ZIP（包内也只能是这三类）",
    }


def _extract_single_material(name: str, content: bytes) -> dict[str, Any]:
    """兼容旧调用：只返回 ok/text/error。"""
    return _extract_allowed_body(name.lower().strip(), content)


def _summarize_files(files: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"kept": 0, "rejected": 0, "skipped": 0}
    alias = {"keep": "kept", "reject": "rejected", "skip": "skipped"}
    for f in files:
        key = alias.get(str(f.get("action") or ""))
        if key:
            summary[key] += 1
    return summary


def _merge_kept_text(files: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for f in files:
        if f.get("action") != "keep":
            continue
        body = (f.get("text") or "").strip()
        if not body:
            continue
        path = f.get("path") or "材料"
        parts.append(f"===== {path} =====\n{body}")
    return "\n\n".join(parts)


def _extract_single_as_report(filename: str, content: bytes) -> dict[str, Any]:
    path = filename or "upload.bin"
    lower = path.lower()
    base = Path(lower).name
    ext = Path(lower).suffix
    nbytes = len(content or b"")

    if base in ZIP_SKIP_NAMES or any(lower.startswith(p) for p in ZIP_SKIP_PREFIXES):
        rep = _file_report(
            path=path,
            action="skip",
            reason="系统/缓存垃圾文件，自动忽略",
            bytes_n=nbytes,
            preview=_soft_text_preview(content, ext),
        )
        return {
            "ok": False,
            "error": "上传的是系统垃圾文件，请改传 Word / TXT / PDF",
            "format": ext.lstrip(".") or "bin",
            "files": [rep],
            "summary": _summarize_files([rep]),
            "filename": filename,
        }

    if ext == ".doc":
        rep = _file_report(
            path=path,
            action="reject",
            reason="旧版 .doc 不支持，请另存为 .docx 后再传",
            bytes_n=nbytes,
            preview=_soft_text_preview(content, ext),
        )
        return {
            "ok": False,
            "error": rep["reason"],
            "format": "doc",
            "files": [rep],
            "summary": _summarize_files([rep]),
            "filename": filename,
        }

    if ext not in ALLOWED_MATERIAL_EXTS:
        soft = _soft_text_preview(content, ext)
        includable = bool(soft.strip()) and ext in TEXTISH_PREVIEW_EXTS and nbytes > 0
        rep = _file_report(
            path=path,
            action="reject",
            reason=f"扩展名 {ext or '（无）'} 不在允许列表（仅 .txt / .docx / .pdf）",
            bytes_n=nbytes,
            preview=soft,
            chars=len(soft),
            text=soft if includable else "",
            includable=includable,
        )
        return {
            "ok": False,
            "error": rep["reason"],
            "format": ext.lstrip(".") or "bin",
            "files": [rep],
            "summary": _summarize_files([rep]),
            "filename": filename,
        }

    single = _extract_allowed_body(lower, content)
    if not single.get("ok"):
        rep = _file_report(
            path=path,
            action="reject",
            reason=str(single.get("error") or "无法提取正文"),
            bytes_n=nbytes,
            preview=_soft_text_preview(content, ext),
        )
        return {
            "ok": False,
            "error": rep["reason"],
            "format": single.get("format") or ext.lstrip("."),
            "files": [rep],
            "summary": _summarize_files([rep]),
            "filename": filename,
        }

    text = str(single.get("text") or "")
    rep = _file_report(
        path=path,
        action="keep",
        reason=f"符合允许格式（{ext}），已提取正文",
        bytes_n=nbytes,
        preview=_preview_clip(text),
        chars=len(text),
        text=text,
        format_hint=str(single.get("format") or ext.lstrip(".")),
        includable=True,
    )
    return {
        "ok": True,
        "text": text,
        "format": rep["format"],
        "files": [rep],
        "summary": _summarize_files([rep]),
        "filename": filename,
    }


def _classify_zip_entry(inner_name: str) -> tuple[str, str]:
    """返回 (kind, reason_stub)。kind: skip | reject | keep_candidate"""
    norm = inner_name.replace("\\", "/").strip()
    lower = norm.lower()
    base = Path(lower).name
    if not base or lower.endswith("/"):
        return "skip", "目录项，忽略"
    if any(lower.startswith(p) for p in ZIP_SKIP_PREFIXES):
        return "skip", "macOS 资源叉 / __MACOSX，系统垃圾，自动忽略"
    if base in ZIP_SKIP_NAMES:
        return "skip", f"系统垃圾文件（{base}），自动忽略"
    ext = Path(lower).suffix
    if ext == ".doc":
        return "reject", "旧版 .doc 不支持，请改为 .docx"
    if ext not in ALLOWED_MATERIAL_EXTS:
        return "reject", f"扩展名 {ext or '（无）'} 不在允许列表（仅 .txt / .docx / .pdf）"
    return "keep_candidate", f"符合允许格式（{ext}）"


def _extract_zip(filename: str, content: bytes) -> dict[str, Any]:
    import io

    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        return {"ok": False, "error": "ZIP 无法打开或已损坏"}

    reports: list[dict[str, Any]] = []
    with zf:
        for inner in sorted(zf.namelist()):
            kind, reason = _classify_zip_entry(inner)
            lower = inner.replace("\\", "/").lower()
            ext = Path(lower).suffix
            if kind == "skip":
                # 仍尝试读预览（很短），方便人工理解
                try:
                    raw = zf.read(inner) if not inner.endswith("/") else b""
                except Exception:
                    raw = b""
                reports.append(
                    _file_report(
                        path=inner,
                        action="skip",
                        reason=reason,
                        bytes_n=len(raw),
                        preview=_soft_text_preview(raw, ext) if raw else "（目录或空）",
                    )
                )
                continue

            try:
                raw = zf.read(inner)
            except Exception as exc:
                reports.append(
                    _file_report(
                        path=inner,
                        action="reject",
                        reason=f"ZIP 内读取失败：{exc}",
                        bytes_n=0,
                        preview="",
                    )
                )
                continue

            nbytes = len(raw)
            if kind == "reject":
                soft = _soft_text_preview(raw, ext)
                includable = (
                    ext in TEXTISH_PREVIEW_EXTS
                    and bool(soft.strip())
                    and soft != "（空文件）"
                    and not soft.startswith("[二进制")
                )
                reports.append(
                    _file_report(
                        path=inner,
                        action="reject",
                        reason=reason,
                        bytes_n=nbytes,
                        preview=soft,
                        chars=len(soft),
                        text=raw.decode("utf-8", errors="replace") if includable else "",
                        includable=includable,
                    )
                )
                continue

            # keep_candidate
            if nbytes == 0:
                reports.append(
                    _file_report(
                        path=inner,
                        action="reject",
                        reason="空文件，没有可提取正文",
                        bytes_n=0,
                        preview="（空文件）",
                    )
                )
                continue

            single = _extract_allowed_body(Path(inner).name.lower(), raw)
            if not single.get("ok"):
                reports.append(
                    _file_report(
                        path=inner,
                        action="reject",
                        reason=f"格式允许但提取失败：{single.get('error')}",
                        bytes_n=nbytes,
                        preview=_soft_text_preview(raw, ext),
                    )
                )
                continue

            text = str(single.get("text") or "")
            reports.append(
                _file_report(
                    path=inner,
                    action="keep",
                    reason=f"{reason}，已提取正文",
                    bytes_n=nbytes,
                    preview=_preview_clip(text),
                    chars=len(text),
                    text=text,
                    format_hint=str(single.get("format") or ext.lstrip(".")),
                    includable=True,
                )
            )

    summary = _summarize_files(reports)
    kept_text = _merge_kept_text(reports)
    if summary["kept"] == 0:
        return {
            "ok": False,
            "error": "ZIP 内没有可用的 Word/TXT/PDF（垃圾文件已列出原因，请改打包后重传）",
            "format": "zip",
            "files": reports,
            "summary": summary,
            "filename": filename,
            "text": "",
        }
    return {
        "ok": True,
        "text": kept_text,
        "format": "zip",
        "files": reports,
        "summary": summary,
        "filename": filename,
        "warning": (
            f"已保留 {summary['kept']} 个文件；刷掉 {summary['rejected']} 个；忽略 {summary['skipped']} 个系统垃圾"
            if (summary["rejected"] or summary["skipped"])
            else None
        ),
    }


def _docx_to_text(content: bytes) -> str:
    import io

    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    parts: list[str] = []
    for p in root.findall(".//w:p", ns):
        runs = [t.text or "" for t in p.findall(".//w:t", ns)]
        line = "".join(runs).strip()
        if line:
            parts.append(line)
    return "\n".join(parts)


def _pdf_to_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
        import io

        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except ImportError:
        raise RuntimeError("未安装 pypdf，请粘贴正文或改用 Word/TXT")


def _draft_path(draft_id: str) -> Path:
    return ensure_drafts_dir() / f"{draft_id}.json"


def list_drafts() -> list[dict[str, Any]]:
    ensure_drafts_dir()
    items = []
    for p in sorted(DRAFTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        source = d.get("source") or {}
        items.append(
            {
                "draft_id": d.get("draft_id"),
                "mode": d.get("mode"),
                "scene_key": d.get("scene_key"),
                "disease_code": (d.get("fields") or {}).get("disease_code") or "",
                "display_name": (d.get("fields") or {}).get("display_name") or "未命名草稿",
                "status": d.get("status") or "draft",
                "source_filename": source.get("filename") or "",
                "published_case_id": d.get("published_case_id") or "",
                "updated_at": d.get("updated_at"),
                "created_at": d.get("created_at"),
            }
        )
    return items


def create_intake_draft(
    *,
    mode: str,
    scene_key: str,
    display_name: str,
    source_text: str,
    source_filename: str | None = None,
    file_summary: dict[str, Any] | None = None,
    disease_code: str | None = None,
) -> dict[str, Any]:
    """材料确认后先落草稿（不做 AI），出现在草稿箱，待人审后再整理。"""
    mode = (mode or "").strip() or "material"
    scene_key = (scene_key or "").strip()
    if mode not in PATH_MODES:
        return {"ok": False, "error": "mode 须为 rough / material / human"}
    if not known_scene_meta(scene_key):
        return {"ok": False, "error": f"未知场景：{scene_key or '（空）'}"}
    text = (source_text or "").strip()
    if len(text) < 20:
        return {"ok": False, "error": "请先确认纳入足够正文（至少约 20 字）"}
    name = (display_name or "").strip() or _guess_name(text)
    resolved_disease = resolve_disease_code(
        fields={"disease_code": disease_code or ""},
        scene_key=scene_key,
        source_text=text,
    )
    draft_id = f"DRAFT-{new_id()[:10].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    draft = {
        "draft_id": draft_id,
        "mode": mode,
        "scene_key": scene_key,
        "status": "source_ready",
        "created_at": now,
        "updated_at": now,
        "source": {
            "filename": source_filename or "材料上传",
            "text": text,
            "file_summary": file_summary or {},
        },
        "expanded_text": text,
        "fields": {
            "display_name": name,
            "disease_code": resolved_disease,
            "disease_name": all_diseases()[resolved_disease]["name_zh"],
        },
        "design_hooks": design_hooks_for_scene(scene_key, {"display_name": name}),
        "reviewed_ack": False,
    }
    save_draft(draft)
    return {"ok": True, "draft": draft, "phase": "intake"}


def get_draft(draft_id: str) -> dict[str, Any] | None:
    path = _draft_path(draft_id)
    if not path.exists():
        return None
    try:
        draft = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    # 场景可能已从测试改为正式：打开时重算挂钩，避免草稿卡在旧 fail
    if draft and draft.get("status") != "published":
        hooks = design_hooks_for_scene(draft.get("scene_key") or "", draft.get("fields") or {})
        old = draft.get("design_hooks") or {}
        if hooks.get("ok") != old.get("ok") or hooks.get("items") != old.get("items"):
            draft["design_hooks"] = hooks
            save_draft(draft)
        else:
            draft["design_hooks"] = hooks
    return draft


def refresh_draft_hooks_for_scene(scene_key: str) -> int:
    """场景性质变更后，刷新挂该场景的未发布草稿挂钩。"""
    key = (scene_key or "").strip()
    if not key:
        return 0
    n = 0
    ensure_drafts_dir()
    for path in DRAFTS_DIR.glob("DRAFT-*.json"):
        try:
            draft = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if draft.get("status") == "published":
            continue
        if (draft.get("scene_key") or "").strip() != key:
            continue
        draft["design_hooks"] = design_hooks_for_scene(key, draft.get("fields") or {})
        save_draft(draft)
        n += 1
    return n


def save_draft(draft: dict[str, Any]) -> dict[str, Any]:
    draft["updated_at"] = datetime.now(timezone.utc).isoformat()
    path = _draft_path(draft["draft_id"])
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return draft


def delete_draft(draft_id: str) -> dict[str, Any]:
    path = _draft_path(draft_id)
    if path.exists():
        path.unlink()
    return {"ok": True}


def create_and_generate(
    *,
    mode: str,
    scene_key: str,
    display_name: str,
    source_text: str,
    source_filename: str | None = None,
    agnes: AgnesClient | None = None,
    phase: str | None = None,
    disease_code: str | None = None,
) -> dict[str, Any]:
    """phase=expand：写大概只扩写；默认 material/human 直接结构化。rough 默认走 expand。"""
    mode = (mode or "").strip()
    scene_key = (scene_key or "").strip()
    if mode not in PATH_MODES:
        return {"ok": False, "error": "mode 须为 rough / material / human"}
    if not known_scene_meta(scene_key):
        return {"ok": False, "error": f"未知场景：{scene_key or '（空）'}"}
    text = (source_text or "").strip()
    if len(text) < 20:
        return {"ok": False, "error": "请提供更完整的输入（至少约 20 字）"}
    name = (display_name or "").strip() or _guess_name(text)
    resolved_disease = resolve_disease_code(
        fields={"disease_code": disease_code or ""},
        scene_key=scene_key,
        source_text=text,
    )

    do_expand_first = (phase == "expand") or (mode == "rough" and phase != "structure")
    if do_expand_first and mode == "rough":
        expanded = _expand_narrative(
            display_name=name,
            scene_key=scene_key,
            source_text=text,
            agnes=agnes,
        )
        draft_id = f"DRAFT-{new_id()[:10].upper()}"
        now = datetime.now(timezone.utc).isoformat()
        draft = {
            "draft_id": draft_id,
            "mode": mode,
            "scene_key": scene_key,
            "status": "expand_review",
            "created_at": now,
            "updated_at": now,
            "source": {
                "filename": source_filename or "用户大概",
                "text": text,
            },
            "expanded_text": expanded,
            "fields": {
                "display_name": name,
                "disease_code": resolved_disease,
                "disease_name": all_diseases()[resolved_disease]["name_zh"],
            },
            "design_hooks": design_hooks_for_scene(scene_key, {"display_name": name}),
            "reviewed_ack": False,
        }
        save_draft(draft)
        return {"ok": True, "draft": draft, "phase": "expand"}

    fields = _generate_fields(
        mode=mode,
        scene_key=scene_key,
        display_name=name,
        source_text=text,
        agnes=agnes,
    )
    fields["disease_code"] = resolved_disease
    fields["disease_name"] = fields.get("disease_name") or all_diseases()[resolved_disease]["name_zh"]
    hooks = design_hooks_for_scene(scene_key, fields)
    draft_id = f"DRAFT-{new_id()[:10].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    draft = {
        "draft_id": draft_id,
        "mode": mode,
        "scene_key": scene_key,
        "status": "review",
        "created_at": now,
        "updated_at": now,
        "source": {
            "filename": source_filename or ("粘贴正文" if mode == "material" else "用户输入"),
            "text": text,
        },
        "expanded_text": text if mode != "rough" else text,
        "fields": fields,
        "design_hooks": hooks,
        "reviewed_ack": False,
    }
    save_draft(draft)
    return {"ok": True, "draft": draft, "phase": "structure"}


def structure_draft(draft_id: str, *, agnes: AgnesClient | None = None, expanded_text: str | None = None) -> dict[str, Any]:
    """扩写审核通过后：把案例文稿整理成练习卡片（规范化）。"""
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    if draft.get("status") == "published":
        return {"ok": False, "error": "已发布草稿不可再整理"}
    name = (draft.get("fields") or {}).get("display_name") or "新受试者"
    text = (expanded_text if expanded_text is not None else draft.get("expanded_text") or "").strip()
    if not text:
        text = (draft.get("source") or {}).get("text") or ""
    text = text.strip()
    if len(text) < 20:
        return {"ok": False, "error": "案例文稿太短，请先改完整再整理"}
    draft["expanded_text"] = text
    src = draft.setdefault("source", {})
    if isinstance(src, dict) and text:
        src["text"] = text
    mode = draft.get("mode") or "material"
    if draft.get("fields"):
        _push_field_version(draft, note="整理前快照", actor="system")
    fields = _generate_fields(
        mode=mode if mode in PATH_MODES else "material",
        scene_key=draft["scene_key"],
        display_name=name,
        source_text=text,
        agnes=agnes,
    )
    draft["fields"] = fields
    draft["design_hooks"] = design_hooks_for_scene(draft["scene_key"], fields)
    draft["status"] = "review"
    _push_field_version(draft, note="初次整理成练习卡片", actor="system")
    save_draft(draft)
    return {"ok": True, "draft": draft}


MAX_FIELD_VERSIONS = 20

KIND_TO_FIELD = {
    "facts": "locked_facts",
    "concerns": "key_concerns",
    "openings": "openings",
    "scoring": "scoring_hints",
    "forbidden": "forbidden",
}


def _push_field_version(draft: dict[str, Any], *, note: str, actor: str = "system") -> dict[str, Any]:
    versions = draft.setdefault("field_versions", [])
    snap = {
        "version_id": f"V-{new_id()[:8].upper()}",
        "at": datetime.now(timezone.utc).isoformat(),
        "note": (note or "").strip() or "快照",
        "actor": actor,
        "fields": json.loads(json.dumps(draft.get("fields") or {}, ensure_ascii=False)),
        "expanded_text": draft.get("expanded_text"),
    }
    versions.append(snap)
    draft["field_versions"] = versions[-MAX_FIELD_VERSIONS:]
    return snap


def list_field_versions(draft_id: str) -> dict[str, Any]:
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    versions = draft.get("field_versions") or []
    brief = [
        {
            "version_id": v.get("version_id"),
            "at": v.get("at"),
            "note": v.get("note"),
            "actor": v.get("actor"),
        }
        for v in reversed(versions)
    ]
    return {"ok": True, "versions": brief, "count": len(brief)}


def restore_field_version(draft_id: str, version_id: str) -> dict[str, Any]:
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    if draft.get("status") == "published":
        return {"ok": False, "error": "已发布草稿不可回溯"}
    version_id = (version_id or "").strip()
    hit = next((v for v in (draft.get("field_versions") or []) if v.get("version_id") == version_id), None)
    if not hit:
        return {"ok": False, "error": "找不到该版本"}
    _push_field_version(draft, note=f"恢复前快照（将回到 {version_id}）", actor="teacher")
    draft["fields"] = json.loads(json.dumps(hit.get("fields") or {}, ensure_ascii=False))
    if hit.get("expanded_text") is not None:
        draft["expanded_text"] = hit.get("expanded_text")
    draft["design_hooks"] = design_hooks_for_scene(draft["scene_key"], draft.get("fields") or {})
    draft["reviewed_ack"] = False
    draft["status"] = "review"
    save_draft(draft)
    return {"ok": True, "draft": draft, "restored_version_id": version_id}


def revise_draft_with_feedback(
    draft_id: str,
    *,
    instruction: str,
    targets: list[dict[str, Any]] | None = None,
    agnes: AgnesClient | None = None,
) -> dict[str, Any]:
    """人审时：点选条款 + 说明对错/多了少了 → AI 改卡片；改前自动存版本。"""
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    if draft.get("status") == "published":
        return {"ok": False, "error": "已发布草稿不可再改"}
    note = (instruction or "").strip()
    if len(note) < 2:
        return {"ok": False, "error": "写一句大概也行，例如「少了」「这条不对」「开场太假」"}
    fields = draft.get("fields") or {}
    if not fields:
        return {"ok": False, "error": "还没有练习卡片，请先整理"}
    targets = targets or []
    target_lines = []
    for t in targets:
        kind = (t.get("kind") or "").strip()
        idx = t.get("idx")
        text = (t.get("text") or "").strip()
        label = {
            "facts": "必须记住的事实",
            "concerns": "TA 担心什么",
            "openings": "一开口可能说什么",
            "scoring": "和练习检查的关系",
            "forbidden": "禁止乱编",
            "name": "怎么称呼",
            "visit": "今天来干嘛",
        }.get(kind, kind or "条款")
        target_lines.append(f"- [{label}] #{idx if idx is not None else '?'}：{text or '（未附原文）'}")

    _push_field_version(draft, note=f"AI 改前：{note[:40]}", actor="teacher")

    source_text = (draft.get("expanded_text") or (draft.get("source") or {}).get("text") or "")[:6000]
    scene_label = scene_display_label(draft.get("scene_key") or "")
    compact = {
        "display_name": fields.get("display_name"),
        "visit_context": fields.get("visit_context"),
        "locked_facts": fields.get("locked_facts") or [],
        "key_concerns": fields.get("key_concerns") or [],
        "openings": fields.get("openings") or [],
        "scoring_hints": fields.get("scoring_hints") or [],
        "forbidden": fields.get("forbidden") or [],
    }
    vague = _is_vague_revise_note(note)

    new_fields = None
    if agnes and agnes.configured:
        system = (
            "你是临床试验沟通训练的病例编辑助手。老师在人审练习卡片，可能只给一句很懒的大概意见。"
            "只输出严格 JSON 对象（不要 Markdown），字段："
            "display_name, visit_context, locked_facts[], key_concerns[], openings[], forbidden[], scoring_hints[]。"
            "列表项格式：{text, source, reason, confidence, source_span?}。"
            f"场景固定为「{scene_label}」。"
            "核心规则："
            "1) 老师说得具体（改成…/删掉…）→ 严格照做；"
            "2) 老师只说「少了/不对/有问题/补一下」等笼统话 → 必须对照「案例文稿」自行找出遗漏或错误，"
            "写出完整可练的具体条款（漏服次数、不适、隐瞒、开场原话等），禁止输出「内容」「待补充」「缺少」这类空壳；"
            "3) 补缺时优先从文稿「真实情况 / 人物设定 / 什么时候说什么」抽取；"
            "4) 未点名要改的条款尽量保留；不要与文稿矛盾地编造数字；不确定标 confidence=guess，source 写「案例文稿」。"
        )
        user = (
            f"案例文稿（权威对照，老师懒得细说时你必须靠它补细）：\n{source_text}\n\n"
            f"当前练习卡片 JSON：\n{json.dumps(compact, ensure_ascii=False)}\n\n"
            f"老师点选的条款：\n{chr(10).join(target_lines) if target_lines else '（未点选）'}\n\n"
            f"老师意见（可能很笼统）：\n{note}\n\n"
            f"意见是否偏笼统：{'是，请据文稿自行补全具体条款' if vague else '否，尽量按字面落实'}"
        )
        result = agnes.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.25,
            max_tokens=3500,
            retries=1,
        )
        if result.get("ok"):
            parsed = _parse_json_object((result.get("content") or "").strip())
            if parsed:
                parsed.setdefault("display_name", fields.get("display_name"))
                vc = parsed.get("visit_context")
                if isinstance(vc, dict):
                    parsed["visit_context"] = str(
                        vc.get("text") or vc.get("summary") or vc.get("content") or ""
                    ).strip()
                elif vc is None:
                    parsed["visit_context"] = fields.get("visit_context") or ""
                else:
                    parsed["visit_context"] = str(vc).strip()
                for key in ("locked_facts", "key_concerns", "openings", "forbidden", "scoring_hints"):
                    parsed[key] = _normalize_annotated_list(parsed.get(key) or [], mode="rough")
                    parsed[key] = _drop_shell_annotated(parsed[key])
                merged = dict(fields)
                merged.update({
                    k: parsed[k]
                    for k in (
                        "display_name",
                        "visit_context",
                        "locked_facts",
                        "key_concerns",
                        "openings",
                        "forbidden",
                        "scoring_hints",
                    )
                    if k in parsed
                })
                if parsed.get("persona"):
                    merged["persona"] = parsed["persona"]
                if parsed.get("dialogue_hints"):
                    merged["dialogue_hints"] = parsed["dialogue_hints"]
                new_fields = merged
                # 若仍几乎没补上、且老师说少了：再用文稿启发式补一轮
                if vague or any(k in note for k in ("少了", "缺少", "漏了", "补")):
                    new_fields = _enrich_from_case_doc(new_fields, source_text, note=note)

    if new_fields is None:
        new_fields = _heuristic_revise_fields(
            fields, note=note, targets=targets, source_text=source_text
        )

    draft["fields"] = new_fields
    draft["design_hooks"] = design_hooks_for_scene(draft["scene_key"], new_fields)
    draft["reviewed_ack"] = False
    draft["status"] = "review"
    _push_field_version(draft, note=f"AI 已按意见修改：{note[:40]}", actor="ai")
    save_draft(draft)
    return {"ok": True, "draft": draft}


_SHELL_FACT_TEXTS = {
    "内容",
    "待补充",
    "待确认",
    "缺少",
    "少了",
    "有问题",
    "不对",
    "改一下",
    "补充",
    "补全",
    "...",
    "…",
    "无",
}

_MD_META_HINTS = (
    "使用场景",
    "培训案例",
    "研究 / 访视",
    "研究/访视",
    "人物设定",
    "真实情况",
    "什么时候说",
    "示例对话",
    "老师原大概",
    "练什么",
    "建议时长",
    "虚构声明",
)


def _strip_md_inline(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^#{1,6}\s*", "", t)
    t = re.sub(r"^[-*+]\s+", "", t)
    t = re.sub(r"^\d+[.)、]\s*", "", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    return t.strip()


def _is_case_doc_meta_line(text: str) -> bool:
    """案例文稿标题/分节/带教说明，不应进入学员可见主诉/病程。"""
    raw = (text or "").strip()
    if not raw:
        return True
    t = _strip_md_inline(raw)
    if not t or t in _SHELL_FACT_TEXTS:
        return True
    if raw.startswith("#"):
        return True
    if re.match(r"^#{1,6}\s*", raw):
        return True
    if re.match(r"^##?\s*[一二三四五六七八九十]+[、.]", raw):
        return True
    if any(h in t for h in _MD_META_HINTS) and (
        t.startswith(tuple(_MD_META_HINTS))
        or re.match(r"^[一二三四五六七八九十]+[、.]", t)
        or "培训案例" in t
        or t.startswith("练什么")
        or t.startswith("建议时长")
        or t.startswith("虚构声明")
    ):
        return True
    if re.match(r"^(练什么|建议时长|虚构声明|试验一句话|今天第几周|本案例用于|建议演练)[：:\s]", t):
        return True
    if t.endswith("培训案例") or re.search(r"·\s*.+培训案例$", t):
        return True
    return False


def _default_visit_context(scene_key: str, scene_label: str, display_name: str) -> str:
    blob = f"{scene_key} {scene_label}"
    if scene_key == "informed_consent" or "知情" in blob:
        return f"{display_name}今天来做知情同意沟通，需听清试验要点并表达顾虑。"
    if scene_key == "follow_up" or "随访" in blob:
        return f"{display_name}今天来做随访询问，核对用药、不适与合并用药。"
    if "家属" in blob or "family" in blob.lower() or "proxy" in blob.lower():
        return (
            f"{display_name}今天带着家属来沟通；需同时安抚家属关切，"
            f"并把试验/访视要点讲清、问清，避免只顾一方。"
        )
    return f"{display_name}今天来做「{scene_label}」沟通。"


def _sanitize_visit_context(
    text: str,
    *,
    scene_key: str,
    scene_label: str,
    display_name: str,
    source_text: str = "",
) -> str:
    raw = (text or "").strip()
    # 整段案例文稿被误塞进 visit_context 时，只取访视背景小节句
    if raw.startswith("#") or "\n## " in raw or _is_case_doc_meta_line(raw.split("\n", 1)[0]):
        m = re.search(
            r"(?:访视背景|今天来干嘛|本次沟通|使用场景)[^\n]{0,40}\n+([^\n#]{8,160})",
            raw,
        )
        if m:
            cand = _strip_md_inline(m.group(1))
            if cand and not _is_case_doc_meta_line(cand):
                return cand[:160]
        m2 = re.search(r"(?:今天来干嘛|访视背景)[：:\s]*([^\n]{8,160})", source_text or raw)
        if m2:
            cand = _strip_md_inline(m2.group(1))
            if cand and not _is_case_doc_meta_line(cand):
                return cand[:160]
        return _default_visit_context(scene_key, scene_label, display_name)
    plain = _strip_md_inline(raw.split("\n", 1)[0])
    if not plain or _is_case_doc_meta_line(plain) or len(plain) < 4:
        return _default_visit_context(scene_key, scene_label, display_name)
    return plain[:160]


def _sanitize_fact_item(item: Any) -> dict[str, Any] | None:
    if isinstance(item, dict):
        text = _strip_md_inline(str(item.get("text") or ""))
        if not text or _is_case_doc_meta_line(str(item.get("text") or "")) or _is_case_doc_meta_line(text):
            return None
        out = dict(item)
        out["text"] = text
        return out
    text = _strip_md_inline(str(item or ""))
    if not text or _is_case_doc_meta_line(str(item or "")) or _is_case_doc_meta_line(text):
        return None
    return {"text": text}


def _sanitize_annotated_list(items: list[Any] | None) -> list[Any]:
    out: list[Any] = []
    for it in items or []:
        cleaned = _sanitize_fact_item(it)
        if cleaned:
            out.append(cleaned)
    return out


def _plain_bio_from_facts(fact_texts: list[str], *, display_name: str, scene_label: str) -> str:
    good = [t for t in fact_texts if t and not _is_case_doc_meta_line(t)]
    if good:
        return "；".join(good[:3])[:180]
    return f"{display_name}，来做「{scene_label}」沟通训练的受试者。"


def _is_vague_revise_note(note: str) -> bool:
    n = (note or "").strip()
    if not n:
        return True
    if len(n) <= 10:
        return True
    if re.fullmatch(r"(少了|缺少|漏了|不对|有问题|改一下|补充|补全|再看看|重新整理).{0,12}", n):
        return True
    if re.match(r"^(少了|缺少|漏了|补).{0,16}$", n) and not re.search(
        r"[「\"'].+[」\"']|应改成|改成|删掉|去掉", n
    ):
        return True
    return False


def _item_text(it: Any) -> str:
    if isinstance(it, dict):
        return str(it.get("text") or it.get("topic") or "").strip()
    return str(it or "").strip()


def _drop_shell_annotated(items: list[Any]) -> list[dict[str, Any]]:
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            t = str(it).strip()
            if t and t not in _SHELL_FACT_TEXTS and len(t) >= 4:
                out.append(_annotate(t, "none", "已清洗空壳", "guess"))
            continue
        t = _item_text(it)
        if not t or t in _SHELL_FACT_TEXTS or len(t) < 4:
            continue
        out.append(it)
    return out


def _overlap_ratio(a: str, b: str) -> float:
    a = re.sub(r"\s+", "", a or "")
    b = re.sub(r"\s+", "", b or "")
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    # cheap char bigram overlap
    def grams(s: str) -> set[str]:
        if len(s) < 2:
            return {s}
        return {s[i : i + 2] for i in range(len(s) - 1)}

    ga, gb = grams(a), grams(b)
    return len(ga & gb) / max(1, len(ga))


def _already_covered(candidate: str, existing: list[Any], *, thresh: float = 0.45) -> bool:
    for it in existing:
        if _overlap_ratio(candidate, _item_text(it)) >= thresh:
            return True
    return False


def _bullets_from_case_doc(source_text: str) -> dict[str, list[str]]:
    """从案例文稿抽可练条目：事实 / 担心 / 开场。"""
    text = (source_text or "").replace("\r\n", "\n")
    facts: list[str] = []
    concerns: list[str] = []
    openings: list[str] = []

    # 优先「真实情况」段
    m = re.search(
        r"(?:##\s*)?(?:【)?四[、.\s]*受试者真实情况[^【\n]*?(?:】)?\s*\n([\s\S]*?)(?=\n(?:##\s*|【)[五六]|\n---|\Z)",
        text,
    )
    reality = m.group(1) if m else text
    for ln in reality.splitlines():
        s = ln.strip()
        s = re.sub(r"^[-*•、]+\s*", "", s)
        s = re.sub(r"^#{1,6}\s*", "", s)
        s = re.sub(r"^【([^】]+)】\s*", "", s)
        if not s or len(s) < 6:
            continue
        if s.startswith("扮演者") or s.startswith("不要求"):
            continue
        if any(k in s for k in ("怕", "担心", "隐瞒", "不敢", "怕被")):
            concerns.append(s)
        else:
            facts.append(s)

    # 开场：示例对话里受试者首句 / 进门表现
    om = re.search(r"(?:进门基本表现|一开口|开场)[^\n]*\n([\s\S]{0,400})", text)
    if om:
        for ln in om.group(1).splitlines()[:6]:
            s = re.sub(r"^[-*•、]+\s*", "", ln.strip())
            if 6 <= len(s) <= 80:
                openings.append(s)
    for ln in text.splitlines():
        if re.search(r"^(?:王|李|张|赵|陈)?.{0,4}(?:秀英|建国|阿姨|叔叔)?[：:]", ln) or re.search(
            r"受试者[：:]", ln
        ):
            s = re.split(r"[：:]", ln, 1)[-1].strip()
            if 4 <= len(s) <= 60:
                openings.append(s)
                if len(openings) >= 4:
                    break

    def uniq(xs: list[str]) -> list[str]:
        seen = set()
        out = []
        for x in xs:
            k = re.sub(r"\s+", "", x)
            if k in seen or x in _SHELL_FACT_TEXTS:
                continue
            seen.add(k)
            out.append(x)
        return out

    return {
        "facts": uniq(facts)[:12],
        "concerns": uniq(concerns)[:8],
        "openings": uniq(openings)[:6],
    }


def _enrich_from_case_doc(fields: dict[str, Any], source_text: str, *, note: str) -> dict[str, Any]:
    """老师只说「少了」时：对照文稿补具体条款，绝不加空壳。"""
    out = json.loads(json.dumps(fields, ensure_ascii=False))
    bags = _bullets_from_case_doc(source_text)
    reason = f"老师意见较笼统（{note[:40]}），已对照案例文稿补具体内容，请再核对"

    facts = _drop_shell_annotated(list(out.get("locked_facts") or []))
    for cand in bags["facts"]:
        if not _already_covered(cand, facts):
            facts.append(_annotate(cand, "案例文稿", reason, "guess", source_span=cand[:80]))
    out["locked_facts"] = facts

    if any(k in note for k in ("担心", "怕", "关切", "少了", "缺少", "漏了", "补")) or _is_vague_revise_note(note):
        concerns = _drop_shell_annotated(list(out.get("key_concerns") or []))
        for cand in bags["concerns"]:
            if not _already_covered(cand, concerns):
                concerns.append(_annotate(cand, "案例文稿", reason, "guess", source_span=cand[:80]))
        out["key_concerns"] = concerns

    if any(k in note for k in ("开场", "一开口", "少了", "缺少", "补")):
        openings = _drop_shell_annotated(list(out.get("openings") or []))
        for cand in bags["openings"]:
            if not _already_covered(cand, openings):
                openings.append(_annotate(cand, "案例文稿", reason, "guess", source_span=cand[:80]))
        out["openings"] = openings

    out["generation_note"] = "enriched_from_case_doc"
    return out


def _heuristic_revise_fields(
    fields: dict[str, Any],
    *,
    note: str,
    targets: list[dict[str, Any]],
    source_text: str = "",
) -> dict[str, Any]:
    """无 Agnes 时：点选修订 + 笼统「少了」则对照文稿补细，禁止空壳「内容」。"""
    out = json.loads(json.dumps(fields, ensure_ascii=False))
    delete_ish = any(k in note for k in ("删", "去掉", "移除", "多了", "不要这条", "多余"))
    for t in targets:
        kind = (t.get("kind") or "").strip()
        idx = t.get("idx")
        field_key = KIND_TO_FIELD.get(kind)
        if field_key is None or not isinstance(idx, int):
            continue
        items = list(out.get(field_key) or [])
        if idx < 0 or idx >= len(items):
            continue
        if delete_ish:
            items.pop(idx)
        else:
            it = items[idx] if isinstance(items[idx], dict) else {"text": str(items[idx])}
            it = dict(it)
            m = re.search(r"(?:改成|应为|改成：|改成:)\s*[「\"']?(.+?)[」\"']?\s*$", note)
            if m:
                it["text"] = m.group(1).strip()
                it["reason"] = f"按老师意见修改：{note[:80]}"
                it["confidence"] = "high"
                it["source"] = it.get("source") or "老师修订"
            else:
                it["reason"] = f"老师反馈待核对：{note[:120]}"
                it["confidence"] = "guess"
            items[idx] = it
        out[field_key] = items

    want_fill = any(k in note for k in ("少了", "缺少", "补一条", "加上", "漏了", "补全", "补充")) or (
        _is_vague_revise_note(note) and not delete_ish
    )
    if want_fill:
        add_text = ""
        for sep in ("少了", "缺少", "补一条", "加上", "漏了", "补全", "补充"):
            if sep in note:
                add_text = note.split(sep, 1)[-1].strip(" ：:，,。")
                break
        # 有具体内容才直接追加；「内容」「点东西」等空壳 → 走文稿补全
        if add_text and add_text not in _SHELL_FACT_TEXTS and len(add_text) >= 6 and not _is_vague_revise_note(note):
            facts = list(out.get("locked_facts") or [])
            if not _already_covered(add_text, facts):
                facts.append(
                    _annotate(add_text, "老师修订", "老师写明要补的内容", "high", source_span=add_text[:80])
                )
            out["locked_facts"] = facts
        else:
            out = _enrich_from_case_doc(out, source_text, note=note)

    out["locked_facts"] = _drop_shell_annotated(out.get("locked_facts") or [])
    out["key_concerns"] = _drop_shell_annotated(out.get("key_concerns") or [])
    out["openings"] = _drop_shell_annotated(out.get("openings") or [])
    out["generation_note"] = "heuristic_revise"
    return out


def _expand_narrative(
    *,
    display_name: str,
    scene_key: str,
    source_text: str,
    agnes: AgnesClient | None,
) -> str:
    """把大概扩写成「飞书案例文稿」体例：分节标题 + 条目，禁止小说叙事。"""
    scene_label = scene_display_label(scene_key)
    is_fu = scene_key == "follow_up"
    template_hint = (
        "必须用 Markdown 分节，结构近似培训用标准化受试者案例（飞书文档体例），例如：\n"
        f"# {display_name} · {scene_label} 培训案例\n"
        "## 一、使用场景\n（练什么、建议时长、虚构声明）\n"
        "## 二、研究 / 访视背景\n（试验一句话、今天第几周/什么谈话、桌上有什么、本次要完成什么）\n"
        "## 三、受试者人物设定\n（姓名、性别、年龄、职业、家庭、既往、性格、对研究的理解、进门基本表现）\n"
        "## 四、受试者真实情况（扮演者掌握，不要求一开始全说）\n"
        "（分小节写：服药/漏服或知情关切、不适、合并用药、日记/材料、隐瞒与怕什么）\n"
        "## 五、什么时候说什么\n（平和追问 vs 责备时怎么答，写短规则）\n"
        "## 六、示例对话（可选，8～15 轮即可）\n"
        "禁止写成小说、散文、心理独白；禁止大段景物描写；用条目和短句。"
    )
    if agnes and agnes.configured:
        result = agnes.chat(
            [
                {
                    "role": "system",
                    "content": (
                        "你是临床试验沟通培训的案例编辑，输出给带教老师审阅的「标准化受试者案例」文稿。"
                        f"{template_hint}"
                        f"场景固定为「{scene_label}」。称呼优先：{display_name}。"
                        "只根据用户「大概」合理扩写；没写清的数字标「待确认」，不要假装精确。"
                        "全文中文白话，少用英文缩写；不要输出 JSON。"
                    ),
                },
                {"role": "user", "content": source_text[:6000]},
            ],
            temperature=0.35,
            max_tokens=3500,
            retries=1,
        )
        if result.get("ok") and (result.get("content") or "").strip():
            return (result.get("content") or "").strip()
    return _heuristic_case_doc(display_name, scene_label, source_text, is_fu)


def _heuristic_case_doc(display_name: str, scene_label: str, source_text: str, is_fu: bool) -> str:
    lines = [ln.strip() for ln in source_text.splitlines() if ln.strip()]
    bullet = "\n".join(f"- {ln}" for ln in lines) if lines else f"- {source_text.strip()}"
    if is_fu:
        tasks = (
            "- 了解服药、漏服/迟服\n"
            "- 询问不适与其他用药\n"
            "- 核对药盒 / 日记 / 相关记录\n"
            "- 安排后续联系"
        )
        reality = (
            "### 平时服药\n待确认（请据大概补充）\n\n"
            "### 漏服 / 迟服\n"
            f"{bullet}\n\n"
            "### 不适与其他用药\n待确认\n\n"
            "### 隐瞒与担心\n- 怕被批评、怕影响继续参加（若大概未写请改）"
        )
    else:
        tasks = (
            "- 讲清试验目的与大致流程\n"
            "- 讲清主要风险与可退出\n"
            "- 回应受试者担心\n"
            "- 确认自愿理解后再往下走"
        )
        reality = (
            "### 嘴上可能怎么说\n"
            f"{bullet}\n\n"
            "### 真正关切 / 担心\n待确认\n\n"
            "### 理解误区\n待确认"
        )
    return (
        f"# {display_name} · {scene_label} 培训案例\n\n"
        f"## 一、使用场景\n\n"
        f"本案例用于「{scene_label}」沟通培训。人物与项目均为教学虚构。\n\n"
        f"建议演练约 12—15 分钟。\n\n"
        f"## 二、研究 / 访视背景\n\n"
        f"当前沟通：{scene_label}。\n\n"
        f"本次需要完成：\n{tasks}\n\n"
        f"## 三、受试者人物设定\n\n"
        f"姓名：{display_name}。\n\n"
        f"其他人口学与性格：待根据大概补全。\n\n"
        f"### 进门基本表现\n\n"
        f"先说没事或简短应付；被平和追问后才说细；被责备则更短、更含糊。\n\n"
        f"## 四、受试者真实情况\n\n"
        f"扮演者掌握，不要求一开始全部说出。\n\n"
        f"{reality}\n\n"
        f"## 五、什么时候说什么\n\n"
        f"- 若对方责备：减少回答，说「记不太清」。\n"
        f"- 若对方说明「不是责怪、需要真实情况」：逐渐说清。\n\n"
        f"## 六、示例对话（可选）\n\n"
        f"（待老师确认事实后再补，或下一步整理卡片时再生成。）\n\n"
        f"---\n"
        f"【老师原大概】\n{source_text.strip()}\n"
    )


def update_draft_fields(draft_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    # 已发布仍允许改病种/场景分类，便于纠正「教学病例」挂错
    reclass_only = set(patch.keys()) <= {
        "disease_code",
        "disease_name",
        "scene_key",
        "display_name",
        "visit_context",
        "reviewed_ack",
    }
    if draft.get("status") == "published" and not reclass_only:
        return {"ok": False, "error": "已发布草稿不可再改（病种/场景分类除外）"}
    if "expanded_text" in patch:
        draft["expanded_text"] = patch["expanded_text"]
    if "source_text" in patch:
        text = str(patch.get("source_text") or "")
        src = draft.setdefault("source", {})
        if isinstance(src, dict):
            src["text"] = text
        if draft.get("status") == "source_ready" or not (draft.get("expanded_text") or "").strip():
            draft["expanded_text"] = text
    if "source_filename" in patch and patch.get("source_filename"):
        src = draft.setdefault("source", {})
        if isinstance(src, dict):
            src["filename"] = str(patch.get("source_filename"))
    if "scene_key" in patch:
        sk = str(patch.get("scene_key") or "").strip()
        if known_scene_meta(sk):
            draft["scene_key"] = sk
    if "disease_code" in patch:
        dc = str(patch.get("disease_code") or "").strip().upper()
        if dc in all_diseases():
            fields_pre = draft.setdefault("fields", {})
            fields_pre["disease_code"] = dc
            fields_pre["disease_name"] = all_diseases()[dc]["name_zh"]
    fields = draft.setdefault("fields", {})
    touching_lists = any(
        k in patch
        for k in (
            "locked_facts",
            "key_concerns",
            "openings",
            "persona",
            "forbidden",
            "dialogue_hints",
            "scoring_hints",
        )
    )
    if touching_lists and fields:
        _push_field_version(draft, note="手动保存前快照", actor="teacher")
    for key in (
        "display_name",
        "visit_context",
        "disease_code",
        "disease_name",
        "locked_facts",
        "key_concerns",
        "openings",
        "persona",
        "forbidden",
        "dialogue_hints",
        "scoring_hints",
    ):
        if key in patch:
            fields[key] = patch[key]
    if "reviewed_ack" in patch:
        draft["reviewed_ack"] = bool(patch["reviewed_ack"])
    draft["design_hooks"] = design_hooks_for_scene(draft["scene_key"], fields)
    save_draft(draft)
    return {"ok": True, "draft": draft}


def publish_draft(draft_id: str) -> dict[str, Any]:
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "error": "草稿不存在"}
    if not draft.get("reviewed_ack"):
        # 重新挂病种分类时允许已发布草稿再发布
        if draft.get("status") != "published":
            return {"ok": False, "error": "请先勾选：事实与红线相关表述我已核对"}
    scene_key = str(draft.get("scene_key") or "").strip()
    meta = known_scene_meta(scene_key)
    if not meta:
        return {"ok": False, "error": f"未知场景：{scene_key or '（空）'}"}
    if not meta.get("publishable"):
        return {
            "ok": False,
            "error": (
                f"「{meta.get('label')}」是测试场景，不能发布到学员端。"
                "请在「新增场景」设为正式，或改选知情同意/随访等正式场景后再发布。"
            ),
        }
    scoring_key = scoring_scene_for(scene_key)
    pack_gate = scene_rubric_status(scoring_key)
    if not pack_gate.get("ok"):
        return {
            "ok": False,
            "error": (
                f"场景「{meta.get('label')}」评分包未就绪，不能发布到学员端。"
                f"{pack_gate.get('detail') or ''}"
            ).strip(),
            "pack_status": pack_gate,
        }
    hooks = design_hooks_for_scene(draft["scene_key"], draft.get("fields") or {})
    if not hooks.get("ok"):
        fails = [
            str(i.get("detail") or i.get("label") or "")
            for i in (hooks.get("items") or [])
            if i.get("status") == "fail"
        ]
        tip = "；".join([x for x in fails if x][:3]) or "请补齐必填项"
        return {"ok": False, "error": f"设计挂钩未通过：{tip}", "design_hooks": hooks}
    package = draft_to_case_package(draft)
    result = import_case_package(package)
    if not result.get("ok"):
        return result
    persona = package.get("persona") or {}
    ensure_persona_portrait(
        persona.get("persona_id") or "",
        sex=str(persona.get("sex") or ""),
        display_hint=str(
            persona.get("display_label")
            or persona.get("display_name")
            or fields_name_safe(draft)
        ),
    )
    draft["status"] = "published"
    draft["published_case_id"] = package["meta"]["case_id"]
    draft["reviewed_ack"] = True
    save_draft(draft)
    return {
        "ok": True,
        "message": "已发布，学员端可选到该病例",
        "case_id": package["meta"]["case_id"],
        "scoring_pack": hooks.get("scoring_pack"),
        "import": result,
    }


def fields_name_safe(draft: dict[str, Any]) -> str:
    return str((draft.get("fields") or {}).get("display_name") or "")


def draft_to_case_package(draft: dict[str, Any]) -> dict[str, Any]:
    scene_key = draft["scene_key"]
    meta_scene = known_scene_meta(scene_key)
    if not meta_scene:
        raise ValueError(f"未知场景，不能发布：{scene_key}")
    if not meta_scene.get("publishable"):
        raise ValueError("测试场景不能发布到学员端；请先设为正式，或改选正式场景")
    scoring_key = scoring_scene_for(scene_key)
    score_meta = SCENE_WHITELIST[scoring_key]
    # 展示用本场景名；评分/代码兜底用生产表白名单字段
    scene_code = str(meta_scene.get("code") or "").strip() or score_meta["code"]
    scene_label = str(meta_scene.get("label") or score_meta["label"])
    fields = draft.get("fields") or {}
    name = fields.get("display_name") or "未命名受试者"
    slug = re.sub(r"[^A-Za-z0-9]+", "", name.encode("ascii", "ignore").decode()) or "CUSTOM"
    # 重新发布时复用已有 case_id，避免同一草稿刷出多个病例
    case_id = draft.get("published_case_id") or f"CASE-ADM-{slug[:12].upper()}-{new_id()[:6].upper()}"
    existing_persona = (fields.get("persona") or {}).get("persona_id")
    persona_id = existing_persona or f"PER-ADM-{new_id()[:8].upper()}"
    persona_in = fields.get("persona") or {}
    facts = _sanitize_annotated_list(fields.get("locked_facts") or [])
    fact_texts = [
        (f.get("text") if isinstance(f, dict) else str(f)) for f in facts
    ]
    openings = _sanitize_annotated_list(fields.get("openings") or [])
    opening_texts = [
        (o.get("text") if isinstance(o, dict) else str(o)) for o in openings
    ]
    concerns_raw = _sanitize_annotated_list(fields.get("key_concerns") or [])
    concerns_out = []
    for i, c in enumerate(concerns_raw):
        if isinstance(c, dict):
            concerns_out.append(
                {
                    "concern_id": c.get("concern_id") or f"KC-ADM-{i+1:02d}",
                    "topic": _strip_md_inline(str(c.get("topic") or c.get("text") or "关切"))[:48],
                    "patient_may_ask": c.get("patient_may_ask") or [],
                    "researcher_should_cover": c.get("researcher_should_cover")
                    or c.get("reason")
                    or "",
                    "disclosure_rule": c.get("disclosure_rule") or c.get("text") or "",
                    "source": c.get("source"),
                    "reason": c.get("reason"),
                }
            )
        else:
            concerns_out.append(
                {
                    "concern_id": f"KC-ADM-{i+1:02d}",
                    "topic": str(c)[:32],
                    "patient_may_ask": [],
                    "researcher_should_cover": "",
                    "disclosure_rule": str(c),
                }
            )
    forbidden = []
    for i, f in enumerate(fields.get("forbidden") or []):
        desc = f.get("text") if isinstance(f, dict) else str(f)
        forbidden.append(
            {
                "forbidden_id": f"FB-ADM-{i+1:02d}",
                "category": "claim",
                "description": desc,
                "remediating_reply": "这个我不太清楚，您再问问研究医生吧。",
            }
        )
    if not forbidden:
        forbidden.append(
            {
                "forbidden_id": "FB-ADM-01",
                "category": "event",
                "description": "不得编造未登记的严重不良事件或住院",
                "remediating_reply": "那些都没有发生。",
            }
        )

    visit_context = _sanitize_visit_context(
        str(fields.get("visit_context") or ""),
        scene_key=scene_key,
        scene_label=scene_label,
        display_name=name,
        source_text=str((draft.get("expanded_text") or (draft.get("source") or {}).get("text") or "")),
    )
    chief_complaint = visit_context
    # 场景 ≠ 病种：知情/随访是沟通任务；病种挂 T2DM / HTN，避免再出现「教学病例」杂类
    disease_code = resolve_disease_code(
        fields=fields,
        scene_key=scene_key,
        source_text=str((draft.get("source") or {}).get("text") or ""),
    )
    disease_meta = all_diseases()[disease_code]
    disease_block = {
        "disease_code": disease_code,
        "name_zh": fields.get("disease_name") or disease_meta["name_zh"],
        "icd10": disease_meta.get("icd10"),
        "description": disease_meta.get("description") or f"管理端接入 · {scene_label}",
        "introduction": disease_meta.get("introduction") or "",
    }
    if disease_code == "T2DM":
        protocol_block = {
            "protocol_code": "PROTO-T2DM-ADM",
            "title": fields.get("protocol_title") or "2型糖尿病试验方案（管理端接入）",
            "phase": "II" if scene_key == "informed_consent" else "II",
            "is_placeholder": True,
            "status": "active",
        }
        meta_phase = "II"
    elif disease_code == "HTN":
        protocol_block = {
            "protocol_code": "PROTO-HTN-ADM",
            "title": fields.get("protocol_title") or "高血压试验方案（管理端接入）",
            "phase": "III",
            "is_placeholder": True,
            "status": "active",
        }
        meta_phase = "III"
    else:
        protocol_block = {
            "protocol_code": f"PROTO-{disease_code}-ADM",
            "title": fields.get("protocol_title")
            or f"{disease_meta.get('name_zh') or disease_code}试验方案（管理端接入）",
            "phase": "II",
            "is_placeholder": True,
            "status": "active",
        }
        meta_phase = "II"

    symptoms = []
    for i, text in enumerate(fact_texts[:8]):
        if not text:
            continue
        symptoms.append(
            {
                "symptom_id": f"SYM-ADM-{i+1:02d}",
                "name": text[:48],
                "is_core": True,
                "present": True,
                "lay_description": text,
                "source": "admin_ingest_locked_fact",
            }
        )
    risks = []
    for i, c in enumerate(concerns_out[:6]):
        topic = c.get("topic") or c.get("disclosure_rule") or "关切"
        risks.append(
            {
                "risk_id": f"RISK-ADM-{i+1:02d}",
                "title": str(topic)[:48],
                "must_disclose": scene_key == "informed_consent",
                "description": c.get("researcher_should_cover")
                or c.get("disclosure_rule")
                or str(topic),
            }
        )
    visits = [
        {
            "visit_id": "V-ADM-01",
            "name": scene_label,
            "timing": visit_context,
            "procedures": [visit_context],
        }
    ]
    package = {
        "meta": {
            "case_id": case_id,
            "title": f"{name} · {scene_label}",
            "short_title": f"{name} · {scene_label}",
            "data_status": "reviewed",
            "version": "0.1.0",
            "phase": meta_phase,
            "locale": "zh-CN",
            "is_default": False,
            "mvp_scenes": [scene_code],
            "source_refs": [
                {
                    "type": "admin_ingest",
                    "title": draft.get("source", {}).get("filename") or "管理端接入",
                    "note": f"mode={draft.get('mode')}; draft={draft.get('draft_id')}; scoring_fallback={scoring_key}",
                }
            ],
            "disclaimer": "本病例为教学模拟 SP 案例，由管理端审核发布。",
        },
        "disease": disease_block,
        "protocol": protocol_block,
        "session_script": {
            "scene_key": scene_key,
            "scene_label": scene_label,
            "scene_codes": [scene_code],
            "scoring_scene_key": scoring_key,
            "visit_context": visit_context,
            "system_opening": f"你正在进行{scene_label}训练。受试者：{name}。",
            "patient_greeting": opening_texts[0] if opening_texts else (
                f"大夫，我家属也来了，今天主要想听听您怎么说。"
                if ("家属" in f"{scene_key}{scene_label}")
                else "您好，我来了。"
            ),
            "patient_greeting_seeds": opening_texts
            or (
                [
                    f"大夫，我是{name}，我女儿也来了，她有点担心。",
                    "您跟我们一起说说行吗？我有点听不懂那些词。",
                ]
                if ("家属" in f"{scene_key}{scene_label}")
                else [f"您好，我是{name}。", "大夫，今天找我有事吗？"]
            ),
            "opening_themes": [
                _strip_md_inline(str(f.get("topic") or ""))
                for f in concerns_out
                if f.get("topic")
            ][:4]
            or (["家属关切", "听清要点"] if ("家属" in f"{scene_key}{scene_label}") else ["礼貌问候", "略带紧张"]),
            "trainee_role_hint": (
                "家属在场时：同时安抚家属关切、把试验要点讲清；不要只顾一方，也不要一开始责备。"
                if ("家属" in f"{scene_key}{scene_label}")
                else "态度平和、把关键信息讲清/问清；不要一开始责备。"
            ),
        },
        "clinical_summary": {
            "chief_complaint": chief_complaint,
            "history_present": [t for t in fact_texts[:8] if t and not _is_case_doc_meta_line(t)],
            "history_past": [],
            "social_notes": _plain_bio_from_facts(
                fact_texts,
                display_name=name,
                scene_label=scene_label,
            ),
        },
        "adherence_facts": {"missed_doses": [], "note": "见锁死事实"},
        "symptoms": symptoms,
        "concomitant_events": [],
        "inclusion_hints": [],
        "exclusion_hints": [],
        "comorbidities": [],
        "medication": {"investigational_summary": "", "concomitant_drugs": []},
        "risks": risks,
        "benefits": [],
        "visits": visits,
        "lab_hints": [],
        "forbidden_fabrications": forbidden,
        "persona": {
            "persona_id": persona_id,
            "display_name": name,
            "display_label": persona_in.get("display_label")
            or f"{name} · {persona_in.get('occupation') or '受试者'}",
            "age_years": persona_in.get("age_years") or 50,
            "sex": persona_in.get("sex") or "unknown",
            "emotion_baseline": persona_in.get("emotion_baseline") or "anxious_mild",
            "concealment_tendency": persona_in.get("concealment_tendency") or "moderate",
            "occupation": persona_in.get("occupation") or "",
            "lay_bio": _strip_md_inline(str(persona_in.get("lay_bio") or ""))
            if persona_in.get("lay_bio") and not _is_case_doc_meta_line(str(persona_in.get("lay_bio") or ""))
            else _plain_bio_from_facts(fact_texts, display_name=name, scene_label=scene_label),
        },
        "key_concerns": concerns_out,
        "dialogue_hints": fields.get("dialogue_hints")
        or {
            "if_blame": {
                "trigger_patterns": ["责备", "怎么能"],
                "response": "我也不是故意的…",
                "behavior": "更短、更防备",
            },
            "if_reassure": {
                "trigger_patterns": ["不是责怪", "了解真实情况"],
                "response": "那我说实话…",
                "behavior": "逐渐具体",
            },
        },
        "ingest_meta": {
            "draft_id": draft.get("draft_id"),
            "mode": draft.get("mode"),
            "scoring_hints": fields.get("scoring_hints") or [],
            "locked_facts_annotated": facts,
            "openings_annotated": openings,
        },
        "scoring": _scoring_block_for_package(
            scoring_key,
            disease_code,
            {**score_meta, "label": scene_label, "dialogue_scene_key": scene_key},
            disease_meta,
        ),
    }
    return package


def _scoring_block_for_package(
    scene_key: str,
    disease_code: str,
    meta_scene: dict[str, Any],
    disease_meta: dict[str, Any],
) -> dict[str, Any]:
    pack = describe_effective_rubric(load_effective_rubric(scene_key, disease_code))
    emphasis = dict(pack.get("emphasis") or {})
    if not emphasis.get("patientStance"):
        emphasis["patientStance"] = emphasis.get("traineeBrief") or (
            f"本场为{meta_scene.get('label') or scene_key}·"
            f"{disease_meta.get('name_zh') or disease_code}；言行贴合该病种与访视任务"
        )
    return {
        "disease_code": disease_code,
        "scene_key": scene_key,
        "rubric_ref": meta_scene.get("rubric_file"),
        "overlay_key": f"{scene_key}|{disease_code}",
        "emphasis": emphasis,
        "pack_version": pack.get("version"),
        "overlay_applied": bool(pack.get("overlay_applied")),
    }


def _guess_name(text: str) -> str:
    m = re.search(r"(?:叫|姓名|患者|受试者)[：:\s]*([\u4e00-\u9fff]{2,4})", text)
    if m:
        return m.group(1)
    return "新受试者"


def _annotate(text: str, source: str, reason: str, confidence: str = "high", **extra: Any) -> dict[str, Any]:
    item = {
        "text": text,
        "source": source,
        "reason": reason,
        "confidence": confidence,
    }
    item.update(extra)
    return item


def _generate_fields(
    *,
    mode: str,
    scene_key: str,
    display_name: str,
    source_text: str,
    agnes: AgnesClient | None,
) -> dict[str, Any]:
    ai_fields = None
    if agnes and agnes.configured:
        ai_fields = _ai_generate(agnes, mode, scene_key, display_name, source_text)
    if ai_fields:
        return _finalize_generated_fields(ai_fields, scene_key, display_name, source_text)
    return _finalize_generated_fields(
        _heuristic_generate(mode, scene_key, display_name, source_text),
        scene_key,
        display_name,
        source_text,
    )


def _finalize_generated_fields(
    fields: dict[str, Any],
    scene_key: str,
    display_name: str,
    source_text: str,
) -> dict[str, Any]:
    """去掉案例文稿 Markdown 壳，避免主诉/病程原样露出 # 标题。"""
    out = dict(fields or {})
    meta = known_scene_meta(scene_key) or {}
    label = str(meta.get("label") or scene_key)
    name = str(out.get("display_name") or display_name or "受试者")
    out["visit_context"] = _sanitize_visit_context(
        str(out.get("visit_context") or ""),
        scene_key=scene_key,
        scene_label=label,
        display_name=name,
        source_text=source_text,
    )
    for key in ("locked_facts", "key_concerns", "openings", "forbidden", "scoring_hints"):
        if key in out:
            out[key] = _sanitize_annotated_list(out.get(key) or [])
    persona = dict(out.get("persona") or {})
    bio = str(persona.get("lay_bio") or "")
    if bio and (_is_case_doc_meta_line(bio) or bio.lstrip().startswith("#")):
        persona["lay_bio"] = _plain_bio_from_facts(
            [str(x.get("text") if isinstance(x, dict) else x) for x in (out.get("locked_facts") or [])],
            display_name=name,
            scene_label=label,
        )
    elif bio:
        persona["lay_bio"] = _strip_md_inline(bio)[:180]
    out["persona"] = persona
    return out


def _heuristic_generate(mode: str, scene_key: str, display_name: str, source_text: str) -> dict[str, Any]:
    """无 Agnes 或解析失败时的可审草稿（仍带出处字段）。"""
    lines = [ln.strip() for ln in source_text.splitlines() if ln.strip()]
    snippet = source_text[:120].replace("\n", " ")
    src_label = {
        "rough": "用户大概",
        "material": "材料原文",
        "human": "用户自写全文",
    }[mode]
    facts = []
    for ln in lines[:12]:
        if len(ln) < 8 or _is_case_doc_meta_line(ln):
            continue
        plain = _strip_md_inline(ln)
        if len(plain) < 8 or _is_case_doc_meta_line(plain):
            continue
        conf = "high" if mode == "human" else ("high" if len(plain) > 20 else "guess")
        if mode == "human":
            facts.append(_annotate(plain, src_label, "纯人写映射，未改写", conf, source_span=plain[:80]))
        else:
            facts.append(
                _annotate(
                    plain,
                    src_label,
                    "从输入中保留的关键句" if mode != "rough" else "由大概整理；请核对是否夸大",
                    conf,
                    source_span=plain[:80],
                )
            )
    if not facts:
        if mode == "human":
            facts = []
        else:
            facts = [
                _annotate(
                    snippet or "（待补充锁死事实）",
                    src_label if snippet else "none",
                    "输入过短，请人审补全",
                    "guess",
                    source_span=snippet[:80],
                )
            ]

    rubric = load_rubric(scene_key)
    groups = rubric.get("groups") or []
    scoring_hints = []
    for g in groups[:4]:
        gid = g.get("id") or ""
        gname = g.get("name") or gid
        scoring_hints.append(
            _annotate(
                f"练习时需覆盖大类「{gname}」相关沟通要点",
                f"本场景评分清单 · {gid} {gname}",
                "病例挂靠已有场景，评分不新造；此条为挂钩说明而非新得分点",
                "high",
                rubric_group_id=gid,
                rubric_group_name=gname,
            )
        )

    openings = []
    if mode == "human":
        # only use explicit lines that look like dialogue
        for ln in lines:
            if ln.startswith("「") or ln.startswith("“") or "说" in ln[:6]:
                openings.append(_annotate(ln.strip("「」“”"), src_label, "用户原文开场", "high", source_span=ln[:80]))
        if not openings and lines:
            # do not invent; leave empty for human path if no clear opening
            pass
    else:
        family = "家属" in f"{scene_key}{scene_display_label(scene_key)}"
        openings = [
            _annotate(
                f"大夫，我是{display_name}，{'我女儿也来了' if family else '今天来了'}。",
                src_label,
                "根据称呼生成的礼貌开场，请改成更贴人设的说法",
                "guess",
            ),
            _annotate(
                "您跟我们一起说说行吗？有些词我听不太懂。"
                if family
                else (
                    "嗯……我有点紧张，您慢慢说。"
                    if scene_key == "informed_consent"
                    else "药我基本上都吃了，没什么大问题。"
                ),
                src_label,
                "按场景常见口吻草稿，需人审",
                "guess",
            ),
        ]

    concerns = []
    if "怕" in source_text or "担心" in source_text:
        concerns.append(
            _annotate(
                "担心被批评或不被理解",
                src_label,
                "输入中出现怕/担心类表述",
                "high",
                topic="担心与信任",
                source_span="怕" if "怕" in source_text else "担心",
            )
        )
    if mode != "human" and not concerns:
        concerns.append(
            _annotate(
                "对试验安排或随访核查有顾虑",
                "none",
                "输入未写明关切，AI 猜测，请确认或删除",
                "guess",
                topic="未写明关切",
            )
        )

    age_m = re.search(r"(\d{2})\s*岁", source_text)
    sex = "female" if re.search(r"女|阿姨|女士", source_text) else (
        "male" if re.search(r"男|大爷|先生|司机", source_text) else "unknown"
    )
    persona = {
        "display_label": display_name,
        "age_years": int(age_m.group(1)) if age_m else 50,
        "sex": sex,
        "occupation": "",
        "emotion_baseline": "anxious_mild" if ("怕" in source_text or "紧张" in source_text) else "calm",
        "concealment_tendency": "moderate" if ("瞒" in source_text or "怕被" in source_text) else "low",
        "lay_bio": snippet,
        "source": src_label,
        "reason": "从输入粗提取人口学与口吻；请核对",
        "confidence": "guess" if mode != "human" else "high",
    }

    visit_m = re.search(r"(?:今天来干嘛|访视背景|本次沟通)[：:\s]*([^\n]{6,160})", source_text)
    if visit_m:
        visit = _strip_md_inline(visit_m.group(1))
    else:
        visit = _default_visit_context(scene_key, scene_display_label(scene_key), display_name)
    return {
        "display_name": display_name,
        "visit_context": visit[:160],
        "locked_facts": facts,
        "key_concerns": concerns,
        "openings": openings,
        "forbidden": [
            _annotate(
                "不得编造未登记的严重不良事件",
                f"本场景评分清单 · 红线",
                "沿用教学安全底线",
                "high",
            )
        ],
        "scoring_hints": scoring_hints,
        "persona": persona,
        "dialogue_hints": {
            "if_blame": {
                "trigger_patterns": ["责备", "怎么能"],
                "response": "我也不是故意的…",
                "behavior": "更短、更防备",
                "source": src_label if mode == "human" else "none",
                "reason": "默认接话倾向；路径丙若用户未写则保持模板并标来源",
            }
        },
        "generation_note": "heuristic_fallback" if mode != "human" else "human_map_fallback",
    }


def _ai_generate(
    agnes: AgnesClient,
    mode: str,
    scene_key: str,
    display_name: str,
    source_text: str,
) -> dict[str, Any] | None:
    scene_label = scene_display_label(scene_key)
    rubric = load_rubric(scene_key if scene_key in SCENE_WHITELIST else "informed_consent")
    groups = [{"id": g.get("id"), "name": g.get("name")} for g in (rubric.get("groups") or [])]
    mode_rule = {
        "rough": "根据大概生成可审草稿；不确定标 confidence=guess；每条必须有 source 与 reason。",
        "material": "只从材料抽取；材料没有的不得编造数字；摘句写入 source_span；不确定 guess。",
        "human": "只映射用户已写内容，禁止补全、禁止编造开场/事实；缺项留空数组。",
    }[mode]
    system = (
        "你是临床试验沟通训练的病例编辑助手。输出严格 JSON 对象，不要 Markdown。"
        "字段：display_name, visit_context, locked_facts[], key_concerns[], openings[], "
        "forbidden[], scoring_hints[], persona{}, dialogue_hints{}。"
        "locked_facts/key_concerns/openings/forbidden/scoring_hints 每项为对象："
        "{text, source, reason, confidence, source_span?, topic?, rubric_group_id?}。"
        f"场景固定为 {scene_label}（{scene_key}）。评分大类：{json.dumps(groups, ensure_ascii=False)}。"
        "scoring_hints 只能挂钩已有大类，禁止发明新考纲。"
        f"路径规则：{mode_rule}"
    )
    user = f"称呼：{display_name}\n\n输入：\n{source_text[:8000]}"
    result = agnes.chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2 if mode == "human" else 0.35,
        max_tokens=3500,
        retries=1,
    )
    if not result.get("ok"):
        return None
    content = (result.get("content") or "").strip()
    data = _parse_json_object(content)
    if not data:
        return None
    # normalize
    data.setdefault("display_name", display_name)
    vc = data.get("visit_context")
    if isinstance(vc, dict):
        data["visit_context"] = str(
            vc.get("text") or vc.get("summary") or vc.get("content") or vc.get("label") or ""
        ).strip()
    elif vc is None:
        data["visit_context"] = ""
    else:
        data["visit_context"] = str(vc).strip()
    for key in ("locked_facts", "key_concerns", "openings", "forbidden", "scoring_hints"):
        data[key] = _normalize_annotated_list(data.get(key) or [], mode=mode)
    if mode == "human":
        # drop guess inventions
        for key in ("locked_facts", "key_concerns", "openings"):
            data[key] = [x for x in data[key] if x.get("confidence") != "guess" or x.get("source") not in (None, "none", "")]
    data["generation_note"] = "agnes"
    data["persona"] = data.get("persona") or {}
    return data


def _normalize_annotated_list(items: list[Any], *, mode: str) -> list[dict[str, Any]]:
    out = []
    for it in items:
        if isinstance(it, str):
            out.append(
                _annotate(
                    it,
                    "none" if mode != "human" else "用户自写全文",
                    "模型未给出处，请人审",
                    "guess",
                )
            )
        elif isinstance(it, dict):
            text = it.get("text") or it.get("topic") or it.get("description") or ""
            if not text:
                continue
            out.append(
                {
                    "text": text,
                    "source": it.get("source") or "none",
                    "reason": it.get("reason") or "未说明理由，请人审",
                    "confidence": it.get("confidence") or "guess",
                    "source_span": it.get("source_span") or "",
                    "topic": it.get("topic"),
                    "rubric_group_id": it.get("rubric_group_id"),
                    "rubric_group_name": it.get("rubric_group_name"),
                    "researcher_should_cover": it.get("researcher_should_cover"),
                    "disclosure_rule": it.get("disclosure_rule"),
                    "patient_may_ask": it.get("patient_may_ask"),
                }
            )
    return out


def _parse_json_object(content: str) -> dict[str, Any] | None:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        obj = json.loads(content)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
