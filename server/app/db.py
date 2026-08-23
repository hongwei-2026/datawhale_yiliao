"""SQLite 建库（对齐数据库设计文档核心表，便于本地验证）。"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scene (
  id TEXT PRIMARY KEY,
  scene_code TEXT NOT NULL UNIQUE,
  scene_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS standard_category (
  id TEXT PRIMARY KEY,
  category_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS standard_doc (
  id TEXT PRIMARY KEY,
  doc_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  doc_number TEXT,
  issuer TEXT,
  category_code TEXT,
  priority TEXT,
  status TEXT,
  status_label TEXT,
  project_role TEXT,
  effective_from TEXT,
  effective_until TEXT
);

CREATE TABLE IF NOT EXISTS standard_clause (
  id TEXT PRIMARY KEY,
  doc_code TEXT NOT NULL,
  clause_ref TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terminology (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  field_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS rubric_set (
  id TEXT PRIMARY KEY,
  set_code TEXT NOT NULL,
  version TEXT NOT NULL,
  scene_key TEXT NOT NULL,
  pass_rule TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(set_code, version)
);

CREATE TABLE IF NOT EXISTS rubric_item (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  layer TEXT NOT NULL,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  pass_criteria TEXT,
  fail_criteria TEXT,
  hard_fail INTEGER NOT NULL DEFAULT 0,
  enabled_mvp INTEGER NOT NULL DEFAULT 0,
  UNIQUE(set_id, item_code)
);

CREATE TABLE IF NOT EXISTS disease (
  id TEXT PRIMARY KEY,
  disease_code TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  icd10_code TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS trial_protocol (
  id TEXT PRIMARY KEY,
  protocol_code TEXT NOT NULL UNIQUE,
  disease_code TEXT NOT NULL,
  title TEXT NOT NULL,
  phase TEXT NOT NULL,
  intervention_summary TEXT NOT NULL,
  is_placeholder INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS case_package (
  id TEXT PRIMARY KEY,
  case_code TEXT NOT NULL UNIQUE,
  protocol_code TEXT NOT NULL,
  disease_code TEXT NOT NULL,
  title TEXT NOT NULL,
  short_title TEXT NOT NULL,
  data_status TEXT NOT NULL,
  version TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  clinical_summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_symptom (
  id TEXT PRIMARY KEY,
  case_code TEXT NOT NULL,
  symptom_code TEXT NOT NULL,
  name TEXT NOT NULL,
  clinical_name TEXT,
  is_core INTEGER NOT NULL DEFAULT 0,
  is_present INTEGER NOT NULL DEFAULT 1,
  severity_band TEXT,
  patient_may_say_json TEXT,
  UNIQUE(case_code, symptom_code)
);

CREATE TABLE IF NOT EXISTS case_risk_point (
  id TEXT PRIMARY KEY,
  case_code TEXT NOT NULL,
  risk_code TEXT NOT NULL,
  title TEXT NOT NULL,
  lay_summary TEXT NOT NULL,
  must_disclose INTEGER NOT NULL DEFAULT 1,
  UNIQUE(case_code, risk_code)
);

CREATE TABLE IF NOT EXISTS patient_persona (
  id TEXT PRIMARY KEY,
  persona_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  age_band TEXT NOT NULL,
  sex TEXT NOT NULL,
  cognition_level TEXT,
  emotion_baseline TEXT,
  comprehension_style TEXT,
  lay_bio TEXT
);

CREATE TABLE IF NOT EXISTS ai_model_profile (
  id TEXT PRIMARY KEY,
  profile_code TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  params_json TEXT NOT NULL,
  secret_ref TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ai_prompt_template (
  id TEXT PRIMARY KEY,
  template_code TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_prompt_version (
  id TEXT PRIMARY KEY,
  template_code TEXT NOT NULL,
  version TEXT NOT NULL,
  template_body TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(template_code, version)
);

CREATE TABLE IF NOT EXISTS training_session (
  id TEXT PRIMARY KEY,
  case_code TEXT NOT NULL,
  case_version TEXT NOT NULL,
  persona_code TEXT,
  scene_key TEXT NOT NULL,
  rubric_version TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_agent_run (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS ai_generation_log (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  session_id TEXT,
  profile_code TEXT,
  prompt_version TEXT,
  step_name TEXT,
  request_payload_json TEXT,
  response_text TEXT,
  response_raw_json TEXT,
  token_usage_json TEXT,
  latency_ms INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ai_generation_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, turn_index)
);

CREATE TABLE IF NOT EXISTS score_result (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  verdict TEXT NOT NULL,
  evidence_spans_json TEXT,
  comment TEXT,
  scored_at TEXT NOT NULL,
  UNIQUE(session_id, item_code)
);

CREATE TABLE IF NOT EXISTS feedback_report (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  overall_pass INTEGER,
  summary TEXT,
  improvements_json TEXT,
  disclaimer TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verify_probe (
  id TEXT PRIMARY KEY,
  probe_type TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def connect(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    out: dict[str, int] = {}
    for row in tables:
        name = row["name"]
        out[name] = conn.execute(f'SELECT COUNT(*) AS c FROM "{name}"').fetchone()["c"]
    return out


def set_meta(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        """
        INSERT INTO meta_kv(key, value, updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """,
        (key, json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value, utc_now()),
    )
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta_kv WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None
