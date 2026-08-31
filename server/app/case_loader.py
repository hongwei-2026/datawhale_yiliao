"""加载病例 JSON 包。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = ROOT / "web" / "data" / "cases"
INDEX_PATH = ROOT / "web" / "data" / "cases-index.json"
RUBRIC_PATH = ROOT / "web" / "data" / "scoring-rubric.json"
RUBRIC_FOLLOWUP_PATH = ROOT / "web" / "data" / "scoring-rubric-followup.json"
RUBRIC_LAY_PATH = ROOT / "web" / "data" / "rubric-layperson.json"

RUBRIC_BY_SCENE = {
    "informed_consent": RUBRIC_PATH,
    "follow_up": RUBRIC_FOLLOWUP_PATH,
    "adherence": RUBRIC_FOLLOWUP_PATH,
}


@lru_cache
def load_cases_index() -> dict:
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_rubric(scene_key: str = "informed_consent") -> dict:
    path = RUBRIC_BY_SCENE.get(scene_key, RUBRIC_PATH)
    return json.loads(path.read_text(encoding="utf-8"))


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
    return digest
