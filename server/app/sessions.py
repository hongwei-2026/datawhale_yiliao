"""训练会话：开练、对话、结束评分。"""

from __future__ import annotations

import json
from typing import Any

from .agnes import AgnesClient
from .case_loader import (
    case_disease_code,
    case_primary_scene,
    load_case,
    load_rubric,
    load_rubric_for_case,
)
from .db import connect, new_id, utc_now
from .patient_agent import (
    generate_patient_opening,
    generate_patient_reply,
    pick_clarify_reply,
    pick_degraded_patient_reply,
)
from .patient_engine import affect_log_entry, default_emotion, public_affect
from .scoring_engine import (
    DISCLAIMER,
    build_insufficient_sample_feedback,
    checkpoint_progress,
    dialogue_sample_stats,
    recompute_scores_from_rows,
    run_scoring,
)


def _conn(db_path: str):
    return connect(db_path)


def create_session(
    db_path: str,
    case_id: str | None = None,
    trainee_user_id: str | None = None,
    *,
    session_mode: str = "practice",
    study_mode: str = "reference",
    settings=None,
) -> dict[str, Any]:
    case = load_case(case_id)
    meta = case["meta"]
    persona = case["persona"]
    scene_key = case_primary_scene(case)
    disease_code = case_disease_code(case)
    rubric = load_rubric_for_case(case, scene_key)
    script = case.get("session_script") or {}
    scene_label = script.get("scene_label") or rubric.get("meta", {}).get("sceneLabel") or scene_key
    trainee_brief = (rubric.get("meta") or {}).get("traineeBrief") or ""
    session_mode = session_mode if session_mode in ("practice", "assessment") else "practice"
    study_mode = study_mode if study_mode in ("reference", "strict") else "reference"
    if session_mode == "assessment":
        study_mode = "strict"
    initial_emotion = default_emotion(case)
    sid = new_id()
    now = utc_now()
    conn = _conn(db_path)
    conn.execute(
        """
        INSERT INTO training_session(
          id, case_code, case_version, persona_code, scene_key, rubric_version,
          status, started_at, meta_json, trainee_user_id
        ) VALUES(?,?,?,?,?,?,?,?,?,?)
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
            json.dumps(
                {
                    "scene_label": scene_label,
                    "session_mode": session_mode,
                    "study_mode": study_mode,
                    "emotion": initial_emotion,
                    "disease_code": disease_code,
                    "scoring_emphasis": trainee_brief,
                    "rubric_effective": (rubric.get("meta") or {}).get("effective") or {},
                },
                ensure_ascii=False,
            ),
            trainee_user_id,
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
    client = AgnesClient(settings) if settings else None
    greet_result = generate_patient_opening(
        client,
        case=case,
        scene_key=scene_key,
        session_nonce=sid[:8],
        emotion_state=initial_emotion,
    )
    greet = (greet_result.get("content") or "").strip() or "大夫，我来了。"
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (new_id(), sid, 1, "patient", greet, now),
    )
    # 开场患者句写入情绪日志，便于前端按条展示
    opening_affect = public_affect(initial_emotion)
    conn.execute(
        "UPDATE training_session SET meta_json=? WHERE id=?",
        (
            json.dumps(
                {
                    "scene_label": scene_label,
                    "session_mode": session_mode,
                    "study_mode": study_mode,
                    "emotion": initial_emotion,
                    "emotion_log": [affect_log_entry(1, opening_affect)],
                    "disease_code": disease_code,
                    "scoring_emphasis": trainee_brief,
                    "rubric_effective": (rubric.get("meta") or {}).get("effective") or {},
                },
                ensure_ascii=False,
            ),
            sid,
        ),
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
            "disease_code": disease_code,
            "scoring_emphasis": trainee_brief,
        },
        "persona": {
            "persona_id": persona.get("persona_id"),
            "display_name": persona.get("display_name"),
            "lay_bio": persona.get("lay_bio"),
        },
        "session_mode": session_mode,
        "study_mode": study_mode,
        "messages": get_messages(db_path, sid),
        "patient_affect": opening_affect,
        "emotion_log": [affect_log_entry(1, opening_affect)],
        "scoring_emphasis": trainee_brief,
    }


def get_session(db_path: str, session_id: str) -> dict | None:
    conn = _conn(db_path)
    row = conn.execute("SELECT * FROM training_session WHERE id=?", (session_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def session_patient_affect(sess: dict | None) -> dict[str, Any] | None:
    if not sess or not sess.get("meta_json"):
        return None
    try:
        obj = json.loads(sess["meta_json"])
        em = obj.get("emotion")
        if isinstance(em, dict):
            return public_affect(em)
    except json.JSONDecodeError:
        pass
    return None


def parse_session_meta(sess: dict | None) -> dict[str, str]:
    if not sess:
        return {"session_mode": "practice", "study_mode": "reference"}
    raw = sess.get("meta_json")
    if not raw:
        return {"session_mode": "practice", "study_mode": "reference"}
    try:
        obj = json.loads(raw)
        return {
            "session_mode": obj.get("session_mode") or "practice",
            "study_mode": obj.get("study_mode") or "reference",
        }
    except json.JSONDecodeError:
        return {"session_mode": "practice", "study_mode": "reference"}


def session_access_error(
    sess: dict | None,
    trainee_user_id: str | None,
    *,
    actor_role: str | None = None,
) -> str | None:
    if not sess:
        return "会话不存在"
    # 管理员可查看/继续任意会话（管理端排查、演示）
    if (actor_role or "").lower() == "admin":
        return None
    owner = sess.get("trainee_user_id")
    if trainee_user_id and owner and owner != trainee_user_id:
        return "无权访问此会话"
    return None


def get_messages(db_path: str, session_id: str) -> list[dict]:
    conn = _conn(db_path)
    rows = conn.execute(
        """
        SELECT turn_index, role, content, created_at, ai_generation_id
        FROM session_message WHERE session_id=? ORDER BY turn_index
        """,
        (session_id,),
    ).fetchall()
    sess_row = conn.execute(
        "SELECT meta_json FROM training_session WHERE id=?",
        (session_id,),
    ).fetchone()
    conn.close()
    emotion_log: list[dict] = []
    if sess_row and sess_row["meta_json"]:
        try:
            meta = json.loads(sess_row["meta_json"])
            emotion_log = list(meta.get("emotion_log") or [])
        except json.JSONDecodeError:
            emotion_log = []
    by_turn = {
        int(e["turn_index"]): e
        for e in emotion_log
        if isinstance(e, dict) and e.get("turn_index") is not None
    }
    out = []
    for r in rows:
        m = dict(r)
        if m.get("role") == "patient" and int(m.get("turn_index") or -1) in by_turn:
            m["affect"] = by_turn[int(m["turn_index"])]
        out.append(m)
    return out


def session_emotion_log(sess: dict | None) -> list[dict]:
    if not sess or not sess.get("meta_json"):
        return []
    try:
        obj = json.loads(sess["meta_json"])
        return list(obj.get("emotion_log") or [])
    except json.JSONDecodeError:
        return []


def post_turn(
    db_path: str,
    settings,
    session_id: str,
    content: str,
    trainee_user_id: str | None = None,
    *,
    actor_role: str | None = None,
) -> dict[str, Any]:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "内容不能为空"}

    sess = get_session(db_path, session_id)
    err = session_access_error(sess, trainee_user_id, actor_role=actor_role)
    if err:
        return {"ok": False, "error": err, "http_status": 403 if err == "无权访问此会话" else 400}
    if sess["status"] != "in_progress":
        return {"ok": False, "error": "会话已结束", "http_status": 400}

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
        meta_obj: dict[str, Any] = {}
        if sess.get("meta_json"):
            try:
                meta_obj = json.loads(sess["meta_json"])
            except json.JSONDecodeError:
                meta_obj = {}
        prior_emotion = meta_obj.get("emotion")

        gen = generate_patient_reply(
            client,
            case=case,
            history=hist_for_ai,
            trainee_text=content,
            scene_key=sess.get("scene_key"),
            emotion_state=prior_emotion,
        )
    except Exception as exc:
        # 演示不断档：异常时也回一句口语，不写「（系统）连不上」
        soft = pick_degraded_patient_reply(
            trainee_text=content,
            history=hist_for_ai,
            case=case,
            scene_key=sess.get("scene_key"),
        )
        gen = {
            "ok": True,
            "content": soft,
            "degraded": True,
            "error": str(exc),
            "latency_ms": None,
            "grounding": {"passed": True, "action": "degraded_fallback", "hits": []},
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
        (new_id(), session_id, patient_turn, "patient", (gen.get("content") or "").strip() or pick_clarify_reply(hist_for_ai), gen_id, ended),
    )
    all_messages = conn.execute(
        "SELECT turn_index, role, content FROM session_message WHERE session_id=? ORDER BY turn_index",
        (session_id,),
    ).fetchall()
    msg_list = [dict(m) for m in all_messages]
    scene_key = sess.get("scene_key") or "informed_consent"
    disease_code = None
    try:
        disease_code = (json.loads(sess.get("meta_json") or "{}") or {}).get("disease_code")
    except json.JSONDecodeError:
        disease_code = None
    if not disease_code:
        try:
            disease_code = case_disease_code(load_case(sess.get("case_code")))
        except Exception:
            disease_code = None
    progress = checkpoint_progress(msg_list, scene_key, disease_code=disease_code)
    meta_obj: dict[str, Any] = {}
    if sess.get("meta_json"):
        try:
            meta_obj = json.loads(sess["meta_json"])
        except json.JSONDecodeError:
            meta_obj = {}
    meta_obj.update(progress)
    if gen.get("emotion_state"):
        meta_obj["emotion"] = gen["emotion_state"]
    affect = gen.get("patient_affect") or public_affect(gen.get("emotion_state") or {})
    log = list(meta_obj.get("emotion_log") or [])
    log.append(affect_log_entry(patient_turn, affect))
    meta_obj["emotion_log"] = log
    conn.execute(
        "UPDATE training_session SET meta_json=? WHERE id=?",
        (json.dumps(meta_obj, ensure_ascii=False), session_id),
    )
    conn.commit()
    conn.close()

    return {
        "ok": True,
        "trainee_turn": next_turn,
        "patient_reply": gen.get("content"),
        "patient_ok": True if gen.get("content") else bool(gen.get("ok")),
        "patient_degraded": bool(gen.get("degraded")),
        "patient_error": None,
        "grounding": gen.get("grounding"),
        "latency_ms": gen.get("latency_ms"),
        "messages": get_messages(db_path, session_id),
        "patient_affect": affect,
        "emotion_log": log,
    }


def complete_session(
    db_path: str,
    settings,
    session_id: str,
    trainee_user_id: str | None = None,
    *,
    actor_role: str | None = None,
) -> dict[str, Any]:
    sess = get_session(db_path, session_id)
    err = session_access_error(sess, trainee_user_id, actor_role=actor_role)
    if err:
        return {"ok": False, "error": err, "http_status": 403 if err == "无权访问此会话" else 400}

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
    disease_code = None
    try:
        disease_code = (json.loads(sess.get("meta_json") or "{}") or {}).get("disease_code")
    except json.JSONDecodeError:
        disease_code = None
    if not disease_code:
        try:
            disease_code = case_disease_code(load_case(sess.get("case_code")))
        except Exception:
            disease_code = None
    sample_stats = dialogue_sample_stats(messages)
    if not sample_stats["sufficient"]:
        report = build_insufficient_sample_feedback(sample_stats, scene_key)
        ended = utc_now()
        conn = _conn(db_path)
        conn.execute("DELETE FROM score_result WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM feedback_report WHERE session_id=?", (session_id,))
        conn.execute(
            """
            INSERT INTO feedback_report(
              id, session_id, overall_pass, summary, improvements_json, scores_json, disclaimer, created_at
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                new_id(),
                session_id,
                0,
                report["summary"],
                json.dumps(report.get("improvements") or [], ensure_ascii=False),
                json.dumps(report.get("scores") or {}, ensure_ascii=False),
                report.get("disclaimer") or "",
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
        conn.commit()
        conn.close()
        return {
            "ok": True,
            "session_id": session_id,
            "feedback": get_feedback(db_path, session_id),
            "insufficient_sample": True,
        }

    scored = run_scoring(client, messages, scene_key=scene_key, disease_code=disease_code)
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
    sess_d = dict(sess) if sess else {}
    disease_code = None
    try:
        disease_code = (json.loads(sess_d.get("meta_json") or "{}") or {}).get("disease_code")
    except json.JSONDecodeError:
        disease_code = None
    if sess_d.get("case_code"):
        try:
            case = load_case(sess_d["case_code"])
            rubric = load_rubric_for_case(case, sess_d.get("scene_key"))
            if not disease_code:
                disease_code = case_disease_code(case)
        except Exception:
            from .case_loader import load_effective_rubric

            rubric = load_effective_rubric(sess_d.get("scene_key") or "informed_consent", disease_code)
    else:
        from .case_loader import load_effective_rubric

        rubric = load_effective_rubric("informed_consent", None)
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


def list_sessions(
    db_path: str,
    limit: int = 20,
    trainee_user_id: str | None = None,
    *,
    actor_role: str | None = None,
) -> list[dict[str, Any]]:
    """最近练习会话（含是否有反馈、摘要预览）。默认只看当前账号，避免管理员被学员旧记录刷屏。"""
    conn = _conn(db_path)
    params: list[Any] = []
    user_filter = ""
    # actor_role 保留兼容；对话记录一律按当前登录用户过滤
    _ = actor_role
    if trainee_user_id:
        user_filter = "WHERE ts.trainee_user_id = ?"
        params.append(trainee_user_id)
    params.append(max(1, min(limit, 100)))
    rows = conn.execute(
        f"""
        SELECT
          ts.id,
          ts.case_code,
          ts.persona_code,
          ts.scene_key,
          ts.status,
          ts.started_at,
          ts.ended_at,
          ts.meta_json,
          fr.overall_pass,
          fr.summary,
          fr.scores_json,
          fr.created_at AS feedback_at,
          (
            SELECT COUNT(*) FROM session_message sm WHERE sm.session_id = ts.id
          ) AS message_count,
          (
            SELECT COUNT(*) FROM session_message sm WHERE sm.session_id = ts.id AND sm.role = 'trainee'
          ) AS trainee_turns,
          (
            SELECT sm.content FROM session_message sm
            WHERE sm.session_id = ts.id AND sm.role = 'patient'
            ORDER BY sm.turn_index DESC LIMIT 1
          ) AS last_patient_content,
          (
            SELECT sm.content FROM session_message sm
            WHERE sm.session_id = ts.id AND sm.role = 'trainee'
            ORDER BY sm.turn_index DESC LIMIT 1
          ) AS last_trainee_content
        FROM training_session ts
        LEFT JOIN feedback_report fr ON fr.session_id = ts.id
        {user_filter}
        ORDER BY COALESCE(fr.created_at, ts.ended_at, ts.started_at) DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()
    conn.close()

    out: list[dict[str, Any]] = []
    for row in rows:
        d = dict(row)
        meta_raw = d.pop("meta_json", None)
        last_patient_content = (d.pop("last_patient_content", None) or "").strip()
        last_trainee_content = (d.pop("last_trainee_content", None) or "").strip()
        session_mode = "practice"
        study_mode = "reference"
        meta_obj: dict[str, Any] = {}
        if meta_raw:
            try:
                meta_obj = json.loads(meta_raw)
                session_mode = meta_obj.get("session_mode") or session_mode
                study_mode = meta_obj.get("study_mode") or study_mode
            except json.JSONDecodeError:
                meta_obj = {}
        d["session_mode"] = session_mode
        d["study_mode"] = study_mode
        d["progress_done"] = meta_obj.get("progress_done")
        d["progress_total"] = meta_obj.get("progress_total")
        d["progress_pct"] = meta_obj.get("progress_pct")
        d["last_patient_quote"] = meta_obj.get("last_patient_quote") or last_patient_content[:160]
        d["last_trainee_quote"] = meta_obj.get("last_trainee_quote") or last_trainee_content[:160]
        # 旧会话 meta 里可能没有摘要：用最新两轮话补全
        summary_bits: list[str] = []
        trainee_turns = d.get("trainee_turns") or 0
        if trainee_turns:
            summary_bits.append(f"你说了 {trainee_turns} 轮")
        if d.get("progress_total"):
            done = d.get("progress_done") or 0
            total = d["progress_total"]
            pct = d.get("progress_pct")
            if pct is None and total:
                pct = round(100 * done / total)
            summary_bits.append(f"检查点约 {done}/{total}" + (f"（{pct}%）" if pct is not None else ""))
        if d["last_trainee_quote"]:
            tq = d["last_trainee_quote"]
            summary_bits.append(f"你最近：「{tq[:72]}{'…' if len(tq) > 72 else ''}」")
        if d["last_patient_quote"]:
            pq = d["last_patient_quote"]
            summary_bits.append(f"受试者最近：「{pq[:80]}{'…' if len(pq) > 80 else ''}」")
        d["dialogue_summary"] = meta_obj.get("dialogue_summary") or (" · ".join(summary_bits) if summary_bits else None)
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
                d["insufficient_sample"] = bool(scores_obj.get("insufficient_sample"))
            except json.JSONDecodeError:
                pass
        if d["status"] == "in_progress":
            d["summary_preview"] = d.get("dialogue_summary") or summary
        elif summary and len(summary) > 160:
            d["summary_preview"] = summary[:160] + "…"
        else:
            d["summary_preview"] = summary
        out.append(d)
    return out
