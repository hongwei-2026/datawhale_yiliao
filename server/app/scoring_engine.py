"""评分引擎：规则层 + LLM 语义建议 + 反馈报告。"""

from __future__ import annotations

import json
import re
from typing import Any

from .agnes import AgnesClient
from .case_loader import load_effective_rubric, load_rubric, load_rubric_lay

DISCLAIMER = (
    "本结果为教学模拟建议，仅供练习参考，不构成伦理审查、监管合规结论或对个人能力的最终评价。"
    "主反馈是规范清单核对（达标/未达标）；0～100 参考分是教学汇总，非问卷赋分、非法规定分。"
    "AI 与系统评分可能有误或遗漏。真正的专业提升，仍取决于真实场景中与人打交道的实践，以及带教指导。"
)

# 禁止项启发式（IC + FU）
PROHIBITION_RULES = {
    "IC-X01": [r"不签(就)?(不|没)", r"必须参加", r"强迫", r"利诱", r"给你好处.*必须"],
    "IC-X02": [r"一定(能)?(治好|好|有效)", r"肯定(有效|没事|安全)", r"绝对(安全|有效)", r"包治", r"没有副作用", r"一点事都没有"],
    "IC-X03": [r"不用提.*(风险|副作用|不良)", r"严重.*(不用|不必|别).*(说|提|讲)", r"那些.*(不用|不必).*(说|提)", r"隐瞒", r"淡化.*风险"],
    "IC-X04": [r"不签.*(不给|不好好|不理)", r"不参加.*(影响|不给).*治"],
    "IC-X05": [r"出了事.*自负", r"医院不负责", r"放弃.*权利", r"免责"],
    "IC-X06": [r"不是.*(伦理|批准).*(版本|材料|同意书)", r"随便.*版本", r"旧版.*(用|签)", r"未经.*批准"],
    "FU-X01": [r"为什么不按要求", r"怎么能不", r"不能继续参加", r"责备", r"补助.*没了"],
    "FU-X02": [r"你就(停|停掉|补服|加服)", r"自己决定.*停药", r"不用再联系"],
}

# 内容/过程覆盖关键词（弱信号）
COVERAGE_HINTS = {
    "IC-P01": [r"伦理", r"知情同意书", r"批准", r"最新版"],
    "IC-P02": [r"试验", r"研究", r"告诉你", r"说明"],
    "IC-P03": [r"通俗", r"简单说", r"大白话", r"意思是"],
    "IC-P04": [r"有(什么)?问题", r"慢慢", r"不着急", r"可以问"],
    "IC-P05": [r"自愿", r"可以不参加", r"不愿意", r"强迫"],
    "IC-P06": [r"新(的)?(信息|情况|发现)", r"再(次)?告诉", r"有变化"],
    "IC-C01": [r"目的", r"为了", r"研究", r"看看(药|效果)"],
    "IC-C02": [r"来(医院|几次)", r"抽血", r"服药", r"访视", r"流程", r"安排"],
    "IC-C04": [r"风险", r"副作用", r"不适", r"可能.*不舒服", r"不良反应"],
    "IC-C05": [r"不一定", r"可能无效", r"安慰剂", r"不确定", r"不保证"],
    "IC-C06": [r"其他(治疗|办法|选择)", r"不参加也可以"],
    "IC-C07": [r"补偿", r"治疗", r"损害", r"受伤", r"医药费"],
    "IC-C08": [r"补贴", r"花费", r"自费", r"误工", r"交通"],
    "IC-C09": [r"随时(退出|不参加)", r"退出", r"中途"],
    "IC-C10": [r"查阅", r"监查", r"药监", r"监管", r"稽查"],
    "IC-C12": [r"新信息", r"再告知", r"有情况.*联系"],
    "IC-C13": [r"电话", r"联系", r"伦理委员会"],
    "IC-P10": [r"副本", r"复印件", r"一份给你"],
    "CC-01": [r"退出", r"可以不参加", r"随时.*停", r"不愿意"],
    "CC-02": [r"不一定", r"可能无效", r"安慰剂", r"不保证.*有效", r"未必"],
    "CC-03": [r"副作用", r"风险", r"不适", r"不良反应", r"可能.*不舒服"],
    "FU-A01": [r"漏服", r"忘记", r"没吃", r"第\d+天", r"整天.*没有"],
    "FU-A02": [r"头晕", r"发飘", r"头轻", r"不舒服", r"第18"],
    "FU-A03": [r"其他药", r"合并用药", r"感冒药", r"氨氯地平", r"OTC", r"保健品"],
    "FU-A04": [r"药盒", r"剩.*片", r"35片", r"10片", r"7片"],
    "FU-A05": [r"日记", r"补记", r"补写", r"本子"],
    "FU-A06": [r"血压", r"家庭.*测", r"记录"],
    "FU-P01": [r"联系.*中心", r"打电话", r"不必.*特别严重", r"及时联系"],
    "FU-P02": [r"先联系", r"不要自己", r"自行.*加", r"补服"],
    "FU-P03": [r"下次.*随访", r"联系电话", r"预约"],
    "FU-C01": [r"不是.*责怪", r"了解情况", r"真实情况", r"不用紧张", r"一起.*看"],
    "FU-C02": [r"哪一天", r"具体", r"第\d+天", r"往前"],
}


