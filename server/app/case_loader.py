"""加载病例 JSON 包与场景×病种有效评分表。"""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = ROOT / "web" / "data" / "cases"
INDEX_PATH = ROOT / "web" / "data" / "cases-index.json"
RUBRIC_PATH = ROOT / "web" / "data" / "scoring-rubric.json"
RUBRIC_FOLLOWUP_PATH = ROOT / "web" / "data" / "scoring-rubric-followup.json"
RUBRIC_LAY_PATH = ROOT / "web" / "data" / "rubric-layperson.json"
SCORING_DIR = ROOT / "web" / "data" / "scoring"
REGISTRY_PATH = SCORING_DIR / "registry.json"
DATA_DIR = ROOT / "web" / "data"

# 旧路径兼容：registry 缺失或未登记时回退
RUBRIC_BY_SCENE = {
    "informed_consent": RUBRIC_PATH,
    "follow_up": RUBRIC_FOLLOWUP_PATH,
    "adherence": RUBRIC_FOLLOWUP_PATH,
}


@lru_cache
def load_cases_index() -> dict:
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_scoring_registry() -> dict[str, Any]:
    if not REGISTRY_PATH.exists():
        return {"version": "fallback", "scenes": {}, "overlays": {}, "rules": {}}
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _resolve_data_path(rel: str | None) -> Path | None:
    if not rel:
        return None
    p = Path(rel)
    if p.is_absolute():
        return p if p.exists() else None
    cand = DATA_DIR / rel
    if cand.exists():
        return cand
    cand2 = SCORING_DIR / rel
    if cand2.exists():
        return cand2
    return None


def scene_rubric_path(scene_key: str) -> Path:
    """解析场景基表文件路径。"""
    key = (scene_key or "informed_consent").strip() or "informed_consent"
    reg = load_scoring_registry()
    entry = (reg.get("scenes") or {}).get(key)
    if entry:
        alias = entry.get("aliasOf")
        if alias and alias in (reg.get("scenes") or {}):
            entry = reg["scenes"][alias]
            key = alias
        rel = entry.get("rubric")
        path = _resolve_data_path(rel)
        if path:
            return path
    return RUBRIC_BY_SCENE.get(key, RUBRIC_PATH)


def scene_rubric_status(scene_key: str) -> dict[str, Any]:
    """管理端闸门：场景是否有可挂的生产评分包。"""
    key = (scene_key or "").strip()
    reg = load_scoring_registry()
    entry = (reg.get("scenes") or {}).get(key)
    if not entry:
        if key in RUBRIC_BY_SCENE:
            path = RUBRIC_BY_SCENE[key]
            return {
                "ok": path.exists(),
                "scene_key": key,
                "status": "production" if path.exists() else "missing",
                "rubric": str(path.name),
                "source": "legacy_map",
            }
        return {
            "ok": False,
            "scene_key": key,
            "status": "missing",
            "rubric": None,
            "source": "registry",
            "detail": "未在评分注册表登记；请先克隆场景评分包",
        }
    status = entry.get("status") or "draft"
    path = scene_rubric_path(key)
    ok = status == "production" and path.exists()
    return {
        "ok": ok,
        "scene_key": key,
        "status": status,
        "rubric": entry.get("rubric"),
        "path": str(path),
        "source": "registry",
        "detail": None if ok else "场景评分包未就绪（须 production 且文件存在）",
    }


def overlay_ref(scene_key: str, disease_code: str | None) -> dict[str, Any] | None:
    if not disease_code:
        return None
    reg = load_scoring_registry()
    scenes = reg.get("scenes") or {}
    sk = (scene_key or "").strip()
    if sk in scenes and scenes[sk].get("aliasOf"):
        sk = scenes[sk]["aliasOf"]
    key = f"{sk}|{(disease_code or '').strip().upper()}"
    entry = (reg.get("overlays") or {}).get(key)
    if not entry:
        return None
    if isinstance(entry, str):
        return {"path": entry, "status": "production", "key": key}
    out = dict(entry)
    out["key"] = key
    return out


