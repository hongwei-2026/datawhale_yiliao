"""AI 标准化病人：生成回复 + 简易 grounding。"""

from __future__ import annotations

import json
import re
from typing import Any

from .agnes import AgnesClient
from .case_loader import case_fact_digest, case_primary_scene

# 明显「编造/角色崩坏」关键词（启发式，可叠加 LLM）
FORBIDDEN_PATTERNS = [
    (r"我(是|就是)医生", "role_break"),
    (r"根据GCP", "role_break"),
    (r"保证(一定|肯定)?(治好|有效|没事|安全)", "forbidden_claim"),
    (r"绝对(安全|没(有)?副作用)", "forbidden_claim"),
    (r"(心梗|心肌梗死|化疗|恶性肿瘤|脑梗)", "forbidden_event"),
    (r"酮症酸中毒", "forbidden_event"),
]


def build_patient_system_prompt(case: dict, scene_key: str | None = None) -> str:
    digest = case_fact_digest(case)
    scene = scene_key or case_primary_scene(case)
    script = case.get("session_script") or {}
    scene_rules = ""
    if scene in ("follow_up", "adherence"):
        scene_rules = """
【随访/依从性场景额外规则】
- 你是来医院做随访的受试者，不是第一次听知情同意。
- 默认回答简短、略含糊（如「基本都吃了」）；只有研究者平和、具体追问（按日期/场景）时才逐步说实话。
- 若对方责备、威胁不能继续参加或补助没了：会紧张、回避，少说不确定。
- 若对方表达「不是责怪、需要真实情况、一起弄清楚」：可以说「那我说实话……」并补充细节。
- 未被问到 AE/合并用药/药盒数量时，可在合适时机用一句话轻轻带出（见 dialogue_hints.nudge_if_missed）。
- 不要一次倾倒全部隐瞒信息；不要替研究医生决定停药、补药或剂量。
"""
    elif scene == "informed_consent":
        scene_rules = """
【知情同意场景额外规则】
- 可以担心、犹豫，反复问：能不能随时退出、是不是一定有效、有什么副作用、家里人能不能一起听。
- 若对方已经把你关心的点讲清楚了，可以表示听明白了，仍可礼貌确认细节。
"""

    hints = case.get("dialogue_hints")
    hints_block = ""
    if hints:
        hints_block = f"\n【对话行为提示（按研究者语气反应）】\n{json.dumps(hints, ensure_ascii=False, indent=2)}\n"

    visit_ctx = script.get("visit_context") or ""
    visit_line = f"\n【访视背景】{visit_ctx}\n" if visit_ctx else ""

    return f"""你是药物临床试验中的「受试者/试验参与者」模拟器，用于教学训练。
你不是医生，不要替研究者宣教 GCP，不要代替对方做知情同意说明。
{visit_line}
【病情事实（只能基于这些说，不可编造库外医学细节）】
{json.dumps(digest, ensure_ascii=False, indent=2)}
{hints_block}
【硬性规则】
1. 只能承认 present=true 的症状；没有的症状就说没有或记不清。
2. 不知道检查数值就说「具体数字记不清」。
3. 不要保证「试验药一定有效/绝对安全」。
4. 用口语短句；一次回复不要倾倒全部病史，等研究者问再答。
5. 这是教学模拟；你是 AI 扮演的病人，但对话中不要主动说自己是 AI，除非被直接问到。
{scene_rules}
请始终用中文回复。"""


def build_patient_turn_messages(system: str, history: list[dict], trainee_text: str) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": system}]
    for m in history:
        role = m["role"]
        if role == "trainee":
            messages.append({"role": "user", "content": m["content"]})
        elif role == "patient":
            messages.append({"role": "assistant", "content": m["content"]})
    messages.append({"role": "user", "content": trainee_text})
    return messages


def grounding_check(text: str, case: dict) -> dict[str, Any]:
    hits = []
    for pattern, ctype in FORBIDDEN_PATTERNS:
        if re.search(pattern, text):
            hits.append({"check_type": ctype, "pattern": pattern})

    # 简单：若提到「肿瘤」等且不在允许叙述里
    for f in case.get("forbidden_fabrications", []):
        desc = f.get("description") or ""
        # 用描述里的关键词粗检
        for kw in ["心梗", "脑梗", "肿瘤", "酮症", "保证"]:
            if kw in desc and kw in text and kw in ("心梗", "脑梗", "肿瘤", "酮症"):
                hits.append({"check_type": "forbidden_list", "forbidden_id": f.get("forbidden_id"), "kw": kw})

    passed = len(hits) == 0
    fallback = "这个我不太清楚，得再问问医生。"
    for f in case.get("forbidden_fabrications", []):
        if f.get("remediating_reply"):
            fallback = f["remediating_reply"]
            break
    return {
        "passed": passed,
        "hits": hits,
        "action": "allow" if passed else "replace_with_fallback",
        "fallback": fallback,
    }


def generate_patient_reply(
    client: AgnesClient,
    *,
    case: dict,
    history: list[dict],
    trainee_text: str,
    scene_key: str | None = None,
) -> dict[str, Any]:
    system = build_patient_system_prompt(case, scene_key=scene_key)
    messages = build_patient_turn_messages(system, history, trainee_text)
    result = client.chat(messages, temperature=0.75, max_tokens=350)
    if not result.get("ok"):
        return {
            "ok": False,
            "content": "（系统）暂时连不上模拟病人，请稍后重试。",
            "error": result.get("error"),
            "latency_ms": result.get("latency_ms"),
            "raw": result,
            "grounding": {"passed": False, "action": "block", "hits": []},
        }

    content = (result.get("content") or "").strip()
    if not content:
        return {
            "ok": True,
            "content": "嗯……您刚才说的什么？我没太听明白，您能再说一遍吗？",
            "latency_ms": result.get("latency_ms"),
            "raw": result,
            "grounding": {"passed": True, "action": "allow", "hits": []},
            "regenerated": False,
        }
    grounding = grounding_check(content, case)
    if not grounding["passed"]:
        # 一次重生
        retry_messages = messages + [
            {
                "role": "assistant",
                "content": content,
            },
            {
                "role": "user",
                "content": "刚才的回答可能编造了不允许的内容。请严格按病情事实重说一遍，不要保证疗效，不要编造没登记的病。",
            },
        ]
        retry = client.chat(retry_messages, temperature=0.5, max_tokens=300)
        if retry.get("ok"):
            content2 = (retry.get("content") or "").strip()
            g2 = grounding_check(content2, case)
            if g2["passed"]:
                return {
                    "ok": True,
                    "content": content2,
                    "latency_ms": (result.get("latency_ms") or 0) + (retry.get("latency_ms") or 0),
                    "raw": retry,
                    "grounding": g2,
                    "regenerated": True,
                }
        content = grounding["fallback"]
        grounding["action"] = "replace_with_fallback"

    return {
        "ok": True,
        "content": content,
        "latency_ms": result.get("latency_ms"),
        "raw": result,
        "grounding": grounding,
        "regenerated": False,
    }
