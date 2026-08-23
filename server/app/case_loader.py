"""加载病例 JSON 包。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = ROOT / "web" / "data" / "cases"
INDEX_PATH = ROOT / "web" / "data" / "cases-index.json"
RUBRIC_PATH = ROOT / "web" / "data" / "scoring-rubric.json"
RUBRIC_LAY_PATH = ROOT / "web" / "data" / "rubric-layperson.json"


@lru_cache
def load_cases_index() -> dict:
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_rubric() -> dict:
    return json.loads(RUBRIC_PATH.read_text(encoding="utf-8"))


@lru_cache
def load_rubric_lay() -> dict:
    return json.loads(RUBRIC_LAY_PATH.read_text(encoding="utf-8"))


def default_case_id() -> str:
    idx = load_cases_index()
    for c in idx.get("cases", []):
        if c.get("is_default"):
            return c["case_id"]
    return idx["cases"][0]["case_id"]


@lru_cache
def load_case(case_id: str | None = None) -> dict:
    cid = case_id or default_case_id()
    path = CASES_DIR / f"{cid}.json"
    if not path.exists():
        # fallback via index file field
        for c in load_cases_index().get("cases", []):
            if c["case_id"] == cid:
                path = ROOT / "web" / "data" / c["file"]
                break
    return json.loads(path.read_text(encoding="utf-8"))


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
    return {
        "case_id": meta["case_id"],
        "title": meta["short_title"],
        "disclaimer": "教学模拟占位病例",
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
            "age_band": persona.get("age_band"),
            "sex": persona.get("sex"),
            "emotion": persona.get("emotion_baseline"),
            "style": persona.get("comprehension_style"),
            "bio": persona.get("lay_bio"),
        },
        "medication_brief": (case.get("medication") or {}).get("current_regimen_summary"),
    }
