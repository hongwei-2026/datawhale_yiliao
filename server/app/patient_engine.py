"""受试者情绪与披露引擎：规则更新状态，LLM 只负责说人话。"""

from __future__ import annotations

import json
import re
from typing import Any

# 学员端展示用（人话）
STANCE_LABELS: dict[str, str] = {
    "cooperative": "愿意配合",
    "guarded": "有所保留",
    "defensive": "有点抵触",
    "withdrawn": "不太想多说",
    "relieved": "放松了一些",
}

DEPTH_LABELS: dict[int, str] = {
    0: "基本不说实话",
    1: "说得比较笼统",
    2: "开始暗示一些情况",
    3: "愿意讲具体细节",
}

STANCE_TTS: dict[str, str] = {
    "cooperative": "neutral",
    "guarded": "neutral",
    "defensive": "angry",
    "withdrawn": "sad",
    "relieved": "happy",
}

STANCE_LIVE2D: dict[str, str] = {
    "cooperative": "Smile",
    "guarded": "Normal",
    "defensive": "Angry",
    "withdrawn": "Sad",
    "relieved": "Smile",
}

SPEAK_STYLE: dict[str, str] = {
    "cooperative": "语气自然，可以多说一两句",
    "guarded": "短句、含糊，不主动展开",
    "defensive": "短句，略带委屈或反问，但不骂人",
    "withdrawn": "极短，像不想继续聊",
    "relieved": "语气松下来，可以说「那我说实话」",
}


def default_emotion(case: dict) -> dict[str, Any]:
    """新开一场练习时的初始心情。"""
    persona = case.get("persona") or {}
    conceal = persona.get("concealment_tendency") or "moderate"
    baseline = persona.get("emotion_baseline") or ""

    trust = 55
    if conceal == "low":
        trust = 62
    elif conceal in ("high", "moderate"):
        trust = 48 if conceal == "high" else 52

    depth = 1
    if baseline.startswith("anxious"):
        stance = "guarded"
    else:
        stance = "cooperative"

    return {
        "trust": trust,
        "disclosure_depth": depth,
        "stance": stance,
        "last_branches": [],
        "disclosed_concerns": [],
        "turn_count": 0,
        "stance_label": STANCE_LABELS.get(stance, stance),
        "depth_label": DEPTH_LABELS.get(depth, ""),
        "tts_emotion": STANCE_TTS.get(stance, "neutral"),
        "live2d_exp": STANCE_LIVE2D.get(stance, "Normal"),
    }


def _parse_meta_emotion(meta_json: str | None) -> dict[str, Any]:
    if not meta_json:
        return {}
    try:
        obj = json.loads(meta_json)
        em = obj.get("emotion")
        return em if isinstance(em, dict) else {}
    except json.JSONDecodeError:
        return {}


def load_emotion(meta_json: str | None, case: dict) -> dict[str, Any]:
    em = _parse_meta_emotion(meta_json)
    base = default_emotion(case)
    for k, v in base.items():
        if k not in em:
            em[k] = v
    em["trust"] = max(0, min(100, int(em.get("trust", base["trust"]))))
    em["disclosure_depth"] = max(0, min(3, int(em.get("disclosure_depth", base["disclosure_depth"]))))
    if em.get("stance") not in STANCE_LABELS:
        em["stance"] = base["stance"]
    em.setdefault("disclosed_concerns", [])
    em.setdefault("last_branches", [])
    em.setdefault("turn_count", 0)
    return em


def _match_dialogue_hints(trainee_text: str, hints: dict) -> list[str]:
    matched: list[str] = []
    if not hints:
        return matched
    for key, spec in hints.items():
        if key == "nudge_if_missed" or not isinstance(spec, dict):
            continue
        patterns = spec.get("trigger_patterns") or []
        for pat in patterns:
            try:
                if re.search(pat, trainee_text, re.I):
                    matched.append(key)
                    break
            except re.error:
                continue
    return matched


def _persona_trust_scale(persona: dict) -> float:
    c = persona.get("concealment_tendency") or "moderate"
    if c == "low":
        return 0.7
    if c == "high":
        return 1.3
    return 1.0


