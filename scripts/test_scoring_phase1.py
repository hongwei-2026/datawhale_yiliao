"""自测：评分 Phase1（groups / 清单为主 / 样本不足 / 随访映射）。

用法（仓库根目录）:
  python scripts/test_scoring_phase1.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from app.case_loader import load_rubric, load_rubric_lay  # noqa: E402
from app.scoring_engine import (  # noqa: E402
    aggregate,
    build_insufficient_sample_feedback,
    checkpoint_progress,
    compute_numeric_scores,
    dialogue_sample_stats,
    run_scoring,
)


class _DummyClient:
    configured = False


def _ok(name: str) -> None:
    print(f"  OK  {name}", flush=True)


def _fail(name: str, detail: str) -> None:
    print(f"  FAIL  {name}: {detail}", flush=True)
    raise AssertionError(f"{name}: {detail}")


# Prefer UTF-8 console on Windows so Chinese labels don't crash the suite
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def test_rubric_groups(scene: str, expected_groups: int) -> None:
    rubric = load_rubric(scene)
    groups = rubric.get("groups") or []
    if len(groups) != expected_groups:
        _fail(f"{scene} groups count", f"{len(groups)} != {expected_groups}")
    ids = {g["id"] for g in groups}
    for item in rubric["items"]:
        if not item.get("enabledMvp"):
            continue
        if not item.get("group_id"):
            _fail(f"{scene} item group_id", item["id"])
        if item["group_id"] not in ids:
            _fail(f"{scene} unknown group", f"{item['id']} -> {item['group_id']}")
        if not item.get("prompt_examples"):
            _fail(f"{scene} prompt_examples", item["id"])
        if not item.get("trainee_role"):
            _fail(f"{scene} trainee_role", item["id"])
    dm = (rubric.get("meta") or {}).get("displayModel") or {}
    if dm.get("primaryFeedback") != "checklist":
        _fail(f"{scene} displayModel", str(dm))
    _ok(f"rubric groups · {scene}")


def test_lijianguo_mapping() -> None:
    path = ROOT / "web" / "data" / "fu-lijianguo-teammate-mapping.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    fu = load_rubric("follow_up")
    fu_ids = {i["id"] for i in fu["items"]}
    for row in data["mappings"]:
        for code in row["fu_ids"]:
            if code not in fu_ids:
                _fail("lijianguo map", f"{code} not in FU rubric")
    if "不采纳" not in data.get("note", "") and "关键词" not in data.get("note", ""):
        # soft check — note should reject keyword scoring
        pass
    _ok("lijianguo FU mapping file")


def test_insufficient_sample() -> None:
    msgs = [
        {"role": "trainee", "content": "你好", "turn_index": 1},
        {"role": "patient", "content": "嗯", "turn_index": 2},
    ]
    stats = dialogue_sample_stats(msgs)
    if stats["sufficient"]:
        _fail("insufficient gate", "short dialogue marked sufficient")
    fb = build_insufficient_sample_feedback(stats, "follow_up")
    if fb["scores"].get("total_score") is not None:
        _fail("insufficient score", "should be None")
    if "报错" not in fb["summary"] and "不是系统报错" not in fb["summary"]:
        _fail("insufficient copy", "should mention not an error")
    if "清单" not in fb["summary"]:
        _fail("insufficient copy", "should mention checklist")
    _ok("样本不足温和文案")


def test_followup_rule_scoring() -> None:
    """规则层：覆盖关键随访关键词时应产出 groups + 参考分。"""
    msgs = [
        {
            "role": "trainee",
            "turn_index": 1,
            "content": (
                "我不是来责怪您的，主要想了解真实情况。"
                "最近有没有哪天忘记吃药？第几天漏服了？后来有没有补服？"
                "有没有头晕发飘或不舒服？第18天怎么样？"
            ),
        },
        {"role": "patient", "turn_index": 2, "content": "第12天忘了，还有一次。头晕过。"},
        {
            "role": "trainee",
            "turn_index": 3,
            "content": (
                "除了试验药，还吃过感冒药、氨氯地平或保健品吗？"
                "我们一起看看药盒还剩几片，日记是当天记的还是补记的？"
                "家里怎么测血压、记了几天？"
            ),
        },
        {"role": "patient", "turn_index": 4, "content": "感冒药吃过，药盒好像多几片，日记有补写。"},
        {
            "role": "trainee",
            "turn_index": 5,
            "content": (
                "身体不适不必等到特别严重才联系研究中心，先打电话。"
                "漏服不要自己补服或加药，先联系我们。"
                "下次随访时间和联系电话我跟您确认一下。我们按日期具体往前对。"
            ),
        },
    ]
    stats = dialogue_sample_stats(msgs)
    if not stats["sufficient"]:
        _fail("FU sample", f"turns={stats['trainee_turns']} chars={stats['trainee_chars']}")

    out = run_scoring(_DummyClient(), msgs, "follow_up")
    scores = out["scores"]
    if scores.get("total_score") is None:
        _fail("FU total_score", "None")
    groups = scores.get("groups") or []
    if len(groups) < 3:
        _fail("FU groups", str(groups))
    g02 = next((g for g in groups if g["id"] == "G-02"), None)
    if not g02 or g02.get("display_max") != 35:
        _fail("FU G-02 displayMax", str(g02))
    if scores.get("primary_feedback") != "checklist":
        _fail("primary_feedback", str(scores.get("primary_feedback")))
    report = out["report"]
    if not report.get("groups"):
        _fail("report.groups", "missing")
    if "清单" not in (report.get("summary") or ""):
        _fail("report summary", report.get("summary"))
    progress = checkpoint_progress(msgs, "follow_up")
    if not progress.get("group_progress"):
        _fail("group_progress", str(progress))
    _ok(f"随访规则评分 total={scores['total_score']} groups={len(groups)}")


def test_ic_group_display_math() -> None:
    rubric = load_rubric("informed_consent")
    items = [i for i in rubric["items"] if i.get("enabledMvp")]
    # all pass except one G-01 fail
    results = []
    for i in items:
        verdict = "fail" if i["id"] == "IC-P03" else "pass"
        results.append(
            {
                "item_code": i["id"],
                "verdict": verdict,
                "layer": i["layer"],
                "type": i["type"],
                "hard_fail": bool(i.get("hardFail")),
                "group_id": i.get("group_id"),
            }
        )
    agg = aggregate(results)
    scores = compute_numeric_scores(results, rubric, agg)
    g01 = next(g for g in scores["groups"] if g["id"] == "G-01")
    if g01["display_max"] != 20:
        _fail("IC G-01 max", str(g01))
    if g01["pct"] >= 100:
        _fail("IC G-01 pct", "should drop after fail")
    if g01["display_score"] is None or g01["display_score"] >= 20:
        _fail("IC G-01 display_score", str(g01["display_score"]))
    gr = next(g for g in scores["groups"] if g["id"] == "G-R")
    if not gr.get("is_gate") or not gr.get("passed"):
        _fail("IC redline gate", str(gr))
    _ok(f"知情大类折算 G-01={g01['display_score']}/20")


def test_redline_fail() -> None:
    msgs = [
        {"role": "trainee", "turn_index": 1, "content": "你怎么能不按要求吃药？这样不能继续参加了，补助也没了。"},
        {"role": "patient", "turn_index": 2, "content": "对不起。"},
        {"role": "trainee", "turn_index": 3, "content": "你就停掉试验药，自己加服氨氯地平就行，不用再联系我们。"},
        {"role": "patient", "turn_index": 4, "content": "好的。"},
        {"role": "trainee", "turn_index": 5, "content": "下次不用来了。记住我说的。"},
    ]
    # pad chars
    msgs[0]["content"] += " " + ("请认真听我说。" * 20)
    out = run_scoring(_DummyClient(), msgs, "follow_up")
    scores = out["scores"]
    if scores.get("redline_ok") is not False:
        _fail("redline_ok", str(scores.get("redline_ok")))
    if scores.get("practice_pass"):
        _fail("practice_pass", "should fail on redline")
    _ok("随访红线一票否决")


def test_lay_keys_optional() -> None:
    lay = load_rubric_lay()
    # soft: at least some FU / IC keys exist
    if "FU-A01" not in lay and "IC-C04" not in lay:
        _fail("layperson", "empty")
    _ok("rubric-layperson 可读")


def main() -> int:
    print("=== test_scoring_phase1 ===")
    # clear lru if any
    load_rubric.cache_clear()
    tests = [
        lambda: test_rubric_groups("informed_consent", 5),
        lambda: test_rubric_groups("follow_up", 4),
        test_lijianguo_mapping,
        test_insufficient_sample,
        test_ic_group_display_math,
        test_followup_rule_scoring,
        test_redline_fail,
        test_lay_keys_optional,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
        except AssertionError as e:
            failed += 1
            print(f"    !! {e}")
        except Exception as e:
            failed += 1
            print(f"    !! EXC {fn.__name__ if hasattr(fn, '__name__') else fn}: {e}")
    print(f"=== done: {len(tests) - failed}/{len(tests)} passed ===")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
