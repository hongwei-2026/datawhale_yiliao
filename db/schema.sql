-- =============================================================================
-- AI 标准化病人 · 全项目数据库 Schema
-- 引擎：PostgreSQL 14+
-- 文档：数据库设计文档.md
-- 依据：标准设计文档.md / 病例设计文档.md / 项目架构设计文档.md
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- M0 公共
-- =============================================================================

CREATE TABLE scene (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_code      VARCHAR(32) NOT NULL UNIQUE,
  scene_key       VARCHAR(64) NOT NULL UNIQUE,
  name            VARCHAR(128) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('mvp', 'planned', 'retired')),
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE app_user (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code       VARCHAR(64) UNIQUE,
  display_name    VARCHAR(128),
  role            VARCHAR(32) NOT NULL DEFAULT 'trainee'
                  CHECK (role IN ('trainee', 'coach', 'admin', 'developer')),
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_import_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file     VARCHAR(512) NOT NULL,
  target_module   VARCHAR(64) NOT NULL,
  status          VARCHAR(32) NOT NULL
                  CHECK (status IN ('succeeded', 'failed', 'partial')),
  row_count       INT,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- M1 底座 A · 标准与评分
-- =============================================================================

CREATE TABLE standard_category (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code   VARCHAR(64) NOT NULL UNIQUE,
  name            VARCHAR(128) NOT NULL,
  color           VARCHAR(32),
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE standard_doc (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_code            VARCHAR(64) NOT NULL UNIQUE,
  title               VARCHAR(512) NOT NULL,
  short_title         VARCHAR(256) NOT NULL,
  doc_number          VARCHAR(256),
  issuer              VARCHAR(256),
  category_id         UUID REFERENCES standard_category(id),
  priority            VARCHAR(32) NOT NULL DEFAULT 'reference'
                      CHECK (priority IN ('primary', 'secondary', 'reference')),
  status              VARCHAR(32) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'upcoming', 'reference', 'retired')),
  status_label        VARCHAR(64),
  effective_from      DATE,
  effective_until     DATE,
  project_role        TEXT,
  local_file          VARCHAR(1024),
  local_file_label    VARCHAR(256),
  terminology_tags    JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE standard_link (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id          UUID NOT NULL REFERENCES standard_doc(id) ON DELETE CASCADE,
  label           VARCHAR(256) NOT NULL,
  url             TEXT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE standard_clause (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id          UUID NOT NULL REFERENCES standard_doc(id) ON DELETE CASCADE,
  clause_ref      VARCHAR(256) NOT NULL,
  summary         TEXT NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  UNIQUE (doc_id, clause_ref)
);

CREATE TABLE terminology (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term            VARCHAR(128) NOT NULL,
  definition      TEXT NOT NULL,
  field_name      VARCHAR(64) NOT NULL UNIQUE,
  source_doc_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE rubric_set (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_code        VARCHAR(64) NOT NULL,
  scene_id        UUID NOT NULL REFERENCES scene(id),
  version         VARCHAR(32) NOT NULL,
  title           VARCHAR(256),
  pass_rule       TEXT NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'retired')),
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (set_code, version)
);

CREATE TABLE rubric_layer (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          UUID NOT NULL REFERENCES rubric_set(id) ON DELETE CASCADE,
  layer_code      VARCHAR(8) NOT NULL,
  name            VARCHAR(64) NOT NULL,
  color           VARCHAR(32),
  sort_order      INT NOT NULL DEFAULT 0,
  UNIQUE (set_id, layer_code)
);

CREATE TABLE rubric_item (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          UUID NOT NULL REFERENCES rubric_set(id) ON DELETE CASCADE,
  item_code       VARCHAR(64) NOT NULL,
  layer           VARCHAR(8) NOT NULL,
  item_type       VARCHAR(32) NOT NULL
                  CHECK (item_type IN ('process', 'content', 'prohibition', 'quality')),
  title           VARCHAR(256) NOT NULL,
  pass_criteria   TEXT,
  fail_criteria   TEXT,
  hard_fail       BOOLEAN NOT NULL DEFAULT false,
  weight          NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  enabled_mvp     BOOLEAN NOT NULL DEFAULT false,
  binds_symptom   BOOLEAN NOT NULL DEFAULT false,
  lay_title       VARCHAR(256),
  lay_explain     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (set_id, item_code)
);

CREATE INDEX idx_rubric_item_mvp ON rubric_item(set_id, enabled_mvp, layer);

CREATE TABLE rubric_item_source (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_item_id  UUID NOT NULL REFERENCES rubric_item(id) ON DELETE CASCADE,
  doc_code        VARCHAR(64),
  clause_ref      VARCHAR(256),
  note            TEXT,
  source_raw      VARCHAR(512) NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_rubric_item_source_doc ON rubric_item_source(doc_code);

-- =============================================================================
-- M2 底座 B · 病例事实
-- =============================================================================

CREATE TABLE disease (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disease_code    VARCHAR(64) NOT NULL UNIQUE,
  name_zh         VARCHAR(128) NOT NULL,
  name_en         VARCHAR(128),
  icd10_code      VARCHAR(32),
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trial_protocol (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_code           VARCHAR(64) NOT NULL UNIQUE,
  disease_id              UUID NOT NULL REFERENCES disease(id),
  title                   VARCHAR(256) NOT NULL,
  phase                   VARCHAR(16) NOT NULL,
  intervention_summary    TEXT NOT NULL,
  control_summary         TEXT,
  is_placeholder          BOOLEAN NOT NULL DEFAULT true,
  status                  VARCHAR(32) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'active', 'retired')),
  extra                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_package (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code             VARCHAR(64) NOT NULL UNIQUE,
  protocol_id           UUID NOT NULL REFERENCES trial_protocol(id),
  disease_id            UUID NOT NULL REFERENCES disease(id),
  title                 VARCHAR(256) NOT NULL,
  short_title           VARCHAR(128) NOT NULL,
  data_status           VARCHAR(32) NOT NULL DEFAULT 'placeholder'
                        CHECK (data_status IN (
                          'placeholder', 'draft', 'reviewed', 'active', 'deprecated'
                        )),
  version               VARCHAR(32) NOT NULL,
  locale                VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  clinical_summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
  inclusion_hints       JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusion_hints       JSONB NOT NULL DEFAULT '[]'::jsonb,
  disclaimer            TEXT NOT NULL,
  is_default            BOOLEAN NOT NULL DEFAULT false,
  published_at          TIMESTAMPTZ,
  extra                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_package_status ON case_package(data_status);
CREATE UNIQUE INDEX uq_case_package_one_default
  ON case_package ((is_default))
  WHERE is_default = true;

CREATE TABLE case_symptom (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  symptom_code            VARCHAR(64) NOT NULL,
  name                    VARCHAR(128) NOT NULL,
  clinical_name           VARCHAR(128),
  category                VARCHAR(64),
  is_core                 BOOLEAN NOT NULL DEFAULT false,
  is_present              BOOLEAN NOT NULL DEFAULT true,
  severity_band           VARCHAR(16) NOT NULL DEFAULT 'mild'
                          CHECK (severity_band IN ('none', 'mild', 'moderate', 'severe')),
  onset_text              TEXT,
  course_text             TEXT,
  patient_may_say         JSONB NOT NULL DEFAULT '[]'::jsonb,
  researcher_should_ask   JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_confusions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order              INT NOT NULL DEFAULT 0,
  UNIQUE (case_id, symptom_code)
);

CREATE INDEX idx_case_symptom_core ON case_symptom(case_id, is_core, is_present);

CREATE TABLE case_medication (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                   UUID NOT NULL UNIQUE REFERENCES case_package(id) ON DELETE CASCADE,
  investigational_summary   TEXT,
  current_regimen_summary   TEXT,
  common_nonadherence       JSONB NOT NULL DEFAULT '[]'::jsonb,
  caution_points            JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra                     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE case_concomitant_drug (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  drug_name       VARCHAR(128) NOT NULL,
  dose_text       VARCHAR(128),
  purpose         VARCHAR(256),
  is_ongoing      BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE case_risk_point (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  risk_code       VARCHAR(64) NOT NULL,
  title           VARCHAR(256) NOT NULL,
  lay_summary     TEXT NOT NULL,
  must_disclose   BOOLEAN NOT NULL DEFAULT true,
  severity_hint   VARCHAR(32),
  source_note     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  UNIQUE (case_id, risk_code)
);

CREATE TABLE case_benefit_point (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  benefit_code    VARCHAR(64) NOT NULL,
  title           VARCHAR(256) NOT NULL,
  lay_summary     TEXT NOT NULL,
  is_uncertain    BOOLEAN NOT NULL DEFAULT true,
  must_disclose   BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  UNIQUE (case_id, benefit_code)
);

CREATE TABLE case_visit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  visit_code      VARCHAR(64) NOT NULL,
  name            VARCHAR(128) NOT NULL,
  timing_text     VARCHAR(256),
  purpose         TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  UNIQUE (case_id, visit_code)
);

CREATE TABLE case_visit_item (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id              UUID NOT NULL REFERENCES case_visit(id) ON DELETE CASCADE,
  item_code             VARCHAR(64) NOT NULL,
  item_type             VARCHAR(32) NOT NULL
                        CHECK (item_type IN ('symptom', 'ae', 'lab', 'adherence', 'other')),
  label                 VARCHAR(256) NOT NULL,
  linked_symptom_code   VARCHAR(64),
  sort_order            INT NOT NULL DEFAULT 0,
  UNIQUE (visit_id, item_code)
);

CREATE TABLE case_forbidden (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  forbidden_code      VARCHAR(64) NOT NULL,
  category            VARCHAR(64) NOT NULL
                      CHECK (category IN ('symptom', 'diagnosis', 'lab', 'event', 'claim', 'other')),
  description         TEXT NOT NULL,
  remediating_reply   TEXT,
  UNIQUE (case_id, forbidden_code)
);

CREATE TABLE case_comorbidity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  name            VARCHAR(128) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'stable',
  note            TEXT,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE case_lab_hint (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  lab_code        VARCHAR(64) NOT NULL,
  name            VARCHAR(128) NOT NULL,
  value_text      VARCHAR(128),
  interpreted_as  TEXT,
  patient_knows   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (case_id, lab_code)
);

CREATE TABLE patient_persona (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_code            VARCHAR(64) NOT NULL UNIQUE,
  display_name            VARCHAR(128) NOT NULL,
  age_band                VARCHAR(32) NOT NULL,
  sex                     VARCHAR(16) NOT NULL,
  cognition_level         VARCHAR(32) NOT NULL,
  emotion_baseline        VARCHAR(32) NOT NULL,
  adherence_tendency      VARCHAR(32) NOT NULL,
  concealment_tendency    VARCHAR(32) NOT NULL,
  comprehension_style     VARCHAR(64) NOT NULL,
  literacy_level          VARCHAR(32),
  hearing_note            VARCHAR(64),
  living_situation        VARCHAR(64),
  lay_bio                 TEXT,
  extra_slots             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE case_persona_link (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  persona_id      UUID NOT NULL REFERENCES patient_persona(id),
  is_default      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (case_id, persona_id)
);

CREATE TABLE case_scene_binding (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES case_package(id) ON DELETE CASCADE,
  scene_id        UUID NOT NULL REFERENCES scene(id),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  UNIQUE (case_id, scene_id)
);

-- 评分项 ↔ 病例事实咬合（依赖 M1 + M2）
CREATE TABLE rubric_item_binding (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_item_id      UUID NOT NULL REFERENCES rubric_item(id) ON DELETE CASCADE,
  case_id             UUID REFERENCES case_package(id) ON DELETE CASCADE,
  binding_type        VARCHAR(32) NOT NULL
                      CHECK (binding_type IN ('symptom', 'risk', 'benefit', 'visit_item', 'other')),
  target_code         VARCHAR(64) NOT NULL,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  notes               TEXT,
  UNIQUE (rubric_item_id, case_id, binding_type, target_code)
);

-- =============================================================================
-- M4 AI 数据存储（先于会话中的 FK 引用）
-- =============================================================================

CREATE TABLE ai_model_profile (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code    VARCHAR(64) NOT NULL UNIQUE,
  provider        VARCHAR(64) NOT NULL,
  model_name      VARCHAR(128) NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref      VARCHAR(128),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_prompt_template (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code   VARCHAR(64) NOT NULL UNIQUE,
  purpose         VARCHAR(32) NOT NULL
                  CHECK (purpose IN (
                    'patient_system', 'patient_turn', 'scorer', 'feedback', 'safety', 'other'
                  )),
  name            VARCHAR(128) NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_prompt_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES ai_prompt_template(id) ON DELETE CASCADE,
  version         VARCHAR(32) NOT NULL,
  template_body   TEXT NOT NULL,
  input_schema    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(32) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'retired')),
  changelog       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

-- =============================================================================
-- M3 训练运行时
-- =============================================================================

CREATE TABLE training_session (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID NOT NULL REFERENCES case_package(id),
  case_version                VARCHAR(32) NOT NULL,
  persona_id                  UUID NOT NULL REFERENCES patient_persona(id),
  scene_id                    UUID NOT NULL REFERENCES scene(id),
  rubric_set_id               UUID REFERENCES rubric_set(id),
  rubric_version              VARCHAR(32),
  trainee_user_id             UUID REFERENCES app_user(id),
  trainee_ref                 VARCHAR(128),
  patient_prompt_version_id   UUID REFERENCES ai_prompt_version(id),
  status                      VARCHAR(32) NOT NULL DEFAULT 'in_progress'
                              CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                    TIMESTAMPTZ,
  meta                        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_training_session_case_time
  ON training_session(case_id, started_at DESC);
CREATE INDEX idx_training_session_trainee
  ON training_session(trainee_user_id, started_at DESC);

CREATE TABLE ai_agent_run (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES training_session(id) ON DELETE SET NULL,
  run_type        VARCHAR(32) NOT NULL
                  CHECK (run_type IN (
                    'patient_reply', 'score_session', 'feedback', 'safety', 'other'
                  )),
  status          VARCHAR(32) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  error_message   TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ai_agent_run_session ON ai_agent_run(session_id, started_at DESC);

CREATE TABLE ai_generation_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID REFERENCES ai_agent_run(id) ON DELETE SET NULL,
  session_id          UUID REFERENCES training_session(id) ON DELETE SET NULL,
  profile_id          UUID REFERENCES ai_model_profile(id),
  prompt_version_id   UUID REFERENCES ai_prompt_version(id),
  step_name           VARCHAR(64),
  request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_text       TEXT,
  response_raw        JSONB,
  token_usage         JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms          INT,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_generation_session_time
  ON ai_generation_log(session_id, created_at DESC);

CREATE TABLE ai_grounding_check (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id       UUID NOT NULL REFERENCES ai_generation_log(id) ON DELETE CASCADE,
  check_type          VARCHAR(64) NOT NULL,
  passed              BOOLEAN NOT NULL,
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  action              VARCHAR(32) NOT NULL DEFAULT 'allow'
                      CHECK (action IN ('allow', 'regenerate', 'replace_with_fallback', 'block')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session_message (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  turn_index          INT NOT NULL,
  role                VARCHAR(16) NOT NULL
                      CHECK (role IN ('trainee', 'patient', 'system', 'coach')),
  content             TEXT NOT NULL,
  ai_generation_id    UUID REFERENCES ai_generation_log(id),
  client_meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_index)
);

CREATE TABLE score_result (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  item_code           VARCHAR(64) NOT NULL,
  verdict             VARCHAR(16) NOT NULL
                      CHECK (verdict IN ('pass', 'fail', 'uncertain', 'skipped')),
  evidence_spans      JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment             TEXT,
  source_refs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  scorer_type         VARCHAR(16) NOT NULL DEFAULT 'hybrid'
                      CHECK (scorer_type IN ('rule', 'llm', 'hybrid')),
  ai_generation_id    UUID REFERENCES ai_generation_log(id),
  scored_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, item_code)
);

CREATE TABLE feedback_report (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE REFERENCES training_session(id) ON DELETE CASCADE,
  overall_pass        BOOLEAN,
  summary             TEXT,
  improvements        JSONB NOT NULL DEFAULT '[]'::jsonb,
  disclaimer          TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_generation_id    UUID REFERENCES ai_generation_log(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- M5 内容层（导读 / 白话，可选）
-- =============================================================================

CREATE TABLE content_guide_section (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_code    VARCHAR(64) NOT NULL UNIQUE,
  title           VARCHAR(256) NOT NULL,
  body            TEXT NOT NULL,
  analogy         TEXT,
  points          JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules           JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order      INT NOT NULL DEFAULT 0
);

CREATE TABLE content_standard_lay (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_code        VARCHAR(64) NOT NULL UNIQUE,
  one_liner       TEXT NOT NULL,
  why_needed      TEXT NOT NULL,
  main_points     JSONB NOT NULL DEFAULT '[]'::jsonb,
  in_this_project TEXT NOT NULL
);

CREATE TABLE content_rubric_lay (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code       VARCHAR(64) NOT NULL UNIQUE,
  lay_title       VARCHAR(256) NOT NULL,
  lay_explain     TEXT NOT NULL
);

-- =============================================================================
-- 种子数据：场景
-- =============================================================================

INSERT INTO scene (scene_code, scene_key, name, status, description, sort_order) VALUES
  ('S1', 'informed_consent', '知情同意沟通', 'mvp', '研究者向试验参与者充分告知并获取自愿同意', 1),
  ('S2', 'risk_explanation', '风险解释', 'planned', '平衡、准确地说明试验风险与获益不确定性', 2),
  ('S3', 'medication', '用药情况了解', 'planned', '说明用药方法、了解依从性与合并用药', 3),
  ('S4', 'adherence', '依从性沟通', 'planned', '识别并讨论漏服、错服等不依从问题', 4),
  ('S5', 'follow_up', '随访与 AE 沟通', 'planned', '随访期间 AE 处理与新安全性信息沟通', 5);

-- Prompt 模板目录种子（正文版本由应用写入）
INSERT INTO ai_prompt_template (template_code, purpose, name, description) VALUES
  ('patient-system', 'patient_system', 'AI 患者系统约束', '注入病例事实、禁止编造与人设槽位'),
  ('patient-turn', 'patient_turn', 'AI 患者单轮回复', '基于会话上下文生成口语回复'),
  ('scorer-session', 'scorer', '会话评分', '对照评分项输出 verdict + evidence'),
  ('feedback-report', 'feedback', '反馈报告', '生成改进建议与总述');
