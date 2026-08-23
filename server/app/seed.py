"""从 web/data JSON 灌入 SQLite，证明「标准 + 病例」已入库。"""

from __future__ import annotations

import json
from pathlib import Path

from .db import connect, init_schema, new_id, set_meta, utc_now

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "data"


def _load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def seed(db_path: str, *, force: bool = False) -> dict:
    conn = connect(db_path)
    init_schema(conn)

    existing = conn.execute("SELECT COUNT(*) AS c FROM case_package").fetchone()["c"]
    if existing and not force:
        from .db import table_counts

        counts = table_counts(conn)
        conn.close()
        return {"ok": True, "skipped": True, "reason": "already_seeded", "counts": counts}

    # 清空业务主数据（force 时重建；不主动清 verify_probe，便于留痕）
    for table in [
        "feedback_report",
        "score_result",
        "session_message",
        "ai_generation_log",
        "ai_agent_run",
        "training_session",
        "case_risk_point",
        "case_symptom",
        "case_package",
        "patient_persona",
        "trial_protocol",
        "disease",
        "rubric_item",
        "rubric_set",
        "terminology",
        "standard_clause",
        "standard_doc",
        "standard_category",
        "scene",
        "ai_prompt_version",
        "ai_prompt_template",
        "ai_model_profile",
    ]:
        try:
            conn.execute(f"DELETE FROM {table}")
        except Exception:
            pass
    conn.commit()

    scenes = _load("scenes.json")["scenes"]
    for s in scenes:
        conn.execute(
            "INSERT INTO scene(id, scene_code, scene_key, name, status, description) VALUES(?,?,?,?,?,?)",
            (new_id(), s["code"], s["id"], s["name"], s["status"], s["description"]),
        )

    registry = _load("standards-registry.json")
    for c in registry["categories"]:
        conn.execute(
            "INSERT INTO standard_category(id, category_code, name, color) VALUES(?,?,?,?)",
            (new_id(), c["id"], c["name"], c.get("color")),
        )
    for d in registry["standards"]:
        conn.execute(
            """
            INSERT INTO standard_doc(
              id, doc_code, title, short_title, doc_number, issuer, category_code,
              priority, status, status_label, project_role, effective_from, effective_until
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                new_id(),
                d["id"],
                d["title"],
                d["shortTitle"],
                d.get("docNumber"),
                d.get("issuer"),
                d.get("category"),
                d.get("priority"),
                d.get("status"),
                d.get("statusLabel"),
                d.get("projectRole"),
                d.get("effectiveFrom"),
                d.get("effectiveUntil"),
            ),
        )
        for cl in d.get("keyClauses") or []:
            conn.execute(
                "INSERT INTO standard_clause(id, doc_code, clause_ref, summary) VALUES(?,?,?,?)",
                (new_id(), d["id"], cl["clause"], cl["summary"]),
            )

    for t in _load("terminology.json")["terms"]:
        conn.execute(
            "INSERT INTO terminology(id, term, definition, field_name) VALUES(?,?,?,?)",
            (new_id(), t["term"], t["definition"], t["field"]),
        )

    rubric = _load("scoring-rubric.json")
    set_id = new_id()
    conn.execute(
        """
        INSERT INTO rubric_set(id, set_code, version, scene_key, pass_rule, status)
        VALUES(?,?,?,?,?,?)
        """,
        (
            set_id,
            "RUBRIC-S1-MVP",
            rubric["meta"]["version"],
            rubric["meta"]["scene"],
            rubric["meta"]["passRule"],
            "active",
        ),
    )
    for item in rubric["items"]:
        conn.execute(
            """
            INSERT INTO rubric_item(
              id, set_id, item_code, layer, item_type, title, pass_criteria, fail_criteria,
              hard_fail, enabled_mvp
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                new_id(),
                set_id,
                item["id"],
                item["layer"],
                item["type"],
                item["title"],
                item.get("pass"),
                item.get("fail"),
                1 if item.get("hardFail") else 0,
                1 if item.get("enabledMvp") else 0,
            ),
        )

    case = _load("cases/CASE-T2DM-PH2-001.json")
    disease = case["disease"]
    protocol = case["protocol"]
    meta = case["meta"]
    persona = case["persona"]

    conn.execute(
        """
        INSERT INTO disease(id, disease_code, name_zh, name_en, icd10_code, description)
        VALUES(?,?,?,?,?,?)
        """,
        (
            new_id(),
            disease["disease_code"],
            disease["name_zh"],
            disease.get("name_en"),
            disease.get("icd10_code"),
            disease.get("description"),
        ),
    )
    conn.execute(
        """
        INSERT INTO trial_protocol(
          id, protocol_code, disease_code, title, phase, intervention_summary, is_placeholder
        ) VALUES(?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            protocol["protocol_code"],
            disease["disease_code"],
            protocol["title"],
            protocol["phase"],
            protocol["intervention_summary"],
            1 if protocol.get("is_placeholder") else 0,
        ),
    )
    conn.execute(
        """
        INSERT INTO case_package(
          id, case_code, protocol_code, disease_code, title, short_title, data_status, version,
          disclaimer, is_default, clinical_summary_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            meta["case_id"],
            protocol["protocol_code"],
            disease["disease_code"],
            meta["title"],
            meta["short_title"],
            meta["data_status"],
            meta["version"],
            meta["disclaimer"],
            1 if meta.get("is_default") else 0,
            json.dumps(case["clinical_summary"], ensure_ascii=False),
        ),
    )
    for sx in case["symptoms"]:
        conn.execute(
            """
            INSERT INTO case_symptom(
              id, case_code, symptom_code, name, clinical_name, is_core, is_present,
              severity_band, patient_may_say_json
            ) VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                new_id(),
                meta["case_id"],
                sx["symptom_id"],
                sx["name"],
                sx.get("clinical_name"),
                1 if sx.get("is_core") else 0,
                1 if sx.get("present") else 0,
                sx.get("severity_band"),
                json.dumps(sx.get("patient_may_say") or [], ensure_ascii=False),
            ),
        )
    for rk in case["risks"]:
        conn.execute(
            """
            INSERT INTO case_risk_point(
              id, case_code, risk_code, title, lay_summary, must_disclose
            ) VALUES(?,?,?,?,?,?)
            """,
            (
                new_id(),
                meta["case_id"],
                rk["risk_id"],
                rk["title"],
                rk["lay_summary"],
                1 if rk.get("must_disclose") else 0,
            ),
        )
    conn.execute(
        """
        INSERT INTO patient_persona(
          id, persona_code, display_name, age_band, sex, cognition_level,
          emotion_baseline, comprehension_style, lay_bio
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            new_id(),
            persona["persona_id"],
            persona["display_name"],
            persona["age_band"],
            persona["sex"],
            persona.get("cognition_level"),
            persona.get("emotion_baseline"),
            persona.get("comprehension_style"),
            persona.get("lay_bio"),
        ),
    )

    conn.execute(
        """
        INSERT INTO ai_model_profile(id, profile_code, provider, model_name, params_json, secret_ref, is_active)
        VALUES(?,?,?,?,?,?,1)
        """,
        (
            new_id(),
            "agnes-patient-default",
            "agnes",
            "agnes-2.0-flash",
            json.dumps({"temperature": 0.7, "max_tokens": 512}, ensure_ascii=False),
            "AGNES_API_KEY",
        ),
    )
    conn.execute(
        "INSERT INTO ai_prompt_template(id, template_code, purpose, name) VALUES(?,?,?,?)",
        (new_id(), "patient-system", "patient_system", "AI 患者系统约束"),
    )
    conn.execute(
        """
        INSERT INTO ai_prompt_version(id, template_code, version, template_body, status)
        VALUES(?,?,?,?,?)
        """,
        (
            new_id(),
            "patient-system",
            "0.1.0",
            "你是临床试验受试者模拟器。只能根据给定病例事实回答，不得编造库外症状。",
            "active",
        ),
    )

    set_meta(
        conn,
        "seed_info",
        {
            "seeded_at": utc_now(),
            "source": "web/data",
            "default_case": meta["case_id"],
            "standards": len(registry["standards"]),
            "rubric_items": len(rubric["items"]),
        },
    )
    conn.commit()

    from .db import table_counts

    counts = table_counts(conn)
    conn.close()
    return {"ok": True, "counts": counts, "case_id": meta["case_id"]}
