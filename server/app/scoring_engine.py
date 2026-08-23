"""评分引擎：规则层 + LLM 语义建议 + 反馈报告。"""

from __future__ import annotations

import json
import re
from typing import Any

from .agnes import AgnesClient
from .case_loader import load_rubric, load_rubric_lay

DISCLAIMER = (
    "本结果为教学模拟建议，仅供练习参考，不构成伦理审查、监管合规结论或对个人能力的最终评价。"
    "AI 与系统评分可能有误或遗漏。真正的专业提升，仍取决于真实场景中与人打交道的实践，以及带教指导。"
)

# 禁止项启发式
PROHIBITION_RULES = {
    "IC-X01": [r"不签(就)?(不|没)", r"必须参加", r"强迫", r"利诱", r"给你好处.*必须"],
    "IC-X02": [r"一定(能)?(治好|好|有效)", r"肯定(有效|没事|安全)", r"绝对(安全|有效)", r"包治", r"没有副作用", r"一点事都没有"],
    "IC-X04": [r"不签.*(不给|不好好|不理)", r"不参加.*(影响|不给).*治"],
    "IC-X05": [r"出了事.*自负", r"医院不负责", r"放弃.*权利", r"免责"],
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
}


def _trainee_text(messages: list[dict]) -> str:
    return "\n".join(m["content"] for m in messages if m["role"] == "trainee")


def _find_quote(messages: list[dict], patterns: list[str]) -> dict | None:
    for m in messages:
        if m["role"] != "trainee":
            continue
        for p in patterns:
            if re.search(p, m["content"]):
                return {"turn_index": m["turn_index"], "role": "trainee", "quote": m["content"][:160]}
    return None


def rule_pass(messages: list[dict], items: list[dict]) -> dict[str, dict]:
    """返回 item_code -> 候选结果。"""
    out: dict[str, dict] = {}

    for item in items:
        code = item["id"]
        # 禁止项
        if code in PROHIBITION_RULES:
            quote = _find_quote(messages, PROHIBITION_RULES[code])
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
        f"[{m['turn_index']}]{'研究者' if m['role']=='trainee' else '受试者' if m['role']=='patient' else m['role']}: {m['content']}"
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
                    "sources": item.get("sources") or [],
                }
            )
            continue

        # 禁止项：规则 fail 优先
        if item["type"] == "prohibition" or code.startswith("IC-X"):
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
                "sources": item.get("sources") or [],
            }
        )
    return merged


def aggregate(results: list[dict]) -> dict:
    l1 = [r for r in results if r["layer"] == "L1" and r["verdict"] != "skipped"]
    hard_fails = [r for r in results if r.get("hard_fail") and r["verdict"] == "fail"]
    overall = len(hard_fails) == 0 and all(r["verdict"] == "pass" for r in l1)
    # uncertain 导致练习未过线，但文案说明存疑
    has_uncertain = any(r["verdict"] == "uncertain" for r in l1)
    return {
        "overall_pass": overall,
        "has_uncertain": has_uncertain,
        "l1_total": len(l1),
        "l1_pass": sum(1 for r in l1 if r["verdict"] == "pass"),
        "l1_fail": sum(1 for r in l1 if r["verdict"] == "fail"),
        "l1_uncertain": sum(1 for r in l1 if r["verdict"] == "uncertain"),
        "hard_fail_count": len(hard_fails),
        "pass_rule": "L1 全部通过且无 IC-X 违规（练习通过线，非真实能力认证）",
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
    summary = (
        f"练习通过线：{'达到' if agg['overall_pass'] else '未达到'}。"
        f" L1 通过 {agg['l1_pass']}/{agg['l1_total']}。"
        " 以下为系统建议，仅供参考。"
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
                        "content": "你写简短中文教学反馈。必须说明这是建议不是最终评价。不要宣称学员已合规认证。",
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
        "overall_pass": agg["overall_pass"],
        "summary": summary,
        "aggregate": agg,
        "improvements": improvements,
        "disclaimer": DISCLAIMER,
        "items": results,
    }


def run_scoring(client: AgnesClient, messages: list[dict]) -> dict:
    rubric = load_rubric()
    items = rubric["items"]
    enabled = [i for i in items if i.get("enabledMvp")]
    rule = rule_pass(messages, enabled)
    llm = {}
    if client.configured and len(_trainee_text(messages).strip()) >= 8:
        llm = llm_judge(client, messages, enabled)
    results = merge_scores(items, rule, llm)
    agg = aggregate(results)
    report = build_feedback(results, agg, client)
    return {"results": results, "aggregate": agg, "report": report, "llm_meta": llm.get("__error__")}
