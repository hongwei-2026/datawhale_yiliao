"""自测：场景×病种 effective rubric（PRD3.0 P1）。

用法（仓库根目录）:
  python scripts/test_scoring_effective.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from app.case_loader import (  # noqa: E402
    describe_effective_rubric,
    invalidate_case_caches,
    load_effective_rubric,
    load_rubric,
    load_rubric_for_case,
    load_case,
    scene_rubric_status,
)


def _ok(name: str) -> None:
    print(f"  OK  {name}", flush=True)


def _fail(name: str, detail: str) -> None:
    print(f"  FAIL  {name}: {detail}", flush=True)
    raise AssertionError(f"{name}: {detail}")


if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def test_scene_only_matches_legacy() -> None:
    invalidate_case_caches()
    a = load_rubric("follow_up")
    b = load_effective_rubric("follow_up", None)
    if a["meta"]["version"] != b["meta"]["version"]:
        # version may gain effective block only — compare item counts & weights
        pass
    dims_a = (a["meta"]["scoringModel"]["dimensions"])
    dims_b = (b["meta"]["scoringModel"]["dimensions"])
    wa = {d["id"]: d["weight"] for d in dims_a if not d.get("isGate")}
    wb = {d["id"]: d["weight"] for d in dims_b if not d.get("isGate")}
    if wa != wb:
        _fail("scene-only weights", f"{wa} != {wb}")
    en_a = {i["id"] for i in a["items"] if i.get("enabledMvp")}
    en_b = {i["id"] for i in b["items"] if i.get("enabledMvp")}
    if en_a != en_b:
        _fail("scene-only enabled", f"diff {en_a ^ en_b}")
    _ok("无病种时与旧 load_rubric 一致")


def test_htn_vs_t2dm_followup() -> None:
    invalidate_case_caches()
    htn = load_effective_rubric("follow_up", "HTN")
    t2dm = load_effective_rubric("follow_up", "T2DM")
    if not (htn["meta"].get("effective") or {}).get("overlay_applied"):
        _fail("HTN overlay", "not applied")
    if not (t2dm["meta"].get("effective") or {}).get("overlay_applied"):
        _fail("T2DM overlay", "not applied")

    htn_l1 = next(d["weight"] for d in htn["meta"]["scoringModel"]["dimensions"] if d["id"] == "L1")
    t2_l1 = next(d["weight"] for d in t2dm["meta"]["scoringModel"]["dimensions"] if d["id"] == "L1")
    if abs(htn_l1 - 0.6) > 1e-9:
        _fail("HTN L1 weight", str(htn_l1))
    if abs(t2_l1 - 0.5) > 1e-9:
        _fail("T2DM L1 weight", str(t2_l1))

    htn_a06 = next(i for i in htn["items"] if i["id"] == "FU-A06")
    t2_a06 = next(i for i in t2dm["items"] if i["id"] == "FU-A06")
    if not htn_a06.get("enabledMvp"):
        _fail("HTN FU-A06", "should be enabled")
    if t2_a06.get("enabledMvp"):
        _fail("T2DM FU-A06", "should be disabled")

    dh = describe_effective_rubric(htn)
    dt = describe_effective_rubric(t2dm)
    if dh["enabled_item_count"] <= dt["enabled_item_count"]:
        # HTN keeps A06, T2DM disables → HTN count should be higher
        if "FU-A06" not in (dt.get("overlay_disabled_ids") or []):
            _fail("T2DM disabled list", str(dt.get("overlay_disabled_ids")))
    if not dh.get("trainee_brief") or not dt.get("trainee_brief"):
        _fail("emphasis", "missing trainee_brief")
    if dh["trainee_brief"] == dt["trainee_brief"]:
        _fail("emphasis", "HTN/T2DM briefs should differ")
    _ok(f"随访 HTN vs T2DM · enabled {dh['enabled_item_count']} vs {dt['enabled_item_count']}")


def test_ic_disease_weights() -> None:
    invalidate_case_caches()
    t2 = load_effective_rubric("informed_consent", "T2DM")
    htn = load_effective_rubric("informed_consent", "HTN")
    c_t2 = next(d["weight"] for d in t2["meta"]["scoringModel"]["dimensions"] if d["id"] == "concern")
    c_htn = next(d["weight"] for d in htn["meta"]["scoringModel"]["dimensions"] if d["id"] == "concern")
    if abs(c_t2 - 0.35) > 1e-9:
        _fail("IC T2DM concern", str(c_t2))
    if abs(c_htn - 0.28) > 1e-9:
        _fail("IC HTN concern", str(c_htn))
    _ok("知情 T2DM/HTN 关切权重不同")


def test_case_lijianguo_htn() -> None:
    invalidate_case_caches()
    case = load_case("CASE-HTN-PH3-W4-001")
    rub = load_rubric_for_case(case)
    eff = rub["meta"].get("effective") or {}
    if eff.get("disease_code") != "HTN":
        _fail("case disease", str(eff))
    if not eff.get("overlay_applied"):
        _fail("case overlay", "expected HTN overlay on follow_up")
    a06 = next(i for i in rub["items"] if i["id"] == "FU-A06")
    if not a06.get("enabledMvp"):
        _fail("case FU-A06", "HTN case should keep BP diary item")
    _ok("李建国病例挂 follow_up×HTN overlay")


def test_pack_gate() -> None:
    st = scene_rubric_status("follow_up")
    if not st.get("ok"):
        _fail("follow_up pack", str(st))
    st2 = scene_rubric_status("risk_explanation_not_real")
    if st2.get("ok"):
        _fail("unknown scene", "should not be ok")
    _ok("场景评分包闸门")


def main() -> None:
    print("=== scoring effective (PRD3.0) ===", flush=True)
    test_scene_only_matches_legacy()
    test_htn_vs_t2dm_followup()
    test_ic_disease_weights()
    test_case_lijianguo_htn()
    test_pack_gate()
    print("ALL PASS", flush=True)


if __name__ == "__main__":
    main()