def update_emotion(
    emotion: dict[str, Any],
    *,
    trainee_text: str,
    case: dict,
) -> dict[str, Any]:
    """根据研究者这句话，更新受试者心情（确定性规则）。"""
    hints = case.get("dialogue_hints") or {}
    persona = case.get("persona") or {}
    scale = _persona_trust_scale(persona)
    branches = _match_dialogue_hints(trainee_text, hints)

    em = dict(emotion)
    em["turn_count"] = int(em.get("turn_count") or 0) + 1
    em["last_branches"] = branches

    trust = int(em["trust"])
    depth = int(em["disclosure_depth"])
    stance = em["stance"]

    # 额外通用语气（不依赖病例 hints）
    if re.search(r"不着急|慢慢|可以问|有问题", trainee_text):
        branches.append("_calm")
    if re.search(r"都吃了吧|没问题吧|还好吧", trainee_text):
        branches.append("_vague")

    if "if_blame" in branches or "_blame" in branches:
        trust -= int(25 * scale)
        depth = max(0, depth - 1)
        stance = "defensive"
    elif re.search(r"怎么能|为什么不按|责备", trainee_text):
        trust -= int(22 * scale)
        depth = max(0, depth - 1)
        stance = "defensive"
        branches.append("if_blame")

    if "if_threaten_dropout" in branches:
        trust -= int(35 * scale)
        depth = max(0, depth - 1)
        stance = "defensive"

    if "if_reassure" in branches or "_calm" in branches:
        trust += int(15 / scale)
        if stance in ("defensive", "withdrawn"):
            stance = "relieved"
        elif stance == "guarded":
            stance = "cooperative"

    if "if_vague_question" in branches or "_vague" in branches:
        depth = min(depth, 1)
        if stance == "cooperative":
            stance = "guarded"

    if "if_day_by_day" in branches:
        if trust >= 38:
            depth = min(3, depth + 1)
        trust += 5

    if re.search(r"哪一天|第\d+天|具体|往前", trainee_text) and trust >= 35:
        depth = min(3, depth + 1)

    if re.search(r"感冒药|合并|其他药|OTC|保健品", trainee_text, re.I):
        disclosed = list(em.get("disclosed_concerns") or [])
        if "KC-CM-01" not in disclosed and depth >= 2:
            disclosed.append("KC-CM-01")
        em["disclosed_concerns"] = disclosed

    if trust < 18:
        stance = "withdrawn"
    elif trust < 35 and stance == "cooperative":
        stance = "guarded"

    em["trust"] = max(0, min(100, trust))
    em["disclosure_depth"] = max(0, min(3, depth))
    em["stance"] = stance
    em["tts_emotion"] = STANCE_TTS.get(stance, "neutral")
    em["live2d_exp"] = STANCE_LIVE2D.get(stance, "Normal")
    em["stance_label"] = STANCE_LABELS.get(stance, stance)
    em["depth_label"] = DEPTH_LABELS.get(em["disclosure_depth"], "")
    return em


def _concern_snippets(case: dict, depth: int) -> list[str]:
    """按披露深度，整理「本轮允许提到的」事实片段。"""
    allowed: list[str] = []
    persona = case.get("persona") or {}
    allowed.append(f"人设：{persona.get('lay_bio') or persona.get('display_label') or '受试者'}")

    for c in case.get("key_concerns") or []:
        topic = c.get("topic") or ""
        rule = c.get("disclosure_rule") or ""
        cid = c.get("concern_id") or ""
        if depth <= 1:
            if "含糊" in rule or depth == 1:
                allowed.append(f"「{topic}」：先笼统说，不要一次讲全部细节（{rule[:60]}）")
        elif depth == 2:
            allowed.append(f"「{topic}」：可以暗示或部分承认（{rule[:80]}）")
        else:
            allowed.append(f"「{topic}」：可按病例具体说（{rule}）")
            for q in (c.get("patient_may_ask") or [])[:1]:
                allowed.append(f"  可主动问：{q}")

    if depth >= 2:
        for s in case.get("symptoms") or []:
            if not s.get("present"):
                continue
            for line in (s.get("patient_may_say") or [])[:2]:
                allowed.append(f"症状可说：{line}")

    hints = case.get("dialogue_hints") or {}
    nudges = hints.get("nudge_if_missed") or []
    if depth >= 1 and em_turn_ok(depth):
        for n in nudges[:2]:
            if isinstance(n, dict) and n.get("line"):
                allowed.append(f"若合适可轻轻带出一句：{n['line']}")

    return allowed