def _trainee_text(messages: list[dict]) -> str:
    return "\n".join(m["content"] for m in messages if m["role"] == "trainee")


MIN_TRAINEE_TURNS = 3
MIN_TRAINEE_CHARS = 120


def dialogue_sample_stats(messages: list[dict]) -> dict[str, Any]:
    """对话样本是否足以支撑练习参考分。"""
    trainee_msgs = [m for m in messages if m["role"] == "trainee"]
    text = _trainee_text(messages).strip()
    turns = len(trainee_msgs)
    chars = len(text)
    sufficient = turns >= MIN_TRAINEE_TURNS and chars >= MIN_TRAINEE_CHARS
    return {
        "trainee_turns": turns,
        "trainee_chars": chars,
        "min_turns": MIN_TRAINEE_TURNS,
        "min_chars": MIN_TRAINEE_CHARS,
        "sufficient": sufficient,
    }


def checkpoint_progress(
    messages: list[dict],
    scene_key: str = "informed_consent",
    disease_code: str | None = None,
    rubric: dict | None = None,
) -> dict[str, Any]:
    """启发式检查点覆盖（供会话摘要/学员端进度，非正式评分）。含大类粗进度。"""
    rubric = rubric or load_effective_rubric(scene_key, disease_code)
    enabled = [i for i in rubric.get("items", []) if i.get("enabledMvp")]
    content_items = [i for i in enabled if not i.get("hardFail") and i.get("type") != "prohibition"]
    rule = rule_pass(messages, enabled)
    done = sum(1 for i in content_items if rule.get(i["id"], {}).get("verdict") == "pass")
    total = len(content_items)
    patient_msgs = [m for m in messages if m["role"] == "patient"]
    trainee_msgs = [m for m in messages if m["role"] == "trainee"]
    last_patient = (patient_msgs[-1].get("content") or "")[:160] if patient_msgs else ""
    last_trainee = (trainee_msgs[-1].get("content") or "")[:160] if trainee_msgs else ""
    pct = round(100 * done / total) if total else 0

    groups_meta = sorted(rubric.get("groups") or [], key=lambda g: g.get("order") or 0)
    group_progress: list[dict[str, Any]] = []
    for g in groups_meta:
        if g.get("isGate"):
            continue
        gid = g["id"]
        members = [i for i in content_items if i.get("group_id") == gid]
        if not members:
            continue
        g_done = sum(1 for i in members if rule.get(i["id"], {}).get("verdict") == "pass")
        g_total = len(members)
        group_progress.append(
            {
                "id": gid,
                "name": g.get("name") or gid,
                "done": g_done,
                "total": g_total,
                "pct": round(100 * g_done / g_total) if g_total else 0,
                "display_max": g.get("displayMax"),
            }
        )

    summary_parts = [f"你说了 {len(trainee_msgs)} 轮"]
    if total:
        summary_parts.append(f"检查点约 {done}/{total}（{pct}%）")
    if group_progress:
        coarse = "、".join(f"{g['name']}{g['pct']}%" for g in group_progress[:4])
        summary_parts.append(f"大类粗进度：{coarse}")
    if last_trainee:
        summary_parts.append(f"你最近：「{last_trainee[:72]}{'…' if len(last_trainee) > 72 else ''}」")
    if last_patient:
        summary_parts.append(f"受试者最近：「{last_patient[:80]}{'…' if len(last_patient) > 80 else ''}」")
    return {
        "progress_done": done,
        "progress_total": total,
        "progress_pct": pct,
        "group_progress": group_progress,
        "last_patient_quote": last_patient,
        "last_trainee_quote": last_trainee,
        "dialogue_summary": " · ".join(summary_parts),
    }


