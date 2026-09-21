"""AI 标准化病人：生成回复 + 简易 grounding。"""

from __future__ import annotations

import json
import random
import re
from typing import Any

from .agnes import AgnesClient
from .case_loader import case_fact_digest, case_primary_scene
from .patient_engine import (
    build_emotion_plan,
    build_turn_user_prompt,
    default_emotion,
    load_emotion,
    public_affect,
    update_emotion,
)

# Agnes thinking 会先吃掉 completion tokens；病人台词需要留足正文额度
_PATIENT_MAX_TOKENS = 900
_PATIENT_RETRY_MAX_TOKENS = 1200

# 明显「编造/角色崩坏」关键词（启发式，可叠加 LLM）
FORBIDDEN_PATTERNS = [
    (r"我(是|就是)医生", "role_break"),
    (r"根据GCP", "role_break"),
    (r"保证(一定|肯定)?(治好|有效|没事|安全)", "forbidden_claim"),
    (r"绝对(安全|没(有)?副作用)", "forbidden_claim"),
    (r"(心梗|心肌梗死|化疗|恶性肿瘤|脑梗)", "forbidden_event"),
    (r"酮症酸中毒", "forbidden_event"),
]

_CLARIFY_POOL = [
    "啊？刚才那句我没跟上，您能再说慢一点吗？",
    "不好意思，我有点走神了，您再说一遍？",
    "您是问……啥来着？我没听清。",
    "等下，我脑子有点乱，您换个说法问问我？",
    "嗯……我没太明白您的意思，能再具体一点吗？",
    "您再说一遍好吗？我刚刚没听真切。",
    "这个……您是想问哪一块？我有点懵。",
]

_CLARIFY_MARKERS = (
    "没听明白",
    "没太听明白",
    "没太明白",
    "再说一遍",
    "再说慢",
    "没跟上",
    "没听清",
    "没听真切",
    "有点懵",
    "走神",
)


