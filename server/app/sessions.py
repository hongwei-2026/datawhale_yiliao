"""训练会话：开练、对话、结束评分。"""

from __future__ import annotations

import json
from typing import Any

from .agnes import AgnesClient
from .case_loader import case_primary_scene, load_case, load_rubric
from .db import connect, new_id, utc_now
from .patient_agent import generate_patient_reply
from .scoring_engine import DISCLAIMER, recompute_scores_from_rows, run_scoring


def _conn(db_path: str):
    return connect(db_path)


def create_session(db_path: str, case_id: str | None = None) -> dict[str, Any]:
    case = load_case(case_id)
    meta = case["meta"]
    persona = case["persona"]
    scene_key = case_primary_scene(case)
    rubric = load_rubric(scene_key)
    script = case.get("session_script") or {}
    scene_label = script.get("scene_label") or rubric.get("meta", {}).get("sceneLabel") or scene_key
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
            scene_key,
            rubric["meta"]["version"],
            "in_progress",
            now,
            json.dumps({"scene_label": scene_label}, ensure_ascii=False),
        ),
    )
    opening = script.get("system_opening") or (
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
    greet = script.get("patient_greeting") or (
        "大夫，护士让我过来问问这个药试验的事。"
        "我年纪大了，你们说慢一点。"
        "我想先弄清楚三件事：能不能中途不参加、有没有大副作用、是不是一定有效。"
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
            "scene_key": scene_key,
            "scene_label": scene_label,
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

    try:
        gen = generate_patient_reply(
            client,
            case=case,
            history=hist_for_ai,
            trainee_text=content,
            scene_key=sess.get("scene_key"),
        )
    except Exception as exc:
        gen = {
            "ok": False,
            "content": "（系统）模拟受试者暂时没接上，请稍后再试。",
            "error": str(exc),
            "latency_ms": None,
            "grounding": {"passed": False, "action": "block", "hits": []},
        }
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
        (new_id(), session_id, patient_turn, "patient", (gen.get("content") or "").strip() or "嗯……您刚才说的什么？我没太听明白，您能再说一遍吗？", gen_id, ended),
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

    scene_key = sess.get("scene_key") or "informed_consent"
    scored = run_scoring(client, messages, scene_key=scene_key)
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
          id, session_id, overall_pass, summary, improvements_json, scores_json, disclaimer, created_at
        ) VALUES(?,?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            session_id,
            1 if report["overall_pass"] else 0,
            report["summary"],
            json.dumps(report.get("improvements") or [], ensure_ascii=False),
            json.dumps(report.get("scores") or scored.get("scores") or {}, ensure_ascii=False),
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
    fb = dict(fb)
    score_rows = conn.execute(
        "SELECT item_code, verdict, evidence_spans_json, comment, scored_at FROM score_result WHERE session_id=? ORDER BY item_code",
        (session_id,),
    ).fetchall()
    sess = conn.execute("SELECT * FROM training_session WHERE id=?", (session_id,)).fetchone()

    rubric = load_rubric(sess["scene_key"] if sess else "informed_consent")
    item_map = {i["id"]: i for i in rubric["items"]}
    from .case_loader import load_rubric_lay

    lay = load_rubric_lay()
    items = []
    for s in score_rows:
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

    scores_obj = {}
    if fb.get("scores_json"):
        try:
            scores_obj = json.loads(fb["scores_json"])
        except json.JSONDecodeError:
            scores_obj = {}

    if (not scores_obj or scores_obj.get("total_score") is None) and score_rows:
        scores_obj = recompute_scores_from_rows([dict(r) for r in score_rows], rubric)
        conn.execute(
            "UPDATE feedback_report SET scores_json=? WHERE session_id=?",
            (json.dumps(scores_obj, ensure_ascii=False), session_id),
        )
        conn.commit()

    conn.close()

    return {
        "session_id": session_id,
        "case_code": sess["case_code"] if sess else None,
        "scene_key": sess["scene_key"] if sess else None,
        "overall_pass": bool(fb["overall_pass"]),
        "checklist_pass": scores_obj.get("checklist_pass"),
        "summary": fb["summary"],
        "improvements": json.loads(fb["improvements_json"] or "[]"),
        "scores": scores_obj or None,
        "disclaimer": fb["disclaimer"],
        "created_at": fb["created_at"],
        "items": items,
        "advice_banner": "以下仅为系统练习建议，可能有误。真正提升靠真实场景与人对人实践及带教指导。",
    }


def backfill_missing_scores(db_path: str) -> int:
    """为缺 scores_json 的历史反馈补算练习参考分。"""
    conn = _conn(db_path)
    rows = conn.execute(
        """
        SELECT fr.session_id, fr.scores_json, ts.scene_key
        FROM feedback_report fr
        JOIN training_session ts ON ts.id = fr.session_id
        WHERE fr.scores_json IS NULL OR fr.scores_json = '' OR fr.scores_json = '{}'
        """
    ).fetchall()
    updated = 0
    for row in rows:
        score_rows = conn.execute(
            "SELECT item_code, verdict FROM score_result WHERE session_id=?",
            (row["session_id"],),
        ).fetchall()
        if not score_rows:
            continue
        rubric = load_rubric(row["scene_key"] or "informed_consent")
        scores_obj = recompute_scores_from_rows([dict(r) for r in score_rows], rubric)
        conn.execute(
            "UPDATE feedback_report SET scores_json=? WHERE session_id=?",
            (json.dumps(scores_obj, ensure_ascii=False), row["session_id"]),
        )
        updated += 1
    if updated:
        conn.commit()
    conn.close()
    return updated


def list_sessions(db_path: str, limit: int = 20) -> list[dict[str, Any]]:
    """最近练习会话（含是否有反馈、摘要预览）。"""
    conn = _conn(db_path)
    rows = conn.execute(
        """
        SELECT
          ts.id,
          ts.case_code,
          ts.persona_code,
          ts.status,
          ts.started_at,
          ts.ended_at,
          fr.overall_pass,
          fr.summary,
          fr.scores_json,
          fr.created_at AS feedback_at,
          (
            SELECT COUNT(*) FROM session_message sm WHERE sm.session_id = ts.id
          ) AS message_count
        FROM training_session ts
        LEFT JOIN feedback_report fr ON fr.session_id = ts.id
        ORDER BY COALESCE(fr.created_at, ts.ended_at, ts.started_at) DESC
        LIMIT ?
        """,
        (max(1, min(limit, 50)),),
    ).fetchall()
    conn.close()

    out: list[dict[str, Any]] = []
    for row in rows:
        d = dict(row)
        summary = d.pop("summary", None)
        scores_raw = d.pop("scores_json", None)
        d["has_feedback"] = summary is not None
        op = d.get("overall_pass")
        d["overall_pass"] = bool(op) if op is not None else None
        d["total_score"] = None
        d["grade_label"] = None
        if scores_raw:
            try:
                scores_obj = json.loads(scores_raw)
                d["total_score"] = scores_obj.get("total_score")
                d["grade_label"] = scores_obj.get("grade_label")
            except json.JSONDecodeError:
                pass
        if summary and len(summary) > 120:
            d["summary_preview"] = summary[:120] + "…"
        else:
            d["summary_preview"] = summary
        out.append(d)
    return out