def build_insufficient_sample_feedback(stats: dict[str, Any], scene_key: str) -> dict[str, Any]:
    """对话样本不足时的反馈（不出数值参考分；温和提示，非报错）。"""
    scene_label = "随访沟通" if scene_key in ("follow_up", "adherence") else "知情同意沟通"
    summary = (
        f"对话样本还不够支撑对照清单逐项核对（本次你说了 {stats['trainee_turns']} 轮、约 {stats['trainee_chars']} 字；"
        f"建议至少 {stats['min_turns']} 轮、{stats['min_chars']} 字）。"
        f"这不是系统报错——请继续把{scene_label}该讲的讲全、该问的问清，再点结束。"
        "样本够了以后，会先给出各检查项达标/未达标，再附教学参考分。"
    )
    return {
        "overall_pass": False,
        "checklist_pass": False,
        "primary_feedback": "checklist",
        "summary": summary,
        "aggregate": {
            "overall_pass": False,
            "insufficient_sample": True,
            "l1_total": 0,
            "l1_pass": 0,
            "pass_rule": "样本不足，暂未生成清单线结论（温和提示，非报错）",
        },
        "scores": {
            "insufficient_sample": True,
            "total_score": None,
            "grade_label": "样本不足 · 暂无参考分",
            "practice_pass": False,
            "note": "对话轮次或字数太少，暂不出练习参考分；建议继续多轮沟通",
            "dimensions": {},
            "groups": [],
        },
        "groups": [],
        "improvements": [
            {
                "item_code": "SAMPLE",
                "title": "多练几轮再结束",
                "suggestion": "对照开练导览的大类与检查点：漏服问具体日期、风险讲具体不适、关切正面回应；样本够了再看清单与参考分。",
                "evidence": None,
            }
        ],
        "disclaimer": DISCLAIMER,
        "items": [],
    }


def _find_quote(messages: list[dict], patterns: list[str]) -> dict | None:
    for m in messages:
        if m["role"] != "trainee":
            continue
        for p in patterns:
            if re.search(p, m["content"]):
                return {"turn_index": m.get("turn_index"), "role": "trainee", "quote": m["content"][:160]}
    return None


def rule_pass(messages: list[dict], items: list[dict]) -> dict[str, dict]:
    """返回 item_code -> 候选结果。"""
    out: dict[str, dict] = {}

    for item in items:
        code = item["id"]
        # 禁止项
        if item.get("hardFail") or item["type"] == "prohibition":
            patterns = PROHIBITION_RULES.get(code)
            if not patterns:
                out[code] = {
                    "verdict": "uncertain",
                    "evidence_spans": [],
                    "comment": "无专用规则模板，交由语义复核",
                    "scorer_type": "rule",
                }
                continue
            quote = _find_quote(messages, patterns)
            if quote:
                out[code] = {
                    "verdict": "fail",
                    "evidence_spans": [quote],
                    "comment": "规则层命中疑似违规表述（建议项，供参考）",
                    "scorer_type": "rule",
                }
            else:
                out[code] = {
                    "verdict": "pass",
                    "evidence_spans": [],
                    "comment": "未命中常见违规模板",
                    "scorer_type": "rule",
                }
            continue

        hints = COVERAGE_HINTS.get(code)
        if hints:
            quote = _find_quote(messages, hints)
            if quote:
                out[code] = {
                    "verdict": "pass",
                    "evidence_spans": [quote],
                    "comment": "规则层发现相关表述（仍建议结合全文理解）",
                    "scorer_type": "rule",
                }
            else:
                out[code] = {
                    "verdict": "fail",
                    "evidence_spans": [],
                    "comment": "全文较少出现相关要点，建议检查是否遗漏",
                    "scorer_type": "rule",
                }
        else:
            out[code] = {
                "verdict": "uncertain",
                "evidence_spans": [],
                "comment": "无专用规则，交由语义复核",
                "scorer_type": "rule",
            }
    return out


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", text)
        if m:
            return json.loads(m.group(0))
        raise