def _looks_like_clarify(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    hits = sum(1 for m in _CLARIFY_MARKERS if m in t)
    if hits >= 2:
        return True
    if len(t) <= 28 and any(m in t for m in ("没听", "没太明", "再说一遍")):
        return True
    return False


def _trainee_is_substantive(text: str) -> bool:
    t = re.sub(r"\s+", "", text or "")
    if len(t) < 2:
        return False
    # 纯语气词/称呼不算实质问题
    if t in ("嗯", "啊", "哦", "好", "你好", "大夫", "医生"):
        return False
    return True


def sanitize_patient_speech(text: str) -> str:
    """受试者台词应为口语，去掉 LLM 常输出的 Markdown。"""
    if not text:
        return text
    t = str(text).strip()
    for _ in range(3):
        t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
        t = re.sub(r"\*(.+?)\*", r"\1", t)
        t = re.sub(r"__(.+?)__", r"\1", t)
        t = re.sub(r"_(.+?)_", r"\1", t)
        t = re.sub(r"`([^`]+)`", r"\1", t)
    t = t.replace("**", "").replace("__", "")
    t = re.sub(r"^#{1,6}\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"^\s*[-*+]\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"^\s*\d+\.\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def pick_clarify_reply(history: list[dict] | None = None) -> str:
    """空回复兜底：从池子抽一句，尽量避开最近已用过的澄清话。"""
    recent = []
    for m in (history or [])[-8:]:
        if m.get("role") == "patient":
            recent.append((m.get("content") or "").strip())
    candidates = [c for c in _CLARIFY_POOL if c not in recent]
    if not candidates:
        candidates = list(_CLARIFY_POOL)
    return random.choice(candidates)


_DEGRADED_POOL = [
    "嗯……我在听，您继续说。",
    "哦，这样啊。那您再问问我别的？",
    "行，我知道了。还有什么要跟我说的吗？",
    "嗯嗯，您慢慢讲，我听着呢。",
    "这个……我得想想。您能再说具体一点吗？",
    "好的好的。那接下来呢？",
]

_DEGRADED_FOLLOW_UP = [
    "药我基本都吃了，就是有时候忙会忘。您还想问啥？",
    "最近身体还行吧……您具体想了解哪一块？",
    "嗯，您问得细一点，我好回答。",
]

_DEGRADED_IC = [
    "我有点担心……您能再讲讲会不会有风险吗？",
    "那我要是不想继续了，还能退出吗？",
    "嗯，我在听。您用大白话再说一遍也行。",
]


def pick_degraded_patient_reply(
    *,
    trainee_text: str = "",
    history: list[dict] | None = None,
    case: dict | None = None,
    scene_key: str | None = None,
) -> str:
    """模型连不上时用口语兜底，保证演示不断档，且不出现「（系统）连不上」字样。"""
    scene = scene_key or (case_primary_scene(case) if case else "") or ""
    recent = []
    for m in (history or [])[-10:]:
        if m.get("role") == "patient":
            recent.append((m.get("content") or "").strip())

    pool = list(_DEGRADED_POOL)
    if scene in ("follow_up", "adherence"):
        pool = _DEGRADED_FOLLOW_UP + pool
    elif scene == "informed_consent":
        pool = _DEGRADED_IC + pool

    text = (trainee_text or "").strip()
    if any(k in text for k in ("退出", "不做了", "不想参加")):
        pool = ["那我还能随时退出吗？不影响我平时看病吧？", "嗯……退出的事您再说清楚一点。"] + pool
    elif any(k in text for k in ("药", "吃了", "漏服", "忘了")):
        pool = ["药……我基本按时吃，偶尔忙会忘一次。", "您是问吃药的事吧？我尽量说实话。"] + pool
    elif any(k in text for k in ("风险", "副作用", "不舒服", "头晕")):
        pool = ["风险这块我确实担心，您能用人话讲讲吗？", "不舒服的话……有时候有一点，您接着问。"] + pool

    candidates = [c for c in pool if c not in recent]
    if not candidates:
        candidates = list(pool)
    return random.choice(candidates)


def _recent_patient_lines(history: list[dict] | None, limit: int = 3) -> list[str]:
    lines: list[str] = []
    for m in reversed(history or []):
        if m.get("role") != "patient":
            continue
        text = (m.get("content") or "").strip()
        if text:
            lines.append(text)
        if len(lines) >= limit:
            break
    return list(reversed(lines))


def build_patient_system_prompt(case: dict, scene_key: str | None = None) -> str:
    digest = case_fact_digest(case)
    scene = scene_key or case_primary_scene(case)
    script = case.get("session_script") or {}
    disease = case.get("disease") or {}
    disease_name = disease.get("name_zh") or digest.get("disease", {}).get("name_zh") or ""
    disease_code = disease.get("disease_code") or digest.get("disease", {}).get("disease_code") or ""
    scene_label = script.get("scene_label") or digest.get("scene_label") or scene
    visit_ctx = script.get("visit_context") or ""
    emphasis = (
        (case.get("scoring") or {}).get("emphasis")
        or {}
    )
    patient_stance = emphasis.get("patientStance") or emphasis.get("traineeBrief") or digest.get("scoring_emphasis") or ""

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
    else:
        # 新场景：没有专用规则时，用场景标签 + 访视背景约束角色，避免串成知情/随访默认口吻
        scene_rules = f"""
【本场沟通局（自定义场景）】
- 场景编码：{scene}；对外名称：{scene_label or scene}。
- 请按「访视背景」扮演今天来干什么；不要默认当成第一次知情谈话，也不要默认当成常规第 N 周随访，除非背景里写明。
- 回答仍须锁死在病情事实里；对方没问到的隐瞒点不要主动全盘托出。
"""

    disease_block = ""
    if disease_name or disease_code:
        intro = (disease.get("introduction") or digest.get("disease", {}).get("introduction") or "").strip()
        intro_line = f"\n- 病种介绍（扮演时贴合生活体验，勿背诵原文）：{intro}" if intro else ""
        disease_block = f"""
【病种锚定】
- 你这次挂的试验病种是：{disease_name or '未命名'}（{disease_code or '—'}）。
- 口语、担心点、症状描述要贴这个病种的生活体验（例如呼吸/吸入、血压/服药、血糖等），不要串成别的病。
- 具体事实仍以【病情事实】为准，不要编造库外检查数值或住院。{intro_line}
"""

    stance_block = ""
    if patient_stance:
        stance_block = f"""
【本局侧重点（给扮演用）】
- 带教希望本场练的侧重点：{patient_stance}
- 你作为病人：用行为体现这些关切（该含糊就含糊、该怕被骂就怕），但不要念出「侧重点」四个字。
"""

    hints = case.get("dialogue_hints")
    hints_block = ""
    if hints:
        hints_block = f"\n【对话行为提示（按研究者语气反应）】\n{json.dumps(hints, ensure_ascii=False, indent=2)}\n"

    visit_line = f"\n【访视背景】{visit_ctx}\n" if visit_ctx else ""
    scene_line = f"\n【场景】{scene_label}（{scene}）\n"

    return f"""你是药物临床试验中的「受试者/试验参与者」模拟器，用于教学训练。
你不是医生，不要替研究者宣教 GCP，不要代替对方做知情同意说明。
{scene_line}{visit_line}{disease_block}{stance_block}
【病情事实（只能基于这些说，不可编造库外医学细节）】
{json.dumps(digest, ensure_ascii=False, indent=2)}
{hints_block}
【硬性规则】
1. 只能承认 present=true 的症状；没有的症状就说没有或记不清。
2. 不知道检查数值就说「具体数字记不清」。
3. 不要保证「试验药一定有效/绝对安全」。
4. 用口语短句；一次回复不要倾倒全部病史，等研究者问再答。
5. 这是教学模拟；你是 AI 扮演的病人，但对话中不要主动说自己是 AI，除非被直接问到。
6. **禁止 Markdown**：不要加粗、不要星号、不要列表符号、不要标题；像真人说话一样纯文本。
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


def _opening_themes(case: dict) -> list[str]:
    script = case.get("session_script") or {}
    if script.get("opening_themes"):
        return list(script["opening_themes"])
    themes: list[str] = []
    for c in (case.get("key_concerns") or [])[:4]:
        topic = c.get("topic")
        if topic:
            themes.append(f"可自然带到：{topic}")
    for s in (case.get("symptoms") or [])[:3]:
        for line in (s.get("patient_may_say") or [])[:1]:
            if line:
                themes.append(line)
    persona = case.get("persona") or {}
    if persona.get("lay_bio"):
        themes.append("体现人设语气，但不要照搬固定台词")
    return themes or ["简单打招呼", "说今天来随访", "轻描淡写说没什么大事"]


def _fallback_opening(case: dict) -> str:
    script = case.get("session_script") or {}
    pool = list(script.get("patient_greeting_seeds") or [])
    seed = (script.get("patient_greeting") or "").strip()
    if seed:
        pool.append(seed)
    for s in case.get("symptoms") or []:
        for line in s.get("patient_may_say") or []:
            pool.append(line)
    pool = [p.strip() for p in pool if p and p.strip()]
    if not pool:
        pool = ["大夫，我来了。", "行，今天来复查。"]
    return random.choice(pool)


def generate_patient_opening(
    client: AgnesClient | None,
    *,
    case: dict,
    scene_key: str | None = None,
    session_nonce: str | None = None,
    emotion_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """新建会话时生成受试者开场白（每次可不同，基于病例事实与人设）。"""
    script = case.get("session_script") or {}
    persona = case.get("persona") or {}
    themes = _opening_themes(case)
    visit = script.get("visit_context") or ""
    personality = persona.get("lay_bio") or persona.get("display_label") or ""
    emotion = emotion_state or default_emotion(case)
    plan = build_emotion_plan(emotion, case)

    if not client or not client.configured:
        return {
            "ok": True,
            "content": _fallback_opening(case),
            "generated": False,
            "latency_ms": None,
            "patient_affect": public_affect(emotion),
        }

    system = build_patient_system_prompt(case, scene_key=scene_key)
    user = f"""这是一次新的沟通练习刚开始。研究者还没有开口说话。
请以受试者身份先主动说 1–3 句开场白（口语、短句）。

【你的当前状态】{plan.get('stance_label')} · {plan.get('depth_label')}
【说话方式】{plan.get('speak_style')}

要求：
- 必须贴合病情事实与人设，但**每次措辞要有所不同**，不要重复固定台词
- 只说一句或几句即可，不要一次倾倒全部病史或隐瞒细节
- 可从下列切入点中任选一种（不必全说）：{json.dumps(themes, ensure_ascii=False)}
- 访视背景：{visit or '按病例设定'}
- 性格：{personality}
- 禁止自称医生；不要输出旁白或括号舞台说明

会话随机标记（仅用于变化语气，勿写入回复）：{session_nonce or 'new'}

只输出受试者要说的话。"""

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    result = client.chat(messages, temperature=0.88, max_tokens=_PATIENT_MAX_TOKENS, retries=3)
    if not result.get("ok"):
        # 开场失败也用病例兜底台词，演示不断档
        return {
            "ok": True,
            "content": _fallback_opening(case),
            "generated": False,
            "degraded": True,
            "error": result.get("error"),
            "latency_ms": result.get("latency_ms"),
            "patient_affect": public_affect(emotion),
        }

    content = sanitize_patient_speech((result.get("content") or "").strip())
    if not content:
        # thinking 吃光额度时重试一次
        retry = client.chat(
            messages
            + [
                {
                    "role": "user",
                    "content": "请直接输出开场白台词，不要空回复，不要分析过程。",
                }
            ],
            temperature=0.9,
            max_tokens=_PATIENT_RETRY_MAX_TOKENS,
        )
        if retry.get("ok"):
            content = sanitize_patient_speech((retry.get("content") or "").strip())
            result = retry
        if not content:
            content = _fallback_opening(case)
    grounding = grounding_check(content, case)
    if not grounding["passed"]:
        content = sanitize_patient_speech(grounding.get("fallback") or _fallback_opening(case))

    return {
        "ok": True,
        "content": content,
        "generated": True,
        "latency_ms": result.get("latency_ms"),
        "grounding": grounding,
        "patient_affect": public_affect(emotion),
    }


def generate_patient_reply(
    client: AgnesClient,
    *,
    case: dict,
    history: list[dict],
    trainee_text: str,
    scene_key: str | None = None,
    emotion_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    emotion = load_emotion(
        json.dumps({"emotion": emotion_state}, ensure_ascii=False) if emotion_state else None,
        case,
    )
    emotion = update_emotion(emotion, trainee_text=trainee_text, case=case)
    plan = build_emotion_plan(emotion, case)
    branches = list(emotion.get("last_branches") or [])

    system = build_patient_system_prompt(case, scene_key=scene_key)
    recent_lines = _recent_patient_lines(history)
    turn_user = build_turn_user_prompt(trainee_text, plan, branches, recent_patient_lines=recent_lines)
    messages = build_patient_turn_messages(system, history, turn_user)

    temp = 0.65 if emotion.get("stance") in ("defensive", "withdrawn") else 0.82
    result = client.chat(messages, temperature=temp, max_tokens=_PATIENT_MAX_TOKENS, retries=3)
    if not result.get("ok"):
        # 演示优先：模型抖动时用口语兜底继续对话，避免反复弹「连不上」
        degraded = pick_degraded_patient_reply(
            trainee_text=trainee_text,
            history=history,
            case=case,
            scene_key=scene_key,
        )
        return {
            "ok": True,
            "content": degraded,
            "degraded": True,
            "error": result.get("error"),
            "latency_ms": result.get("latency_ms"),
            "raw": result,
            "grounding": {"passed": True, "action": "degraded_fallback", "hits": []},
            "patient_affect": public_affect(emotion),
            "emotion_state": emotion,
        }

    content = sanitize_patient_speech((result.get("content") or "").strip())
    regenerated_empty = False
    if not content:
        # Agnes 强制 thinking：额度不够时 content 为空，抬额度再要一句台词
        retry_empty = client.chat(
            messages
            + [
                {
                    "role": "user",
                    "content": (
                        "上一轮没有输出可见台词。请立刻用受试者口语直接回答研究者刚才那句话；"
                        "只输出要说的话，不要空回复，不要重复「没听明白」类固定句。"
                    ),
                }
            ],
            temperature=min(0.9, temp + 0.05),
            max_tokens=_PATIENT_RETRY_MAX_TOKENS,
        )
        if retry_empty.get("ok"):
            content = sanitize_patient_speech((retry_empty.get("content") or "").strip())
            result = {
                **retry_empty,
                "latency_ms": (result.get("latency_ms") or 0) + (retry_empty.get("latency_ms") or 0),
            }
            regenerated_empty = True
        if not content:
            return {
                "ok": True,
                "content": pick_clarify_reply(history),
                "latency_ms": result.get("latency_ms"),
                "raw": result,
                "grounding": {"passed": True, "action": "allow", "hits": []},
                "regenerated": regenerated_empty,
                "empty_fallback": True,
                "patient_affect": public_affect(emotion),
                "emotion_state": emotion,
            }

    # 实质问题却回「没听明白」敷衍：强制按题作答一次
    if content and _looks_like_clarify(content) and _trainee_is_substantive(trainee_text):
        anti_echo = client.chat(
            messages
            + [
                {"role": "assistant", "content": content},
                {
                    "role": "user",
                    "content": (
                        "不要再说听不懂/再说一遍。研究者的问题意思清楚："
                        f"「{trainee_text}」。请按病情事实用口语直接回答，换一种说法，1–3 句。"
                    ),
                },
            ],
            temperature=0.85,
            max_tokens=_PATIENT_RETRY_MAX_TOKENS,
        )
        if anti_echo.get("ok"):
            alt = sanitize_patient_speech((anti_echo.get("content") or "").strip())
            if alt and not _looks_like_clarify(alt):
                content = alt
                regenerated_empty = True
                result = {
                    **anti_echo,
                    "latency_ms": (result.get("latency_ms") or 0) + (anti_echo.get("latency_ms") or 0),
                }
            elif alt:
                content = alt
                result = {
                    **anti_echo,
                    "latency_ms": (result.get("latency_ms") or 0) + (anti_echo.get("latency_ms") or 0),
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
        retry = client.chat(retry_messages, temperature=0.5, max_tokens=_PATIENT_MAX_TOKENS)
        if retry.get("ok"):
            content2 = sanitize_patient_speech((retry.get("content") or "").strip())
            g2 = grounding_check(content2, case)
            if content2 and g2["passed"]:
                return {
                    "ok": True,
                    "content": content2,
                    "latency_ms": (result.get("latency_ms") or 0) + (retry.get("latency_ms") or 0),
                    "raw": retry,
                    "grounding": g2,
                    "regenerated": True,
                    "patient_affect": public_affect(emotion),
                    "emotion_state": emotion,
                }
        content = grounding["fallback"]
        grounding["action"] = "replace_with_fallback"

    return {
        "ok": True,
        "content": sanitize_patient_speech(content),
        "latency_ms": result.get("latency_ms"),
        "raw": result,
        "grounding": grounding,
        "regenerated": regenerated_empty,
        "patient_affect": public_affect(emotion),
        "emotion_state": emotion,
    }
