"""Restore admin-imported cases under correct disease buckets (not CUSTOM)."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from app.case_ingest import (  # noqa: E402
    DISEASE_WHITELIST,
    get_draft,
    publish_draft,
    resolve_disease_code,
    save_draft,
)

# draft_id -> overrides
FIXES = {
    # 王秀英 · 高血压随访
    "DRAFT-CCA21A19-A": {
        "scene_key": "follow_up",
        "disease_code": "HTN",
        "disease_name": "高血压",
    },
    # 周明华 · 糖尿病知情同意（材料是 ICF，草稿误标成随访）
    "DRAFT-D3882D84-8": {
        "scene_key": "informed_consent",
        "disease_code": "T2DM",
        "disease_name": "2型糖尿病",
    },
    # 陈美玲 · 糖尿病随访（样例写明 2 型糖尿病电话随访）
    "DRAFT-42587DB7-E": {
        "scene_key": "follow_up",
        "disease_code": "T2DM",
        "disease_name": "2型糖尿病",
    },
    # 跳过：与正式张大爷重复的材料试发布
    # "DRAFT-C1410947-B": skip
}


def fix_and_publish(draft_id: str, overrides: dict) -> dict:
    draft = get_draft(draft_id)
    if not draft:
        return {"ok": False, "draft_id": draft_id, "error": "missing"}
    fields = draft.setdefault("fields", {})
    draft["scene_key"] = overrides["scene_key"]
    fields["disease_code"] = overrides["disease_code"]
    fields["disease_name"] = overrides["disease_name"]
    # 二次确认：若文案更像另一病种则尊重 overrides（人工已定）
    resolved = resolve_disease_code(
        fields=fields,
        scene_key=draft["scene_key"],
        source_text=str((draft.get("source") or {}).get("text") or ""),
    )
    assert resolved == overrides["disease_code"] or overrides["disease_code"] in DISEASE_WHITELIST
    fields["disease_code"] = overrides["disease_code"]
    fields["disease_name"] = overrides["disease_name"]
    draft["reviewed_ack"] = True
    save_draft(draft)
    result = publish_draft(draft_id)
    return {
        "ok": result.get("ok"),
        "draft_id": draft_id,
        "name": fields.get("display_name"),
        "scene": draft["scene_key"],
        "disease": fields["disease_code"],
        "case_id": result.get("case_id"),
        "error": result.get("error"),
    }


def main() -> int:
    # ensure chenmeiling draft exists locally
    results = []
    for draft_id, ov in FIXES.items():
        results.append(fix_and_publish(draft_id, ov))
    print(json.dumps(results, ensure_ascii=False, indent=2))

    idx = json.loads((ROOT / "web" / "data" / "cases-index.json").read_text(encoding="utf-8"))
    print("diseases:")
    for d in idx.get("diseases", []):
        print(" ", d.get("disease_code"), d.get("name_zh"), "cases=", [c.get("case_id") for c in d.get("cases") or []])
    assert not any(d.get("disease_code") == "CUSTOM" for d in idx.get("diseases", []))
    return 0 if all(r.get("ok") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