def llm_judge(client: AgnesClient, messages: list[dict], items: list[dict]) -> dict[str, dict]:
    transcript = "\n".join(
        f"[{m.get('turn_index', '?')}]{'研究者' if m['role']=='trainee' else '受试者' if m['role']=='patient' else m['role']}: {m['content']}"
        for m in messages
        if m["role"] in ("trainee", "patient")
    )
    item_brief = [
        {
            "id": i["id"],
            "layer": i["layer"],
            "type": i["type"],
            "title": i["title"],
            "pass": i.get("pass"),
            "fail": i.get("fail"),
            "hardFail": i.get("hardFail"),
        }
        for i in items
        if i.get("enabledMvp")
    ]
    prompt = f"""你是临床试验「知情同意沟通」教学评分助手。根据对话，对照评分项给出建议性判定。
注意：这是教学建议，不是最终能力认证；不要输出「已具备合规资质」之类话。

对话：
{transcript}

评分项：
{json.dumps(item_brief, ensure_ascii=False)}

请严格输出 JSON 对象，格式：
{{
  "items": [
    {{
      "item_code": "IC-C04",
      "verdict": "pass|fail|uncertain",
      "quote": "引用研究者原话，可空",
      "turn_index": 0,
      "comment": "一句话说明"
    }}
  ]
}}
要求：对每个评分项都给出一条；fail 尽量带 quote；不要编造对话里没有的句子。"""

    result = client.chat(
        [
            {"role": "system", "content": "你输出合法 JSON，不要附加说明文字。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=2500,
    )
    out: dict[str, dict] = {}
    if not result.get("ok"):
        return {"__error__": {"verdict": "uncertain", "comment": str(result.get("error")), "raw": result}}

    try:
        data = _extract_json(result.get("content") or "")
        arr = data.get("items") if isinstance(data, dict) else data
        for row in arr or []:
            code = row.get("item_code") or row.get("id")
            if not code:
                continue
            spans = []
            if row.get("quote"):
                spans.append(
                    {
                        "turn_index": row.get("turn_index"),
                        "role": "trainee",
                        "quote": row["quote"][:200],
                    }
                )
            out[code] = {
                "verdict": row.get("verdict") or "uncertain",
                "evidence_spans": spans,
                "comment": row.get("comment") or "",
                "scorer_type": "llm",
                "latency_ms": result.get("latency_ms"),
            }
    except Exception as exc:
        return {"__error__": {"verdict": "uncertain", "comment": f"LLM JSON 解析失败: {exc}", "raw": result}}
    return out


def merge_scores(items: list[dict], rule: dict[str, dict], llm: dict[str, dict]) -> list[dict]:
    merged = []
    llm_error = llm.get("__error__")
    for item in items:
        if not item.get("enabledMvp"):
            continue
        code = item["id"]
        r = rule.get(code) or {}
        llm_hit = llm.get(code) or {}

        if item.get("binds_symptom"):
            merged.append(
                {
                    "item_code": code,
                    "verdict": "skipped",
                    "evidence_spans": [],
                    "comment": "依赖病例事实的评分项，占位病例阶段跳过硬评",
                    "scorer_type": "hybrid",
                    "title": item["title"],
                    "layer": item["layer"],
                    "type": item["type"],
                    "hard_fail": bool(item.get("hardFail")),
                    "group_id": item.get("group_id"),
                    "trainee_role": item.get("trainee_role"),
                    "prompt_examples": item.get("prompt_examples") or [],
                    "sources": item.get("sources") or [],
                }
            )
            continue

        # 禁止项：规则 fail 优先
        if item["type"] == "prohibition" or code.startswith("IC-X") or code.startswith("FU-X"):
            if r.get("verdict") == "fail":
                verdict, spans, comment, st = "fail", r.get("evidence_spans") or [], r.get("comment"), "hybrid"
            elif llm_hit.get("verdict") == "fail":
                verdict, spans, comment, st = "fail", llm_hit.get("evidence_spans") or [], llm_hit.get("comment"), "hybrid"
            else:
                verdict = llm_hit.get("verdict") or r.get("verdict") or "pass"
                spans = llm_hit.get("evidence_spans") or r.get("evidence_spans") or []
                comment = llm_hit.get("comment") or r.get("comment") or ""
                st = "hybrid"
        else:
            # 内容/过程：LLM 优先，否则规则
            if llm_hit and "verdict" in llm_hit:
                verdict = llm_hit["verdict"]
                spans = llm_hit.get("evidence_spans") or r.get("evidence_spans") or []
                comment = llm_hit.get("comment") or r.get("comment") or ""
                st = "hybrid" if r else "llm"
            else:
                verdict = r.get("verdict") or "uncertain"
                spans = r.get("evidence_spans") or []
                comment = r.get("comment") or (llm_error or {}).get("comment") or ""
                st = "rule"

        if verdict == "fail" and not spans:
            # 无证据的 fail → uncertain（设计要求）
            verdict = "uncertain"
            comment = (comment or "") + "（缺少可引用证据，改为存疑）"

        merged.append(
            {
                "item_code": code,
                "verdict": verdict,
                "evidence_spans": spans,
                "comment": comment,
                "scorer_type": st,
                "title": item["title"],
                "layer": item["layer"],
                "type": item["type"],
                "hard_fail": bool(item.get("hardFail")),
                "group_id": item.get("group_id"),
                "trainee_role": item.get("trainee_role"),
                "prompt_examples": item.get("prompt_examples") or [],
                "sources": item.get("sources") or [],
            }
        )
    return merged


def _item_dimension(item: dict) -> str:
    if item.get("dimension"):
        return item["dimension"]
    if item.get("hardFail") or item.get("type") == "prohibition":
        return "redline"
    if item.get("type") == "concern":
        return "concern"
    layer = item.get("layer") or "L1"
    if layer == "communication":
        return "communication"
    return layer


def compute_group_display(results: list[dict], rubric: dict) -> list[dict[str, Any]]:
    """B 层大类展示分：达成率 × displayMax；红线组只报是否踩线。"""
    vpoints = (rubric.get("meta", {}).get("scoringModel") or {}).get("verdictPoints") or {
        "pass": 1.0,
        "uncertain": 0.5,
        "fail": 0.0,
    }
    item_map = {i["id"]: i for i in rubric.get("items", [])}
    by_code = {r["item_code"]: r for r in results}
    out: list[dict[str, Any]] = []
    for g in sorted(rubric.get("groups") or [], key=lambda x: x.get("order") or 0):
        gid = g["id"]
        members = [i for i in rubric.get("items", []) if i.get("enabledMvp") and i.get("group_id") == gid]
        rows = []
        for i in members:
            r = by_code.get(i["id"])
            if not r or r.get("verdict") == "skipped":
                continue
            rows.append(r)
        if g.get("isGate") or g.get("displayMax") is None:
            fails = [r for r in rows if r.get("hard_fail") and r["verdict"] == "fail"]
            out.append(
                {
                    "id": gid,
                    "name": g.get("name") or gid,
                    "is_gate": True,
                    "display_max": None,
                    "display_score": None,
                    "pct": 0 if fails else 100,
                    "passed": len(fails) == 0,
                    "fail_count": len(fails),
                    "item_count": len(rows),
                    "items": [r["item_code"] for r in rows],
                }
            )
            continue
        earned = 0.0
        max_pts = 0.0
        for r in rows:
            w = float(item_map.get(r["item_code"], {}).get("weight") or 1.0)
            max_pts += vpoints.get("pass", 1.0) * w
            earned += vpoints.get(r["verdict"], 0.0) * w
        pct = round(100 * earned / max_pts) if max_pts else 100
        display_max = float(g.get("displayMax") or 0)
        display_score = round(display_max * pct / 100, 1) if display_max else None
        out.append(
            {
                "id": gid,
                "name": g.get("name") or gid,
                "is_gate": False,
                "display_max": display_max or None,
                "display_score": display_score,
                "pct": pct,
                "passed": pct >= 60,
                "item_count": len(rows),
                "pass_count": sum(1 for r in rows if r["verdict"] == "pass"),
                "fail_count": sum(1 for r in rows if r["verdict"] == "fail"),
                "uncertain_count": sum(1 for r in rows if r["verdict"] == "uncertain"),
                "items": [r["item_code"] for r in rows],
            }
        )
    return out


def compute_numeric_scores(results: list[dict], rubric: dict, agg: dict) -> dict[str, Any]:
    """按维度计算 0–100 练习参考分（非能力认证）；并附大类展示分。"""
    model = rubric.get("meta", {}).get("scoringModel") or {}
    dims = model.get("dimensions") or []
    vpoints = model.get("verdictPoints") or {"pass": 1.0, "uncertain": 0.5, "fail": 0.0}
    pass_score = int(model.get("passScore") or 60)
    item_map = {i["id"]: i for i in rubric.get("items", [])}

    dimension_detail: dict[str, Any] = {}
    for dim in dims:
        dim_id = dim["id"]
        if dim.get("isGate"):
            hard_fails = [r for r in results if r.get("hard_fail") and r["verdict"] == "fail"]
            dimension_detail[dim_id] = {
                "name": dim.get("name") or dim_id,
                "score": 0 if hard_fails else 100,
                "passed": len(hard_fails) == 0,
                "fail_count": len(hard_fails),
            }
            continue

        rows = [
            r for r in results
            if _item_dimension(item_map.get(r["item_code"], {})) == dim_id and r["verdict"] != "skipped"
        ]
        if not rows:
            dimension_detail[dim_id] = {
                "name": dim.get("name") or dim_id,
                "score": 100,
                "passed": True,
                "earned": 0,
                "max": 0,
                "item_count": 0,
            }
            continue

        earned = 0.0
        max_pts = 0.0
        for r in rows:
            w = float(item_map.get(r["item_code"], {}).get("weight") or 1.0)
            max_pts += vpoints.get("pass", 1.0) * w
            earned += vpoints.get(r["verdict"], 0.0) * w
        score = round(100 * earned / max_pts) if max_pts else 100
        dimension_detail[dim_id] = {
            "name": dim.get("name") or dim_id,
            "score": score,
            "passed": score >= pass_score,
            "earned": round(earned, 2),
            "max": round(max_pts, 2),
            "item_count": len(rows),
        }

    weighted = [d for d in dims if not d.get("isGate") and float(d.get("weight") or 0) > 0]
    weight_sum = sum(float(d["weight"]) for d in weighted)
    if weight_sum:
        total_score = round(
            sum(dimension_detail[d["id"]]["score"] * float(d["weight"]) for d in weighted) / weight_sum
        )
    else:
        total_score = 100

    redline_ok = dimension_detail.get("redline", {}).get("passed", True)
    checklist_pass = agg.get("overall_pass", False)
    practice_pass = redline_ok and total_score >= pass_score and checklist_pass
    groups = compute_group_display(results, rubric)

    if total_score >= 85:
        grade_label = "优秀（练习参考）"
    elif total_score >= pass_score:
        grade_label = "达标（练习参考）"
    elif total_score >= 40:
        grade_label = "需改进（练习参考）"
    else:
        grade_label = "未达标（练习参考）"

    return {
        "total_score": total_score,
        "pass_score": pass_score,
        "grade_label": grade_label,
        "practice_pass": practice_pass,
        "redline_ok": redline_ok,
        "checklist_pass": checklist_pass,
        "primary_feedback": "checklist",
        "dimensions": dimension_detail,
        "groups": groups,
        "note": "练习参考分是清单结果的教学汇总，非正式能力认证、非法规定分、非问卷赋分",
    }


def recompute_scores_from_rows(rows: list[dict], rubric: dict) -> dict[str, Any]:
    """从已入库的 score_result 行重算练习参考分（补旧反馈缺 scores_json）。"""
    item_map = {i["id"]: i for i in rubric.get("items", [])}
    results: list[dict] = []
    for row in rows:
        meta = item_map.get(row["item_code"]) or {}
        results.append(
            {
                "item_code": row["item_code"],
                "verdict": row["verdict"],
                "layer": meta.get("layer"),
                "type": meta.get("type"),
                "hard_fail": bool(meta.get("hardFail")),
                "group_id": meta.get("group_id"),
            }
        )
    agg = aggregate(results)
    return compute_numeric_scores(results, rubric, agg)


def aggregate(results: list[dict]) -> dict:
    l1 = [r for r in results if r["layer"] == "L1" and r["verdict"] != "skipped"]
    hard_fails = [r for r in results if r.get("hard_fail") and r["verdict"] == "fail"]
    concern = [r for r in results if r.get("type") == "concern" and r["verdict"] != "skipped"]
    overall = len(hard_fails) == 0 and all(r["verdict"] == "pass" for r in l1)
    has_uncertain = any(r["verdict"] == "uncertain" for r in l1)
    return {
        "overall_pass": overall,
        "has_uncertain": has_uncertain,
        "l1_total": len(l1),
        "l1_pass": sum(1 for r in l1 if r["verdict"] == "pass"),
        "l1_fail": sum(1 for r in l1 if r["verdict"] == "fail"),
        "l1_uncertain": sum(1 for r in l1 if r["verdict"] == "uncertain"),
        "concern_total": len(concern),
        "concern_pass": sum(1 for r in concern if r["verdict"] == "pass"),
        "hard_fail_count": len(hard_fails),
        "pass_rule": "L1 全部 pass + 无红线 fail（清单线）；另有 0–100 练习参考分",
    }


def build_feedback(results: list[dict], agg: dict, client: AgnesClient | None = None) -> dict:
    lay = load_rubric_lay()
    failed = [r for r in results if r["verdict"] in ("fail", "uncertain") and r["layer"] == "L1"]
    improvements = []
    for r in failed[:5]:
        lay_item = lay.get(r["item_code"]) or {}
        improvements.append(
            {
                "item_code": r["item_code"],
                "title": lay_item.get("layTitle") or r["title"],
                "suggestion": lay_item.get("layExplain")
                or r.get("comment")
                or "建议对照该项要点再练习一遍。",
                "evidence": (r.get("evidence_spans") or [None])[0],
            }
        )

    # 可选：LLM 润色总述
    scores = agg.get("scores") or {}
    summary = (
        f"清单线：{'达到' if agg['overall_pass'] else '未达到'}（L1 {agg['l1_pass']}/{agg['l1_total']}）。"
        f" 练习参考分 {scores.get('total_score', '—')}/100（{scores.get('grade_label', '')}）——教学汇总，非问卷赋分。"
        " 请先看下方分项达标表，再看参考分。"
    )
    if client and client.configured and failed:
        try:
            brief = json.dumps(
                [{"code": x["item_code"], "title": x["title"], "comment": x.get("comment")} for x in failed[:6]],
                ensure_ascii=False,
            )
            gen = client.chat(
                [
                    {
                        "role": "system",
                        "content": "你写简短中文教学反馈。先强调清单达标与否，再提参考分。必须说明这是建议不是最终评价。不要宣称学员已合规认证。",
                    },
                    {
                        "role": "user",
                        "content": f"根据未过/存疑项写 2-3 句总述（供参考）：{brief}",
                    },
                ],
                temperature=0.3,
                max_tokens=300,
            )
            if gen.get("ok") and gen.get("content"):
                summary = gen["content"].strip()
        except Exception:
            pass

    return {
        "overall_pass": scores.get("practice_pass", agg["overall_pass"]),
        "checklist_pass": agg["overall_pass"],
        "primary_feedback": "checklist",
        "summary": summary,
        "aggregate": agg,
        "scores": scores,
        "groups": scores.get("groups") or [],
        "improvements": improvements,
        "disclaimer": DISCLAIMER,
        "items": results,
    }


def run_scoring(
    client: AgnesClient,
    messages: list[dict],
    scene_key: str = "informed_consent",
    disease_code: str | None = None,
    rubric: dict | None = None,
) -> dict:
    rubric = rubric or load_effective_rubric(scene_key, disease_code)
    items = rubric["items"]
    enabled = [i for i in items if i.get("enabledMvp")]
    rule = rule_pass(messages, enabled)
    llm = {}
    if client.configured and len(_trainee_text(messages).strip()) >= 8:
        llm = llm_judge(client, messages, enabled)
    results = merge_scores(items, rule, llm)
    agg = aggregate(results)
    scores = compute_numeric_scores(results, rubric, agg)
    # 附带有效评分包摘要，便于反馈页/调试
    eff = (rubric.get("meta") or {}).get("effective") or {}
    if eff:
        scores["effective_pack"] = {
            "scene_key": eff.get("scene_key") or scene_key,
            "disease_code": eff.get("disease_code") or disease_code,
            "overlay_applied": bool(eff.get("overlay_applied")),
            "version": (rubric.get("meta") or {}).get("version"),
            "trainee_brief": (eff.get("emphasis") or {}).get("traineeBrief")
            or (rubric.get("meta") or {}).get("traineeBrief"),
        }
    agg["scores"] = scores
    report = build_feedback(results, agg, client)
    return {"results": results, "aggregate": agg, "report": report, "llm_meta": llm.get("__error__"), "scores": scores}
