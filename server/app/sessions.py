"""训练会话：开练、对话、结束评分。"""

from __future__ import annotations

import json
from typing import Any

from .agnes import AgnesClient
from .case_loader import load_case, load_rubric
from .db import connect, new_id, utc_now
from .patient_agent import generate_patient_reply
from .scoring_engine import DISCLAIMER, run_scoring


def _conn(db_path: str):
    return connect(db_path)


def create_session(db_path: str, case_id: str | None = None) -> dict[str, Any]:
    case = load_case(case_id)
    meta = case["meta"]
    persona = case["persona"]
    rubric = load_rubric()
    sid = new_id()
    now = utc_now()
    conn = _conn(db_path)
    conn.execute(
        """
        INSERT INTO training_session(
          id, case_code, case_version, persona_code, scene_key, rubric_version,
          status, started_at, meta_json
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            sid,
            meta["case_id"],
            meta["version"],
            persona.get("persona_id"),
            "informed_consent",
            rubric["meta"]["version"],
            "in_progress",
            now,
            json.dumps({"scene_label": "S1 知情同意沟通"}, ensure_ascii=False),
        ),
    )
    # 开场白（系统提示给学员看）
    opening = (
        f"你正在与模拟受试者沟通（病例：{meta['short_title']}）。"
        "请以研究者身份进行知情同意相关说明。完成后点击「结束并获取建议反馈」。"
        "注意：模拟与评分均为建议，真正能力靠真实场景实践。"
    )
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (new_id(), sid, 0, "system", opening, now),
    )
    # 患者先打招呼
    greet = (
        "大夫，护士让我过来问问这个药试验的事。"
        "我年纪大了，你们说慢一点。我能不能中途不参加啊？"
    )
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (new_id(), sid, 1, "patient", greet, now),
    )
    conn.commit()
    conn.close()
    return {
        "ok": True,
        "session_id": sid,
        "case": {
            "case_id": meta["case_id"],
            "short_title": meta["short_title"],
            "data_status": meta["data_status"],
            "version": meta["version"],
            "disclaimer": meta.get("disclaimer"),
        },
        "persona": {
            "persona_id": persona.get("persona_id"),
            "display_name": persona.get("display_name"),
            "lay_bio": persona.get("lay_bio"),
        },
        "messages": get_messages(db_path, sid),
    }


def get_session(db_path: str, session_id: str) -> dict | None:
    conn = _conn(db_path)
    row = conn.execute("SELECT * FROM training_session WHERE id=?", (session_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_messages(db_path: str, session_id: str) -> list[dict]:
    conn = _conn(db_path)
    rows = conn.execute(
        """
        SELECT turn_index, role, content, created_at, ai_generation_id
        FROM session_message WHERE session_id=? ORDER BY turn_index
        """,
        (session_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def post_turn(db_path: str, settings, session_id: str, content: str) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "内容不能为空"}

    sess = get_session(db_path, session_id)
    if not sess:
        return {"ok": False, "error": "会话不存在"}
    if sess["status"] != "in_progress":
        return {"ok": False, "error": "会话已结束"}

    case = load_case(sess["case_code"])
    history = get_messages(db_path, session_id)
    next_turn = max((m["turn_index"] for m in history), default=-1) + 1
    now = utc_now()
    conn = _conn(db_path)

    trainee_msg_id = new_id()
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (trainee_msg_id, session_id, next_turn, "trainee", content, now),
    )
    conn.commit()

    client = AgnesClient(settings)
    hist_for_ai = [m for m in history if m["role"] in ("trainee", "patient")]
    run_id = new_id()
    conn.execute(
        "INSERT INTO ai_agent_run(id, session_id, run_type, status, started_at) VALUES(?,?,?,?,?)",
        (run_id, session_id, "patient_reply", "running", now),
    )
    conn.commit()

    gen = generate_patient_reply(client, case=case, history=hist_for_ai, trainee_text=content)
    ended = utc_now()
    gen_id = new_id()
    conn.execute(
        """
        UPDATE ai_agent_run SET status=?, ended_at=?, error_message=? WHERE id=?
        """,
        (
            "succeeded" if gen.get("ok") else "failed",
            ended,
            None if gen.get("ok") else json.dumps(gen.get("error"), ensure_ascii=False),
            run_id,
        ),
    )
    conn.execute(
        """
        INSERT INTO ai_generation_log(
          id, run_id, session_id, profile_code, prompt_version, step_name,
          request_payload_json, response_text, response_raw_json, token_usage_json,
          latency_ms, error_message, created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            gen_id,
            run_id,
            session_id,
            "agnes-patient-default",
            "patient-0.1",
            "patient_turn",
            json.dumps({"trainee": content, "grounding": gen.get("grounding")}, ensure_ascii=False),
            gen.get("content") or "",
            json.dumps({"regenerated": gen.get("regenerated")}, ensure_ascii=False),
            None,
            gen.get("latency_ms"),
            None if gen.get("ok") else str(gen.get("error")),
            ended,
        ),
    )
    patient_turn = next_turn + 1
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, ai_generation_id, created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (new_id(), session_id, patient_turn, "patient", gen.get("content") or "", gen_id, ended),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "trainee_turn": next_turn,
        "patient_reply": gen.get("content"),
        "grounding": gen.get("grounding"),
        "latency_ms": gen.get("latency_ms"),
        "messages": get_messages(db_path, session_id),
    }


