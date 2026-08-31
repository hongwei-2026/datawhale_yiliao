from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import sessions as session_svc
from .agnes import AgnesClient
from .auth import (
    authenticate_user,
    create_access_token,
    get_current_user_optional,
    migrate_legacy_sessions,
    register_user,
    require_admin,
    require_user,
)
from . import admin_svc
from .config import get_settings
from .db import connect, get_meta, init_schema, migrate_schema, new_id, set_meta, table_counts, utc_now
from .minimax_tts import MiniMaxTTS
from .musetalk import MuseTalkService
from .talking_head import TalkingHeadService
from .seed import seed

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "web"
VERIFY_HTML = Path(__file__).resolve().parent / "static" / "verify.html"

# 外行可读的数据分组（网站「数据库」页使用）
TABLE_GROUPS = [
    {
        "id": "standards",
        "title": "① 沟通标准（尺子）",
        "plain": "国家规范收在这里。评分时对照这些「必须说 / 不能说」的依据。",
        "tables": [
            ("standard_category", "标准分类"),
            ("standard_doc", "收录的规范文件"),
            ("standard_clause", "关键条款摘要"),
            ("terminology", "统一术语"),
        ],
    },
    {
        "id": "rubric",
        "title": "② 评分清单",
        "plain": "练完对话后，系统逐条检查有没有说到、有没有踩红线。",
        "tables": [
            ("rubric_set", "评分表版本"),
            ("rubric_item", "具体检查项"),
        ],
    },
    {
        "id": "cases",
        "title": "③ 病例与病人设定",
        "plain": "AI 病人只能按这里的病情说话，不能瞎编症状。",
        "tables": [
            ("disease", "疾病目录"),
            ("trial_protocol", "试验方案摘要"),
            ("case_package", "病例包"),
            ("case_symptom", "症状事实"),
            ("case_risk_point", "应告知风险"),
            ("patient_persona", "患者人设槽位"),
            ("scene", "训练场景"),
        ],
    },
    {
        "id": "runtime",
        "title": "④ 练习过程记录",
        "plain": "每次开练、每句对话、每条打分会记在这里，便于回放。",
        "tables": [
            ("training_session", "训练会话"),
            ("session_message", "对话消息"),
            ("score_result", "评分结果"),
            ("feedback_report", "反馈报告"),
        ],
    },
    {
        "id": "ai",
        "title": "⑤ AI 调用与验证",
        "plain": "调用 Agnes 的记录与连通性测试痕迹，用来证明「真的接上了」。",
        "tables": [
            ("ai_model_profile", "模型配置"),
            ("ai_prompt_template", "提示词模板"),
            ("ai_prompt_version", "提示词版本"),
            ("ai_agent_run", "一次 AI 编排"),
            ("ai_generation_log", "模型调用日志"),
            ("verify_probe", "连通性探针"),
        ],
    },
]



@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    db_path = settings.sqlite_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app.state.db_path = str(db_path)
    app.state.settings = settings
    seed(app.state.db_path)
    conn = connect(app.state.db_path)
    init_schema(conn)
    conn.close()
    session_svc.backfill_missing_scores(app.state.db_path)
    app.state.legacy_migration = migrate_legacy_sessions(app.state.db_path)
    app.state.admin_bootstrap = admin_svc.ensure_admin_user(app.state.db_path)
    yield