def em_turn_ok(depth: int) -> bool:
    return depth >= 1


def build_emotion_plan(emotion: dict[str, Any], case: dict) -> dict[str, Any]:
    depth = int(emotion.get("disclosure_depth") or 1)
    stance = emotion.get("stance") or "guarded"
    persona = case.get("persona") or {}
    fears: list[str] = []
    if persona.get("occupation") == "taxi_driver":
        fears.append("怕做错不能继续参加、怕补助没了")
    if persona.get("comprehension_style") == "repeats_key_questions":
        fears.append("听不太懂时会反复问退出、疗效")

    felt_map = {
        "defensive": "觉得被责备或不被信任，想少说点",
        "withdrawn": "不太想继续聊，怕说错话",
        "relieved": "对方态度平和，愿意多说一点",
        "guarded": "还在观望，看对方是不是真关心",
        "cooperative": "感觉还可以，正常配合",
    }

    return {
        "stance": stance,
        "stance_label": emotion.get("stance_label") or STANCE_LABELS.get(stance, ""),
        "disclosure_depth": depth,
        "depth_label": emotion.get("depth_label") or DEPTH_LABELS.get(depth, ""),
        "trust": emotion.get("trust"),
        "felt": felt_map.get(stance, "按人设自然反应"),
        "speak_style": SPEAK_STYLE.get(stance, "口语短句"),
        "core_fears": fears,
        "allowed_facts": _concern_snippets(case, depth),
        "forbidden_this_turn": [
            "不要一次倒出全部隐瞒信息",
            "不要替研究医生决定停药、补药或剂量",
            "不要主动背规范条文",
        ],
    }


def build_turn_user_prompt(
    trainee_text: str,
    plan: dict[str, Any],
    branches: list[str],
) -> str:
    branch_note = "、".join(branches) if branches else "（未识别特殊语气）"
    allowed = plan.get("allowed_facts") or []
    fears = plan.get("core_fears") or []
    return f"""【受试者当前心情】
- 状态：{plan.get('stance_label')}（信任度约 {plan.get('trust')}/100）
- 愿意说到什么程度：{plan.get('depth_label')}
- 内心感受：{plan.get('felt')}
- 说话方式：{plan.get('speak_style')}
{f'- 特别担心：{"；".join(fears)}' if fears else ''}

【研究者刚才的语气】{branch_note}

【本轮可以说的话题】
{chr(10).join(f'- {a}' for a in allowed[:12])}

【本轮不要说】
{chr(10).join(f'- {x}' for x in (plan.get('forbidden_this_turn') or []))}

研究者刚说：「{trainee_text}」

请以受试者身份回复 1–4 句口语。不要括号动作描写；不要 Markdown。"""


def public_affect(emotion: dict[str, Any]) -> dict[str, Any]:
    """返回给前端的摘要（不含内部调试字段）。"""
    stance = emotion.get("stance")
    depth = emotion.get("disclosure_depth")
    if depth is not None:
        try:
            depth = int(depth)
        except (TypeError, ValueError):
            depth = None
    return {
        "trust": emotion.get("trust"),
        "disclosure_depth": depth,
        "stance": stance,
        "stance_label": emotion.get("stance_label") or STANCE_LABELS.get(stance or "", "等待对话"),
        "depth_label": emotion.get("depth_label") or (DEPTH_LABELS.get(depth, "—") if depth is not None else "—"),
        "tts_emotion": emotion.get("tts_emotion"),
        "live2d_exp": emotion.get("live2d_exp"),
    }