def _apply_overlay(rubric: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(rubric)
    meta = out.setdefault("meta", {})
    ov_meta = overlay.get("meta") or {}

    patch = overlay.get("scoringModelPatch") or {}
    dims = patch.get("dimensions")
    if dims:
        model = meta.setdefault("scoringModel", {})
        by_id = {d.get("id"): dict(d) for d in (model.get("dimensions") or []) if d.get("id")}
        for d in dims:
            did = d.get("id")
            if not did:
                continue
            base = by_id.get(did) or {"id": did}
            merged = {**base, **{k: v for k, v in d.items() if v is not None}}
            by_id[did] = merged
        order = [d.get("id") for d in (model.get("dimensions") or []) if d.get("id")]
        for did in by_id:
            if did not in order:
                order.append(did)
        model["dimensions"] = [by_id[i] for i in order if i in by_id]
        if patch.get("passScore") is not None:
            model["passScore"] = patch["passScore"]

    item_map = {i.get("id"): i for i in out.get("items") or [] if i.get("id")}
    for ov in overlay.get("itemOverrides") or []:
        iid = ov.get("id")
        if not iid or iid not in item_map:
            continue
        item = item_map[iid]
        if "enabledMvp" in ov:
            item["enabledMvp"] = bool(ov["enabledMvp"])
        if ov.get("reason"):
            item["overlay_reason"] = ov["reason"]

    for extra in overlay.get("itemAdds") or []:
        eid = extra.get("id")
        if not eid or eid in item_map:
            continue
        out.setdefault("items", []).append(copy.deepcopy(extra))
        item_map[eid] = extra

    emphasis = overlay.get("emphasis") or {}
    effective = {
        "scene_key": ov_meta.get("scene_key") or meta.get("scene"),
        "disease_code": ov_meta.get("disease_code"),
        "overlay_version": ov_meta.get("version"),
        "overlay_changelog": ov_meta.get("changelog"),
        "base_rubric_file": meta.get("rubricFile") or ov_meta.get("basedOnSceneRubric"),
        "emphasis": emphasis,
        "overlay_applied": True,
    }
    meta["effective"] = effective
    if emphasis.get("traineeBrief"):
        meta["traineeBrief"] = emphasis["traineeBrief"]
    base_ver = str(meta.get("version") or "1")
    ov_ver = ov_meta.get("version") or "ov"
    meta["version"] = f"{base_ver}+{ov_meta.get('disease_code') or 'DX'}-{ov_ver}"
    return out


@lru_cache
def load_effective_rubric(
    scene_key: str = "informed_consent",
    disease_code: str | None = None,
) -> dict:
    """加载场景基表并按病种 overlay 合并。无 overlay 时与旧 load_rubric(scene) 行为一致。"""
    sk = (scene_key or "informed_consent").strip() or "informed_consent"
    path = scene_rubric_path(sk)
    rubric = json.loads(path.read_text(encoding="utf-8"))
    meta = rubric.setdefault("meta", {})
    meta.setdefault("rubricFile", path.name)
    dc = (disease_code or "").strip().upper() or None
    meta["effective"] = {
        "scene_key": sk,
        "disease_code": dc,
        "overlay_applied": False,
        "base_rubric_file": path.name,
        "emphasis": {},
    }

    if not dc:
        return rubric

    ref = overlay_ref(sk, dc)
    if not ref or (ref.get("status") and ref.get("status") not in ("production", "active")):
        meta["effective"]["overlay_warning"] = "missing_or_not_production"
        return rubric

    ov_path = _resolve_data_path(ref.get("path"))
    if not ov_path:
        meta["effective"]["overlay_warning"] = f"file_missing:{ref.get('path')}"
        return rubric

    overlay = json.loads(ov_path.read_text(encoding="utf-8"))
    return _apply_overlay(rubric, overlay)


@lru_cache
def load_rubric(scene_key: str = "informed_consent") -> dict:
    """兼容旧调用：仅按场景加载（无病种叠加）。"""
    return load_effective_rubric(scene_key, None)


def case_disease_code(case: dict | None) -> str | None:
    if not case:
        return None
    disease = case.get("disease") or {}
    code = (disease.get("disease_code") or case.get("meta", {}).get("disease_code") or "").strip().upper()
    return code or None


def load_rubric_for_case(case: dict | None, scene_key: str | None = None) -> dict:
    scoring = (case or {}).get("scoring") or (case or {}).get("meta", {}).get("scoring") or {}
    script = (case or {}).get("session_script") or {}
    # 对话场景可能是测试场景；评分优先用 package 里记下的 scoring_scene_key / scoring.scene_key
    sk = (
        scoring.get("scene_key")
        or script.get("scoring_scene_key")
        or scene_key
        or (case_primary_scene(case) if case else "informed_consent")
    )
    if scoring.get("rubric_ref"):
        path = _resolve_data_path(scoring["rubric_ref"])
        if path and path.exists():
            rubric = json.loads(path.read_text(encoding="utf-8"))
            dc = scoring.get("disease_code") or case_disease_code(case)
            if scoring.get("overlay_ref"):
                ov_path = _resolve_data_path(scoring["overlay_ref"])
                if ov_path and ov_path.exists():
                    return _apply_overlay(rubric, json.loads(ov_path.read_text(encoding="utf-8")))
            if dc:
                return load_effective_rubric(sk, dc)
            return rubric
    dc = scoring.get("disease_code") or case_disease_code(case)
    return load_effective_rubric(sk, dc)


def describe_effective_rubric(rubric: dict[str, Any]) -> dict[str, Any]:
    """管理端审核页摘要。"""
    meta = rubric.get("meta") or {}
    model = meta.get("scoringModel") or {}
    effective = meta.get("effective") or {}
    dims = [
        {
            "id": d.get("id"),
            "name": d.get("name"),
            "weight": d.get("weight"),
            "isGate": bool(d.get("isGate")),
        }
        for d in (model.get("dimensions") or [])
    ]
    enabled = [i for i in (rubric.get("items") or []) if i.get("enabledMvp")]
    disabled = [
        i.get("id")
        for i in (rubric.get("items") or [])
        if i.get("id") and not i.get("enabledMvp") and i.get("overlay_reason")
    ]
    groups = [
        {"id": g.get("id"), "name": g.get("name"), "displayMax": g.get("displayMax")}
        for g in (rubric.get("groups") or [])
    ]
    return {
        "ok": True,
        "scene_key": effective.get("scene_key") or meta.get("scene"),
        "disease_code": effective.get("disease_code"),
        "version": meta.get("version"),
        "rubric_file": effective.get("base_rubric_file") or meta.get("rubricFile"),
        "overlay_applied": bool(effective.get("overlay_applied")),
        "overlay_version": effective.get("overlay_version"),
        "changelog": effective.get("overlay_changelog"),
        "emphasis": effective.get("emphasis") or {},
        "trainee_brief": (effective.get("emphasis") or {}).get("traineeBrief")
        or meta.get("traineeBrief"),
        "dimensions": dims,
        "groups": groups,
        "enabled_item_count": len(enabled),
        "overlay_disabled_ids": disabled,
        "pass_score": model.get("passScore"),
        "warning": effective.get("overlay_warning"),
    }


@lru_cache
def load_rubric_lay() -> dict:
    return json.loads(RUBRIC_LAY_PATH.read_text(encoding="utf-8"))


def default_case_id() -> str:
    idx = load_cases_index()
    return idx.get("meta", {}).get("default_case_id") or idx["cases"][0]["case_id"]


def resolve_case_file(case_id: str) -> Path:
    path = CASES_DIR / f"{case_id}.json"
    if path.exists():
        return path
    idx = load_cases_index()
    for d in idx.get("diseases", []):
        for c in d.get("cases", []):
            if c.get("case_id") == case_id and c.get("file"):
                return ROOT / "web" / "data" / c["file"]
            for p in c.get("personas", []):
                f = p.get("file") or ""
                if f.endswith(f"{case_id}.json") or case_id in f:
                    return ROOT / "web" / "data" / f
    for c in idx.get("cases", []):
        if c["case_id"] == case_id and c.get("file"):
            return ROOT / "web" / "data" / c["file"]
    return path


@lru_cache
def load_case(case_id: str | None = None) -> dict:
    cid = case_id or default_case_id()
    path = resolve_case_file(cid)
    return json.loads(path.read_text(encoding="utf-8"))


def invalidate_case_caches() -> None:
    """管理端写入病例后清空缓存，使下次对话加载新包。"""
    load_cases_index.cache_clear()
    load_case.cache_clear()
    load_rubric.cache_clear()
    load_effective_rubric.cache_clear()
    load_scoring_registry.cache_clear()
    load_rubric_lay.cache_clear()


def case_primary_scene(case: dict) -> str:
    script = case.get("session_script") or {}
    if script.get("scene_key"):
        return script["scene_key"]
    binding = next((b for b in case.get("scene_bindings", []) if b.get("enabled")), None)
    if binding:
        return binding.get("scene_key") or "informed_consent"
    return "informed_consent"


def case_fact_digest(case: dict) -> dict:
    """注入 Prompt 的精简事实，避免过长。"""
    meta = case["meta"]
    persona = case["persona"]
    symptoms = [
        {
            "id": s["symptom_id"],
            "name": s["name"],
            "present": s.get("present", True),
            "severity": s.get("severity_band"),
            "may_say": (s.get("patient_may_say") or [])[:3],
        }
        for s in case.get("symptoms", [])
        if s.get("is_core") or s.get("present")
    ]
    digest = {
        "case_id": meta["case_id"],
        "title": meta["short_title"],
        "disclaimer": "教学模拟病例",
        "scene_key": case_primary_scene(case),
        "scene_label": (case.get("session_script") or {}).get("scene_label"),
        "disease": {
            "disease_code": (case.get("disease") or {}).get("disease_code"),
            "name_zh": (case.get("disease") or {}).get("name_zh"),
            "introduction": ((case.get("disease") or {}).get("introduction") or "")[:400] or None,
        },
        "clinical": case.get("clinical_summary", {}),
        "symptoms": symptoms,
        "risks_patient_may_worry": [
            {"id": r["risk_id"], "title": r["title"], "lay": r["lay_summary"]}
            for r in case.get("risks", [])
            if r.get("must_disclose")
        ][:6],
        "forbidden": [
            {"id": f["forbidden_id"], "desc": f["description"], "fallback": f.get("remediating_reply")}
            for f in case.get("forbidden_fabrications", [])
        ],
        "persona": {
            "name": persona.get("display_name"),
            "age_band": persona.get("age_band"),
            "sex": persona.get("sex"),
            "emotion": persona.get("emotion_baseline"),
            "style": persona.get("comprehension_style"),
            "bio": persona.get("lay_bio"),
        },
        "medication_brief": (case.get("medication") or {}).get("current_regimen_summary"),
    }
    if case.get("adherence_facts"):
        digest["adherence_facts"] = case["adherence_facts"]
    if case.get("concomitant_events"):
        digest["concomitant_events"] = [
            {"id": e.get("event_id"), "type": e.get("type"), "summary": e.get("drug_name") or e.get("context")}
            for e in case["concomitant_events"]
        ]
    if case.get("key_concerns"):
        digest["key_concerns"] = [
            {"topic": k.get("topic"), "rule": k.get("disclosure_rule")}
            for k in case["key_concerns"]
        ]
    if case.get("dialogue_hints"):
        digest["dialogue_hints"] = case["dialogue_hints"]
    try:
        rub = load_rubric_for_case(case)
        brief = (rub.get("meta") or {}).get("traineeBrief")
        if brief:
            digest["scoring_emphasis"] = brief
    except Exception:
        pass
    return digest