app = FastAPI(
    title="临床试验 AI 标准化病人 · API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = Path(__file__).resolve().parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.mount("/css", StaticFiles(directory=str(WEB_DIR / "css")), name="web-css")
app.mount("/js", StaticFiles(directory=str(WEB_DIR / "js")), name="web-js")
app.mount("/data", StaticFiles(directory=str(WEB_DIR / "data")), name="web-data")
app.mount("/avatars", StaticFiles(directory=str(WEB_DIR / "avatars")), name="web-avatars")
live2d_dir = WEB_DIR / "live2d"
if live2d_dir.is_dir():
    app.mount("/live2d", StaticFiles(directory=str(live2d_dir)), name="web-live2d")
talking_cache_dir = ROOT / "data" / "talking_cache"
talking_cache_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/talking", StaticFiles(directory=str(talking_cache_dir)), name="talking-media")


def db():
    return connect(app.state.db_path)


def build_lay_groups(counts: dict) -> list:
    groups = []
    for g in TABLE_GROUPS:
        items = []
        for table, label in g["tables"]:
            items.append(
                {
                    "table": table,
                    "label": label,
                    "count": counts.get(table, 0),
                }
            )
        groups.append(
            {
                "id": g["id"],
                "title": g["title"],
                "plain": g["plain"],
                "total": sum(i["count"] for i in items),
                "items": items,
            }
        )
    return groups


@app.get("/")
def root():
    """网站首页（外行可读）；API 信息见 /api。"""
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api")
def api_root():
    return {
        "service": "sp-training-api",
        "site": "/",
        "database_page": "/#explain-database",
        "docs": "/docs",
        "verify_api": "/api/db/verify",
        "ai_ping": "/api/ai/ping",
    }


@app.get("/health")
def health():
    settings = app.state.settings
    conn = db()
    counts = table_counts(conn)
    conn.close()
    tts = MiniMaxTTS(settings)
    return {
        "ok": True,
        "database_file": app.state.db_path,
        "agnes_configured": AgnesClient(settings).configured,
        "agnes_model": settings.agnes_model,
        "api_key_masked": settings.api_key_masked,
        "minimax_configured": tts.configured,
        "minimax_key_masked": settings.minimax_key_masked,
        "minimax_tts_model": settings.minimax_tts_model,
        "table_count": len(counts),
    }


class TtsBody(BaseModel):
    text: str = Field(min_length=1, max_length=800)


class PatientSpeakBody(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    persona_id: str = Field(default="", max_length=64)
    prefer_talking_video: bool = True
    emotion: str = Field(default="", max_length=32)


@app.get("/api/voice/status")
def api_voice_status():
    settings = app.state.settings
    tts = MiniMaxTTS(settings)
    talking = TalkingHeadService(settings)
    musetalk = MuseTalkService(settings)
    mt_health = musetalk.health() if musetalk.enabled else {"ok": False}
    return {
        "ok": True,
        "configured": tts.configured,
        "api_key_masked": settings.minimax_key_masked,
        "model": settings.minimax_tts_model,
        "voice_id": settings.minimax_voice_id,
        "stt": "browser_web_speech",
        "musetalk": {
            "enabled": musetalk.enabled,
            "ready": bool(mt_health.get("ok")),
            "avatars": mt_health.get("avatars") or [],
            "error": mt_health.get("error"),
            "base_url": musetalk.base_url if musetalk.enabled else None,
            "timeout_sec": settings.musetalk_timeout_sec,
            "note": "GPU 本地 MuseTalk，音画合一口型（推荐）",
        },
        "talking_head": {
            "enabled": talking.enabled,
            "provider": "minimax_h3",
            "resolution": settings.talking_head_resolution,
            "timeout_sec": settings.talking_head_timeout_sec,
            "note": "默认关闭；开启后需等待 30–90 秒生成视频，且与实时语音不同步",
        },
        "note": "受试者旁白用 MiniMax TTS；你的说话用浏览器语音识别，便于低延迟与打断。",
    }


@app.get("/api/voice/talking-head/status")
def api_talking_head_status():
    settings = app.state.settings
    talking = TalkingHeadService(settings)
    return {
        "ok": True,
        "enabled": talking.enabled,
        "provider": "minimax_h3",
        "resolution": settings.talking_head_resolution,
        "timeout_sec": settings.talking_head_timeout_sec,
    }


@app.post("/api/voice/patient-speak")
def api_voice_patient_speak(body: PatientSpeakBody):
    """受试者说话：TTS + 可选 MuseTalk/H3 口型视频。"""
    settings = app.state.settings
    tts = MiniMaxTTS(settings)
    talking = TalkingHeadService(settings)
    musetalk = MuseTalkService(settings)

    tts_result = tts.synthesize(body.text, emotion=body.emotion or None)
    if not tts_result.get("ok") and body.emotion:
        tts_result = tts.synthesize(body.text, emotion=None)
    if not tts_result.get("ok"):
        err = tts_result.get("error") or "语音合成失败"
        # 余额不足等：软失败，前端可继续纯文字对话
        if any(k in str(err).lower() for k in ("insufficient", "balance", "余额", "quota")):
            return {
                "ok": False,
                "soft": True,
                "error": f"{err}（语音暂时不可用，可继续文字对话）",
                "mode": "text_only",
            }
        raise HTTPException(400, err)

    import base64 as b64mod

    audio_bytes = b64mod.b64decode(tts_result["audio_base64"])
    audio_length_ms = tts_result.get("audio_length_ms")

    out = {
        "ok": True,
        "format": tts_result.get("format") or "mp3",
        "audio_base64": tts_result["audio_base64"],
        "audio_length_ms": audio_length_ms,
        "mode": "audio_only",
        "model": tts_result.get("model"),
        "voice_id": tts_result.get("voice_id"),
    }

    if not body.prefer_talking_video:
        return out

    # MuseTalk（GPU 本地，音画合一）优先
    if musetalk.enabled:
        cached = musetalk.cached_video_url(body.persona_id, body.text, audio_bytes)
        if cached:
            out.update({
                "mode": "talking_video",
                "video_url": cached,
                "cache_hit": True,
                "lip_sync": "musetalk",
            })
            return out
        job_id = musetalk.start_job(
            persona_id=body.persona_id,
            text=body.text,
            audio_bytes=audio_bytes,
        )
        out.update({
            "mode": "musetalk_video_job",
            "video_job_id": job_id,
            "lip_sync": "musetalk",
            "note": "等待 GPU 口型视频（音画合一，约 3–15 秒）",
        })
        return out

    # 回退：MiniMax H3（慢，默认关闭）
    video_audio_bytes = audio_bytes
    video_audio_ms = audio_length_ms
    if talking.enabled and (not audio_length_ms or audio_length_ms < 2000):
        padded = tts.synthesize(f"{body.text.rstrip()}……")
        if padded.get("ok"):
            video_audio_bytes = b64mod.b64decode(padded["audio_base64"])
            video_audio_ms = padded.get("audio_length_ms")

    if not talking.enabled:
        return out

    cached = talking.cached_video_url(body.persona_id, body.text, video_audio_bytes)
    if cached:
        out.update({"mode": "talking_video", "video_url": cached, "cache_hit": True})
        return out

    job_id = talking.start_job(
        persona_id=body.persona_id,
        text=body.text,
        audio_bytes=video_audio_bytes,
        audio_length_ms=video_audio_ms,
    )
    out.update({
        "mode": "audio_with_video_job",
        "video_job_id": job_id,
        "lip_sync": "h3",
        "note": "语音立即播放；口型视频后台生成，完成后自动切换",
    })
    return out


@app.get("/api/voice/patient-speak/video/{job_id}")
def api_voice_patient_speak_video(job_id: str):
    settings = app.state.settings
    job = MuseTalkService(settings).get_job(job_id)
    if not job:
        job = TalkingHeadService(settings).get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在或已过期")
    return {"ok": True, **job}


@app.post("/api/voice/tts")
def api_voice_tts(body: TtsBody):
    tts = MiniMaxTTS(app.state.settings)
    result = tts.synthesize(body.text)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "语音合成失败")
    return result


@app.get("/api/db/verify")
def db_verify():
    """数据库接入验证：返回文件路径、表行数、样例记录。"""
    conn = db()
    counts = table_counts(conn)
    seed_info = get_meta(conn, "seed_info")
    sample_standards = [
        dict(r)
        for r in conn.execute(
            "SELECT doc_code, short_title, priority, status FROM standard_doc ORDER BY doc_code LIMIT 5"
        ).fetchall()
    ]
    sample_symptoms = [
        dict(r)
        for r in conn.execute(
            """
            SELECT symptom_code, name, is_core, is_present, severity_band
            FROM case_symptom WHERE is_core=1 ORDER BY symptom_code LIMIT 8
            """
        ).fetchall()
    ]
    sample_case = conn.execute(
        "SELECT case_code, short_title, data_status, version FROM case_package LIMIT 1"
    ).fetchone()
    recent_ai = [
        dict(r)
        for r in conn.execute(
            """
            SELECT id, step_name, latency_ms, substr(response_text,1,120) AS response_preview,
                   error_message, created_at
            FROM ai_generation_log ORDER BY created_at DESC LIMIT 5
            """
        ).fetchall()
    ]
    probes = [
        dict(r)
        for r in conn.execute(
            "SELECT id, probe_type, ok, detail_json, created_at FROM verify_probe ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
    ]
    conn.close()

    ok = (
        counts.get("standard_doc", 0) >= 1
        and counts.get("case_package", 0) >= 1
        and counts.get("case_symptom", 0) >= 1
        and counts.get("rubric_item", 0) >= 1
    )
    settings = app.state.settings
    return {
        "ok": ok,
        "message": "数据库已接入：标准、病例、评分都已装进库里" if ok else "数据库缺少关键种子数据",
        "plain_summary": (
            "可以把数据库理解成项目的「仓库」：规范尺子、病例事实、练习记录、AI 调用日志都放在这里。"
            "下面数字就是仓库各货架上现有的条目数。"
        ),
        "database_file": app.state.db_path,
        "agnes": {
            "configured": AgnesClient(settings).configured,
            "model": settings.agnes_model,
            "api_key_masked": settings.api_key_masked,
            "base_url": settings.agnes_base_url,
        },
        "seed_info": json.loads(seed_info) if seed_info and seed_info.startswith("{") else seed_info,
        "table_counts": counts,
        "groups": build_lay_groups(counts),
        "samples": {
            "case": dict(sample_case) if sample_case else None,
            "standards": sample_standards,
            "core_symptoms": sample_symptoms,
            "recent_ai_logs": recent_ai,
            "verify_probes": probes,
        },
        "how_to_prove": [
            "打开网站「数据库」页看分组数字与样例",
            "点「试写一条记录」后，探针表数字会增加",
            "点「呼叫 Agnes」后，AI 日志会出现新回复",
            f"也可用工具直接打开文件：{app.state.db_path}",
        ],
    }


@app.post("/api/db/probe")
def db_probe():
    """写入一条探针记录，证明可写库。"""
    conn = db()
    pid = new_id()
    detail = {"note": "manual probe", "at": utc_now()}
    conn.execute(
        "INSERT INTO verify_probe(id, probe_type, ok, detail_json, created_at) VALUES(?,?,?,?,?)",
        (pid, "write_probe", 1, json.dumps(detail, ensure_ascii=False), utc_now()),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "probe_id": pid, "detail": detail}


@app.post("/api/ai/ping")
def ai_ping():
    """调用 Agnes，并把请求/响应写入 ai_generation_log + verify_probe。"""
    settings = app.state.settings
    client = AgnesClient(settings)
    conn = db()
    run_id = new_id()
    gen_id = new_id()
    session_id = new_id()
    started = utc_now()

    conn.execute(
        """
        INSERT INTO training_session(
          id, case_code, case_version, persona_code, scene_key, rubric_version, status, started_at, meta_json
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            session_id,
            "CASE-T2DM-PH2-001",
            "0.1.0",
            "PER-ELDER-BASIC-01",
            "informed_consent",
            "1.0.0-mvp",
            "completed",
            started,
            json.dumps({"purpose": "ai_ping"}, ensure_ascii=False),
        ),
    )
    conn.execute(
        "INSERT INTO ai_agent_run(id, session_id, run_type, status, started_at) VALUES(?,?,?,?,?)",
        (run_id, session_id, "other", "running", started),
    )
    conn.commit()

    messages = [
        {
            "role": "system",
            "content": "你是临床试验沟通训练系统的连通性测试助手。用一两句中文确认你已收到请求。",
        },
        {
            "role": "user",
            "content": "请回复：Agnes API 已接通，可用于 AI 标准化病人项目。",
        },
    ]

    try:
        result = client.chat(messages)
    except Exception as exc:
        result = {"ok": False, "error": str(exc), "latency_ms": None, "content": "", "response": None, "usage": None}

    ended = utc_now()
    ok = bool(result.get("ok"))
    conn.execute(
        """
        UPDATE ai_agent_run SET status=?, ended_at=?, error_message=? WHERE id=?
        """,
        ("succeeded" if ok else "failed", ended, None if ok else str(result.get("error")), run_id),
    )
    # 脱敏：日志不存完整 API key
    safe_request = {
        "model": settings.agnes_model,
        "base_url": settings.agnes_base_url,
        "messages": messages,
    }
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
            "ping",
            "ai_ping",
            json.dumps(safe_request, ensure_ascii=False),
            result.get("content") or "",
            json.dumps(result.get("response"), ensure_ascii=False) if result.get("response") is not None else None,
            json.dumps(result.get("usage"), ensure_ascii=False) if result.get("usage") is not None else None,
            result.get("latency_ms"),
            None if ok else json.dumps(result.get("error"), ensure_ascii=False),
            ended,
        ),
    )
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, ai_generation_id, created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (new_id(), session_id, 0, "system", messages[0]["content"], None, started),
    )
    conn.execute(
        """
        INSERT INTO session_message(id, session_id, turn_index, role, content, ai_generation_id, created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (new_id(), session_id, 1, "trainee", messages[1]["content"], None, started),
    )
    if ok:
        conn.execute(
            """
            INSERT INTO session_message(id, session_id, turn_index, role, content, ai_generation_id, created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (new_id(), session_id, 2, "patient", result.get("content") or "", gen_id, ended),
        )

    probe_id = new_id()
    conn.execute(
        "INSERT INTO verify_probe(id, probe_type, ok, detail_json, created_at) VALUES(?,?,?,?,?)",
        (
            probe_id,
            "agnes_ping",
            1 if ok else 0,
            json.dumps(
                {
                    "generation_id": gen_id,
                    "session_id": session_id,
                    "latency_ms": result.get("latency_ms"),
                    "content_preview": (result.get("content") or "")[:200],
                    "error": result.get("error"),
                },
                ensure_ascii=False,
            ),
            ended,
        ),
    )
    set_meta(
        conn,
        "last_ai_ping",
        {
            "ok": ok,
            "at": ended,
            "generation_id": gen_id,
            "latency_ms": result.get("latency_ms"),
        },
    )
    conn.commit()
    conn.close()

    return {
        "ok": ok,
        "message": "Agnes 调用成功，并已写入数据库" if ok else "Agnes 调用失败（错误已写入数据库）",
        "api_key_masked": settings.api_key_masked,
        "model": settings.agnes_model,
        "base_url": settings.agnes_base_url,
        "latency_ms": result.get("latency_ms"),
        "content": result.get("content"),
        "error": result.get("error"),
        "persisted": {
            "session_id": session_id,
            "run_id": run_id,
            "generation_id": gen_id,
            "probe_id": probe_id,
            "database_file": app.state.db_path,
        },
        "check_next": "/api/db/verify",
    }


@app.get("/api/cases/default")
def default_case():
    conn = db()
    row = conn.execute(
        "SELECT case_code, short_title, data_status, version, disclaimer FROM case_package WHERE is_default=1 LIMIT 1"
    ).fetchone()
    symptoms = [
        dict(r)
        for r in conn.execute(
            "SELECT symptom_code, name, is_core, is_present FROM case_symptom WHERE case_code=? ORDER BY symptom_code",
            (row["case_code"],),
        ).fetchall()
    ] if row else []
    conn.close()
    return {"ok": bool(row), "case": dict(row) if row else None, "symptoms": symptoms}


@app.get("/verify")
def verify_page():
    """旧验证页入口：跳转到网站「数据库」页。"""
    return RedirectResponse(url="/#explain-database", status_code=307)


@app.get("/verify/legacy", response_class=HTMLResponse)
def verify_page_legacy():
    if VERIFY_HTML.exists():
        return HTMLResponse(VERIFY_HTML.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>verify.html missing</h1>", status_code=500)


@app.post("/api/db/reseed")
def reseed():
    result = seed(app.state.db_path, force=True)
    return result


# ----- 用户认证 -----

class RegisterBody(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)


class LoginBody(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/auth/register")
def api_register(body: RegisterBody):
    result = register_user(
        app.state.db_path,
        username=body.username,
        password=body.password,
        display_name=body.display_name,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "注册失败")
    settings = app.state.settings
    token = create_access_token(
        result["user"]["id"], settings.jwt_secret, settings.jwt_ttl_seconds
    )
    return {"ok": True, "token": token, "user": result["user"]}


@app.post("/api/auth/login")
def api_login(body: LoginBody):
    result = authenticate_user(app.state.db_path, body.username, body.password)
    if not result.get("ok"):
        raise HTTPException(401, result.get("error") or "登录失败")
    settings = app.state.settings
    token = create_access_token(
        result["user"]["id"], settings.jwt_secret, settings.jwt_ttl_seconds
    )
    return {"ok": True, "token": token, "user": result["user"]}


@app.get("/api/auth/me")
def api_me(user: dict | None = Depends(get_current_user_optional)):
    if not user:
        return {"ok": True, "authenticated": False, "user": None}
    return {"ok": True, "authenticated": True, "user": user}


@app.get("/api/auth/legacy-info")
def api_legacy_info():
    """历史数据归属账号说明（不含密码）。"""
    mig = getattr(app.state, "legacy_migration", None) or {}
    return {
        "ok": True,
        "username": mig.get("username", "history"),
        "display_name": mig.get("display_name", "历史练习数据"),
        "migrated_sessions": mig.get("migrated", 0),
        "note": "上线登录功能前的练习记录已归属此账号，请联系管理员获取初始密码。",
    }


# ----- 练习会话：AI 对话 + 反馈 -----

class CreateSessionBody(BaseModel):
    case_id: str | None = None
    session_mode: str = Field(default="practice", pattern="^(practice|assessment)$")
    study_mode: str = Field(default="reference", pattern="^(reference|strict)$")


class TurnBody(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


@app.get("/api/sessions/history")
def api_session_history(limit: int = 20, user: dict = Depends(require_user)):
    sessions = session_svc.list_sessions(
        app.state.db_path,
        limit=limit,
        trainee_user_id=user["id"],
        actor_role=user.get("role"),
    )
    return {"ok": True, "sessions": sessions}


@app.post("/api/sessions")
def api_create_session(
    body: CreateSessionBody | None = None,
    user: dict = Depends(require_user),
):
    body = body or CreateSessionBody()
    return session_svc.create_session(
        app.state.db_path,
        body.case_id,
        trainee_user_id=user["id"],
        session_mode=body.session_mode,
        study_mode=body.study_mode,
        settings=app.state.settings,
    )


@app.get("/api/sessions/{session_id}")
def api_get_session(session_id: str, user: dict = Depends(require_user)):
    sess = session_svc.get_session(app.state.db_path, session_id)
    err = session_svc.session_access_error(sess, user["id"], actor_role=user.get("role"))
    if err:
        raise HTTPException(404 if err == "会话不存在" else 403, err)
    meta = session_svc.parse_session_meta(sess)
    return {
        "ok": True,
        "session": {
            "id": sess["id"],
            "case_code": sess["case_code"],
            "case_version": sess["case_version"],
            "persona_code": sess.get("persona_code"),
            "status": sess["status"],
            "started_at": sess["started_at"],
            "ended_at": sess["ended_at"],
            "session_mode": meta["session_mode"],
            "study_mode": meta["study_mode"],
        },
        "messages": session_svc.get_messages(app.state.db_path, session_id),
        "feedback": session_svc.get_feedback(app.state.db_path, session_id),
        "patient_affect": session_svc.session_patient_affect(sess),
    }


@app.post("/api/sessions/{session_id}/turns")
def api_post_turn(session_id: str, body: TurnBody, user: dict = Depends(require_user)):
    result = session_svc.post_turn(
        app.state.db_path,
        app.state.settings,
        session_id,
        body.content,
        user["id"],
        actor_role=user.get("role"),
    )
    if not result.get("ok"):
        status = int(result.get("http_status") or 400)
        raise HTTPException(status, result.get("error") or "发送失败")
    return result


@app.post("/api/sessions/{session_id}/complete")
def api_complete(session_id: str, user: dict = Depends(require_user)):
    result = session_svc.complete_session(
        app.state.db_path,
        app.state.settings,
        session_id,
        user["id"],
        actor_role=user.get("role"),
    )
    if not result.get("ok"):
        status = int(result.get("http_status") or 400)
        raise HTTPException(status, result.get("error") or "结束失败")
    return result


@app.get("/api/sessions/{session_id}/feedback")
def api_feedback(session_id: str, user: dict = Depends(require_user)):
    sess = session_svc.get_session(app.state.db_path, session_id)
    err = session_svc.session_access_error(sess, user["id"], actor_role=user.get("role"))
    if err:
        raise HTTPException(404 if err == "会话不存在" else 403, err)
    fb = session_svc.get_feedback(app.state.db_path, session_id)
    if not fb:
        raise HTTPException(404, "尚无反馈，请先结束沟通")
    return {"ok": True, "feedback": fb}


# ----- 管理端 -----

class AdminUserCreateBody(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = "trainee"


class AdminUserUpdateBody(BaseModel):
    role: str | None = None
    display_name: str | None = None
    password: str | None = None


class AdminSceneBody(BaseModel):
    id: str | None = None
    scene_key: str | None = None
    title: str | None = None
    name: str | None = None
    summary: str = ""
    description: str | None = None
    code: str | None = None
    enabled: bool = True


class AdminAvatarBody(BaseModel):
    persona_id: str
    visual: str | None = None
    portrait_path: str | None = None
    model_id: str | None = None


@app.get("/api/admin/stats")
def api_admin_stats(user: dict = Depends(require_admin)):
    return admin_svc.admin_stats(app.state.db_path)


@app.get("/api/admin/users")
def api_admin_users(user: dict = Depends(require_admin)):
    return {"ok": True, "users": admin_svc.list_users(app.state.db_path)}


@app.post("/api/admin/users")
def api_admin_create_user(body: AdminUserCreateBody, user: dict = Depends(require_admin)):
    result = admin_svc.create_user(
        app.state.db_path,
        username=body.username,
        password=body.password,
        display_name=body.display_name,
        role=body.role,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "创建失败")
    return result


@app.patch("/api/admin/users/{user_id}")
def api_admin_update_user(user_id: str, body: AdminUserUpdateBody, user: dict = Depends(require_admin)):
    result = admin_svc.update_user(
        app.state.db_path,
        user_id,
        role=body.role,
        display_name=body.display_name,
        password=body.password,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "更新失败")
    return result


@app.delete("/api/admin/users/{user_id}")
def api_admin_delete_user(user_id: str, user: dict = Depends(require_admin)):
    result = admin_svc.delete_user(app.state.db_path, user_id, actor_id=user["id"])
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "删除失败")
    return result


@app.get("/api/admin/cases")
def api_admin_cases(user: dict = Depends(require_admin)):
    return admin_svc.list_case_catalog()


@app.post("/api/admin/cases/import")
def api_admin_import_case(body: dict, user: dict = Depends(require_admin)):
    result = admin_svc.import_case_package(body)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "导入失败")
    return result


@app.delete("/api/admin/cases/{case_id}")
def api_admin_delete_case(case_id: str, user: dict = Depends(require_admin)):
    result = admin_svc.delete_case(case_id)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "删除失败")
    return result


@app.get("/api/admin/scenes")
def api_admin_scenes(user: dict = Depends(require_admin)):
    return admin_svc.list_scenes()


@app.post("/api/admin/scenes")
def api_admin_upsert_scene(body: AdminSceneBody, user: dict = Depends(require_admin)):
    result = admin_svc.upsert_scene(body.model_dump())
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "保存失败")
    return result


@app.delete("/api/admin/scenes/{scene_id}")
def api_admin_delete_scene(scene_id: str, user: dict = Depends(require_admin)):
    result = admin_svc.delete_scene(scene_id)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "删除失败")
    return result


@app.get("/api/admin/avatars")
def api_admin_avatars(user: dict = Depends(require_admin)):
    return admin_svc.list_avatars()


@app.post("/api/admin/avatars")
def api_admin_avatars_update(body: AdminAvatarBody, user: dict = Depends(require_admin)):
    result = admin_svc.update_avatar_binding(
        persona_id=body.persona_id,
        visual=body.visual,
        portrait_path=body.portrait_path,
        model_id=body.model_id,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "更新失败")
    return result


@app.post("/api/admin/avatars/upload")
async def api_admin_avatars_upload(
    file: UploadFile = File(...),
    persona_id: str | None = Form(None),
    user: dict = Depends(require_admin),
):
    content = await file.read()
    result = admin_svc.save_portrait_upload(
        filename=file.filename or "portrait.webp",
        content=content,
        persona_id=(persona_id or "").strip() or None,
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "上传失败")
    return result