def complete_session(db_path: str, settings, session_id: str) -> dict[str, Any]:
    sess = get_session(db_path, session_id)
    if not sess:
        return {"ok": False, "error": "会话不存在"}

    messages = get_messages(db_path, session_id)
    trainee_msgs = [m for m in messages if m["role"] == "trainee"]
    if len(trainee_msgs) < 1:
        return {"ok": False, "error": "请至少说一轮话再结束"}

    client = AgnesClient(settings)
    now = utc_now()
    run_id = new_id()
    conn = _conn(db_path)
    conn.execute(
        "INSERT INTO ai_agent_run(id, session_id, run_type, status, started_at) VALUES(?,?,?,?,?)",
        (run_id, session_id, "score_session", "running", now),
    )
    conn.commit()

    scored = run_scoring(client, messages)
    ended = utc_now()
    results = scored["results"]
    report = scored["report"]

    # 清旧结果（重评）
    conn.execute("DELETE FROM score_result WHERE session_id=?", (session_id,))
    conn.execute("DELETE FROM feedback_report WHERE session_id=?", (session_id,))

    for r in results:
        conn.execute(
            """
            INSERT INTO score_result(
              id, session_id, item_code, verdict, evidence_spans_json, comment, scored_at
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                new_id(),
                session_id,
                r["item_code"],
                r["verdict"],
                json.dumps(r.get("evidence_spans") or [], ensure_ascii=False),
                r.get("comment"),
                ended,
            ),
        )

    conn.execute(
        """
        INSERT INTO feedback_report(
          id, session_id, overall_pass, summary, improvements_json, disclaimer, created_at
        ) VALUES(?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            session_id,
            1 if report["overall_pass"] else 0,
            report["summary"],
            json.dumps(report.get("improvements") or [], ensure_ascii=False),
            report.get("disclaimer") or DISCLAIMER,
            ended,
        ),
    )
    conn.execute(
        "UPDATE training_session SET status=?, ended_at=? WHERE id=?",
        ("completed", ended, session_id),
    )
    conn.execute(
        "UPDATE ai_agent_run SET status=?, ended_at=? WHERE id=?",
        ("succeeded", ended, run_id),
    )
    # 记一条评分日志摘要
    conn.execute(
        """
        INSERT INTO ai_generation_log(
          id, run_id, session_id, profile_code, prompt_version, step_name,
          request_payload_json, response_text, response_raw_json, token_usage_json,
          latency_ms, error_message, created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            run_id,
            session_id,
            "agnes-patient-default",
            "scorer-0.1",
            "score_and_feedback",
            json.dumps({"message_count": len(messages)}, ensure_ascii=False),
            report["summary"],
            json.dumps({"aggregate": scored["aggregate"]}, ensure_ascii=False),
            None,
            None,
            None,
            ended,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "session_id": session_id,
        "feedback": get_feedback(db_path, session_id),
    }


def get_feedback(db_path: str, session_id: str) -> dict[str, Any] | None:
    conn = _conn(db_path)
    fb = conn.execute("SELECT * FROM feedback_report WHERE session_id=?", (session_id,)).fetchone()
    if not fb:
        conn.close()
        return None
    scores = conn.execute(
        "SELECT item_code, verdict, evidence_spans_json, comment, scored_at FROM score_result WHERE session_id=? ORDER BY item_code",
        (session_id,),
    ).fetchall()
    sess = conn.execute("SELECT * FROM training_session WHERE id=?", (session_id,)).fetchone()
    conn.close()

    rubric = load_rubric()
    item_map = {i["id"]: i for i in rubric["items"]}
    from .case_loader import load_rubric_lay

    lay = load_rubric_lay()
    items = []
    for s in scores:
        meta = item_map.get(s["item_code"]) or {}
        lay_i = lay.get(s["item_code"]) or {}
        items.append(
            {
                "item_code": s["item_code"],
                "verdict": s["verdict"],
                "comment": s["comment"],
                "evidence_spans": json.loads(s["evidence_spans_json"] or "[]"),
                "title": meta.get("title"),
                "lay_title": lay_i.get("layTitle"),
                "lay_explain": lay_i.get("layExplain"),
                "layer": meta.get("layer"),
                "type": meta.get("type"),
                "hard_fail": bool(meta.get("hardFail")),
                "sources": meta.get("sources") or [],
            }
        )

    return {
        "session_id": session_id,
        "case_code": sess["case_code"] if sess else None,
        "overall_pass": bool(fb["overall_pass"]),
        "summary": fb["summary"],
        "improvements": json.loads(fb["improvements_json"] or "[]"),
        "disclaimer": fb["disclaimer"],
        "created_at": fb["created_at"],
        "items": items,
        "advice_banner": "以下仅为系统练习建议，可能有误。真正提升靠真实场景与人对人实践及带教指导。",
    }
