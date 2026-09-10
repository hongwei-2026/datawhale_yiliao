# -*- coding: utf-8 -*-
"""Full QA: admin ingest paths + practice session + admin CRUD. Prints PASS/FAIL report."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "web" / "data" / "samples"
RESULTS: list[dict] = []


def rec(group: str, name: str, ok: bool, detail: str = "", ms: int | None = None):
    RESULTS.append({"group": group, "name": name, "ok": ok, "detail": detail, "ms": ms})
    mark = "PASS" if ok else "FAIL"
    extra = f" ({ms}ms)" if ms is not None else ""
    print(f"[{mark}] {group} · {name}{extra}: {detail}"[:240])


def req(method: str, path: str, *, token: str | None = None, body: dict | None = None, timeout: int = 120):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            ms = int((time.time() - t0) * 1000)
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"_raw": raw[:500]}
            return resp.status, parsed, ms, None
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"_raw": raw[:500]}
        return e.code, parsed, ms, str(e)
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return 0, {}, ms, str(e)


def multipart_upload(token: str, file_path: Path, timeout: int = 120):
    import uuid

    boundary = "----aispqa" + uuid.uuid4().hex
    filename = file_path.name
    file_bytes = file_path.read_bytes()
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
    )
    parts.append(file_bytes)
    parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    }
    r = urllib.request.Request(BASE + "/api/admin/cases/ingest/upload", data=body, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            ms = int((time.time() - t0) * 1000)
            return resp.status, json.loads(raw), ms, None
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"_raw": raw[:500]}
        return e.code, parsed, ms, str(e)
    except Exception as e:
        return 0, {}, int((time.time() - t0) * 1000), str(e)


def main():
    # ---------- health ----------
    code, data, ms, err = req("GET", "/")
    rec("health", "homepage", code == 200, f"status={code}", ms)

    code, data, ms, err = req("GET", "/data/cases-index.json")
    personas = 0
    if code == 200:
        for d in data.get("diseases") or []:
            for c in d.get("cases") or []:
                personas += len(c.get("personas") or [])
    rec("health", "cases-index", code == 200 and personas >= 4, f"personas={personas}", ms)

    # ---------- auth ----------
    code, data, ms, err = req("POST", "/api/auth/login", body={"username": "admin", "password": "Admin2026"})
    admin_token = data.get("token") if code == 200 else None
    rec("auth", "admin login", bool(admin_token), f"user={data.get('user', {}).get('username')}", ms)
    if not admin_token:
        print("ABORT: no admin token")
        return 1

    code, data, ms, err = req("GET", "/api/auth/me", token=admin_token)
    rec("auth", "auth/me", code == 200 and data.get("user", {}).get("role") in ("admin", "instructor"), str(data.get("user", {}).get("role")), ms)

    # trainee for practice
    code, data, ms, err = req("POST", "/api/auth/login", body={"username": "history", "password": "History2026"})
    trainee_token = data.get("token") if code == 200 else None
    if not trainee_token:
        # try common password variants
        for pw in ("history", "History123", "123456", "trainee"):
            code, data, ms, err = req("POST", "/api/auth/login", body={"username": "history", "password": pw})
            if data.get("token"):
                trainee_token = data["token"]
                break
    rec("auth", "trainee login(history)", bool(trainee_token), "ok" if trainee_token else f"err={err or data}", ms)

    # ---------- admin reads ----------
    for path, name, pred in [
        ("/api/admin/stats", "stats", lambda d: d.get("ok") and d.get("cases", 0) >= 1),
        ("/api/admin/cases", "cases list", lambda d: d.get("ok") and len(d.get("cases") or []) >= 1),
        ("/api/admin/scenes", "scenes list", lambda d: d.get("ok")),
        ("/api/admin/users", "users list", lambda d: d.get("ok") and len(d.get("users") or []) >= 1),
        ("/api/admin/avatars", "avatars", lambda d: d.get("ok") or "personas" in d or "gallery" in d),
        ("/api/admin/cases/ingest/scenes", "ingest whitelist", lambda d: len(d.get("scenes") or []) == 2),
        ("/api/admin/cases/ingest/diseases", "ingest diseases", lambda d: len(d.get("diseases") or []) == 2),
        ("/api/admin/cases/ingest/drafts", "ingest drafts", lambda d: d.get("ok")),
        ("/api/cases/default", "cases default", lambda d: bool(d.get("case") or d.get("ok") or d.get("case_id") or d.get("persona"))),
        ("/api/voice/status", "voice status", lambda d: True),
        ("/api/db/verify", "db verify", lambda d: d.get("ok") is not False),
    ]:
        code, data, ms, err = req("GET", path, token=admin_token)
        ok = code == 200 and pred(data)
        rec("admin-read", name, ok, f"status={code} keys={list(data)[:6] if isinstance(data, dict) else type(data)}", ms)

    # ---------- users CRUD (temp) ----------
    uname = f"qa_{int(time.time()) % 100000}"
    code, data, ms, err = req(
        "POST",
        "/api/admin/users",
        token=admin_token,
        body={"username": uname, "password": "QaTest2026", "display_name": "QA临时", "role": "trainee"},
    )
    uid = (data.get("user") or {}).get("id") or data.get("id")
    rec("users", "create trainee", code in (200, 201) and bool(uid), f"id={uid} detail={data.get('detail') or data.get('error')}", ms)
    if uid:
        code, data, ms, err = req("PATCH", f"/api/admin/users/{uid}", token=admin_token, body={"display_name": "QA临时改名", "role": "trainee"})
        rec("users", "patch trainee", code == 200 and data.get("ok") is not False, str(data.get("error") or data.get("detail") or "ok"), ms)
        code, data, ms, err = req("DELETE", f"/api/admin/users/{uid}", token=admin_token)
        rec("users", "delete trainee", code == 200 and data.get("ok") is not False, str(data.get("error") or "ok"), ms)

    # ---------- scenes fallback create/delete ----------
    scene_id = f"qa_temp_scene_{int(time.time()) % 100000}"
    code, data, ms, err = req(
        "POST",
        "/api/admin/scenes",
        token=admin_token,
        body={"id": scene_id, "scene_key": scene_id, "name": "QA临时场景勿用", "title": "QA临时场景勿用", "summary": "测试后删除", "code": "QA"},
    )
    rec("scenes", "create temp scene", code == 200 and data.get("ok") is not False, str(data.get("error") or data.get("detail") or "ok"), ms)
    code, data, ms, err = req("DELETE", f"/api/admin/scenes/{scene_id}", token=admin_token)
    rec("scenes", "delete temp scene", code == 200 and data.get("ok") is not False, str(data.get("error") or "ok"), ms)

    # ---------- INGEST: rough (expand) ----------
    rough_text = (SAMPLES / "sample-rough-liudashan-htn-followup.txt").read_text(encoding="utf-8")
    # shorten slightly but keep enough
    code, data, ms, err = req(
        "POST",
        "/api/admin/cases/ingest/drafts",
        token=admin_token,
        body={
            "mode": "rough",
            "scene_key": "follow_up",
            "disease_code": "HTN",
            "display_name": "QA刘大山勿发",
            "source_text": rough_text,
            "phase": "expand",
        },
        timeout=180,
    )
    rough_id = (data.get("draft") or {}).get("draft_id")
    rough_status = (data.get("draft") or {}).get("status")
    rec(
        "ingest-rough",
        "expand draft",
        code == 200 and data.get("ok") and bool(rough_id),
        f"status={rough_status} id={rough_id} err={data.get('error') or data.get('detail') or err}",
        ms,
    )
    if rough_id:
        # structure
        code, data, ms, err = req(
            "POST",
            f"/api/admin/cases/ingest/drafts/{rough_id}/structure",
            token=admin_token,
            body={},
            timeout=180,
        )
        st = (data.get("draft") or {}).get("status")
        fields = (data.get("draft") or {}).get("fields") or {}
        rec(
            "ingest-rough",
            "structure to cards",
            code == 200 and bool(data.get("ok")) and (
                st in ("review", "expand_review", "structured") or bool(fields.get("display_name"))
            ),
            f"status={st} name={fields.get('display_name')} facts={len(fields.get('locked_facts') or [])} err={data.get('error') or data.get('detail') or err}",
            ms,
        )
        # versions list
        code, data, ms, err = req("GET", f"/api/admin/cases/ingest/drafts/{rough_id}/versions", token=admin_token)
        rec("ingest-rough", "list versions", code == 200, f"n={len(data.get('versions') or [])}", ms)
        # discard
        code, data, ms, err = req("DELETE", f"/api/admin/cases/ingest/drafts/{rough_id}", token=admin_token)
        rec("ingest-rough", "discard draft", code == 200 and data.get("ok") is not False, str(data.get("error") or "ok"), ms)

    # ---------- INGEST: human ----------
    human_text = (SAMPLES / "sample-human-chenmeiling-followup.txt").read_text(encoding="utf-8")
    # Use a unique display name for publish path later; first do discard path with shorter unique name
    code, data, ms, err = req(
        "POST",
        "/api/admin/cases/ingest/drafts",
        token=admin_token,
        body={
            "mode": "human",
            "scene_key": "follow_up",
            "disease_code": "T2DM",
            "display_name": "QA陈美玲勿发",
            "source_text": human_text,
        },
        timeout=180,
    )
    human_id = (data.get("draft") or {}).get("draft_id")
    fields = (data.get("draft") or {}).get("fields") or {}
    rec(
        "ingest-human",
        "create+structure",
        code == 200 and data.get("ok") and bool(human_id),
        f"id={human_id} status={(data.get('draft') or {}).get('status')} disease={fields.get('disease_code')} facts={len(fields.get('locked_facts') or [])} err={data.get('error') or data.get('detail') or err}",
        ms,
    )
    if human_id:
        # patch ack + revise lightly
        code, data, ms, err = req(
            "PATCH",
            f"/api/admin/cases/ingest/drafts/{human_id}",
            token=admin_token,
            body={"display_name": "QA陈美玲勿发", "reviewed_ack": True, "visit_context": "第8周电话随访（QA）"},
        )
        rec("ingest-human", "patch fields", code == 200 and data.get("ok") is not False, str(data.get("error") or data.get("detail") or "ok"), ms)

        code, data, ms, err = req(
            "POST",
            f"/api/admin/cases/ingest/drafts/{human_id}/revise",
            token=admin_token,
            body={"instruction": "开场再口语一点，不要改事实。", "targets": []},
            timeout=180,
        )
        rec(
            "ingest-human",
            "revise with AI",
            code == 200 and data.get("ok"),
            f"err={data.get('error') or data.get('detail') or err} openings={len(((data.get('draft') or {}).get('fields') or {}).get('openings') or [])}",
            ms,
        )
        code, data, ms, err = req("DELETE", f"/api/admin/cases/ingest/drafts/{human_id}", token=admin_token)
        rec("ingest-human", "discard", code == 200, str(data.get("error") or "ok"), ms)

    # ---------- INGEST: material upload ----------
    zip_path = SAMPLES / "sample-material-zhouminghua-icf-with-junk.zip"
    code, data, ms, err = multipart_upload(admin_token, zip_path, timeout=120)
    reports = data.get("file_reports") or data.get("files") or []
    text_out = data.get("text") or data.get("source_text") or ""
    if not text_out and reports:
        # join keep texts
        chunks = []
        for f in reports:
            if f.get("include") or f.get("action") == "keep":
                body_t = (f.get("text") or f.get("preview") or "").strip()
                if body_t:
                    chunks.append(body_t)
        text_out = "\n\n".join(chunks)
    rec(
        "ingest-material",
        "upload+scan zip",
        code == 200 and (bool(reports) or len(text_out) > 20),
        f"reports={len(reports)} text_len={len(text_out)} err={data.get('error') or data.get('detail') or err}",
        ms,
    )
    if len(text_out) >= 20:
        # intake draft without AI
        code, data, ms, err = req(
            "POST",
            "/api/admin/cases/ingest/drafts",
            token=admin_token,
            body={
                "phase": "intake",
                "mode": "material",
                "scene_key": "informed_consent",
                "disease_code": "T2DM",
                "display_name": "QA周明华勿发",
                "source_text": text_out[:8000],
                "source_filename": zip_path.name,
            },
        )
        mat_id = (data.get("draft") or {}).get("draft_id")
        rec("ingest-material", "intake draft", code == 200 and bool(mat_id), f"id={mat_id} status={(data.get('draft') or {}).get('status')}", ms)
        if mat_id:
            code, data, ms, err = req(
                "POST",
                f"/api/admin/cases/ingest/drafts/{mat_id}/structure",
                token=admin_token,
                body={},
                timeout=180,
            )
            fields = (data.get("draft") or {}).get("fields") or {}
            rec(
                "ingest-material",
                "structure cards",
                code == 200 and data.get("ok"),
                f"name={fields.get('display_name')} facts={len(fields.get('locked_facts') or [])} err={data.get('error') or data.get('detail') or err}",
                ms,
            )
            code, data, ms, err = req("DELETE", f"/api/admin/cases/ingest/drafts/{mat_id}", token=admin_token)
            rec("ingest-material", "discard", code == 200, str(data.get("error") or "ok"), ms)

    # ---------- publish + delete (human short) ----------
    pub_text = (
        "姓名：QA自检发布\n性别：男\n年龄：55\n职业：工人\n场景：随访（询问）\n病种：高血压\n"
        "今天来干嘛：第4周随访，核对吃药与血压。\n"
        "必须记住的事实：近7天漏服1次氨氯地平；自己把药加了一片；怕被骂。\n"
        "担心：怕踢出试验。\n开场：大夫，我药基本都吃了。\n禁止：不要建议自行改药。"
    )
    code, data, ms, err = req(
        "POST",
        "/api/admin/cases/ingest/drafts",
        token=admin_token,
        body={
            "mode": "human",
            "scene_key": "follow_up",
            "disease_code": "HTN",
            "display_name": "QA自检发布",
            "source_text": pub_text,
        },
        timeout=180,
    )
    pub_id = (data.get("draft") or {}).get("draft_id")
    rec("ingest-publish", "create for publish", code == 200 and bool(pub_id), f"id={pub_id} err={data.get('error') or data.get('detail') or err}", ms)
    published_case_id = None
    if pub_id:
        req(
            "PATCH",
            f"/api/admin/cases/ingest/drafts/{pub_id}",
            token=admin_token,
            body={"reviewed_ack": True, "display_name": "QA自检发布", "disease_code": "HTN"},
        )
        code, data, ms, err = req("POST", f"/api/admin/cases/ingest/drafts/{pub_id}/publish", token=admin_token, timeout=120)
        published_case_id = data.get("case_id") or (data.get("import") or {}).get("case_id")
        rec(
            "ingest-publish",
            "publish to trainee",
            code == 200 and data.get("ok") and bool(published_case_id),
            f"case_id={published_case_id} msg={data.get('message')} err={data.get('error') or data.get('detail') or err}",
            ms,
        )
        # appear in admin cases
        code, data, ms, err = req("GET", "/api/admin/cases", token=admin_token)
        ids = [c.get("case_id") for c in (data.get("cases") or [])]
        rec("ingest-publish", "listed after publish", published_case_id in ids if published_case_id else False, f"n={len(ids)}", ms)
        if published_case_id:
            code, data, ms, err = req("DELETE", f"/api/admin/cases/{published_case_id}", token=admin_token)
            rec("ingest-publish", "delete published case", code == 200 and data.get("ok") is not False, str(data.get("error") or data.get("detail") or "ok"), ms)
        # draft cleanup if still there
        req("DELETE", f"/api/admin/cases/ingest/drafts/{pub_id}", token=admin_token)

    # ---------- practice session (trainee or admin) ----------
    tok = trainee_token or admin_token
    # resolve default case/persona from index
    code, idx, ms, err = req("GET", "/data/cases-index.json")
    case_id = (idx.get("meta") or {}).get("default_case_id")
    persona_id = (idx.get("meta") or {}).get("default_persona_id")
    code, data, ms, err = req(
        "POST",
        "/api/sessions",
        token=tok,
        body={"case_id": case_id, "session_mode": "practice", "study_mode": "reference"},
    )
    sid = data.get("session_id") or (data.get("session") or {}).get("id") or (data.get("session") or {}).get("session_id")
    rec("practice", "create session", code == 200 and bool(sid), f"sid={sid} case={case_id} err={data.get('detail') or data.get('error') or err}", ms)
    if sid:
        code, data, ms, err = req("GET", f"/api/sessions/{sid}", token=tok)
        rec("practice", "get session", code == 200, f"keys={list(data)[:8]}", ms)

        code, data, ms, err = req(
            "POST",
            f"/api/sessions/{sid}/turns",
            token=tok,
            body={"content": "您好，我是随访护士。今天按约定来问一下您最近吃药和血压的情况，您最近服药规律吗？"},
            timeout=120,
        )
        reply = ""
        if isinstance(data, dict):
            reply = data.get("patient_reply") or data.get("reply") or ""
        rec(
            "practice",
            "send turn",
            code == 200 and bool(data.get("ok")) and bool(reply),
            f"reply_len={len(str(reply))} err={data.get('detail') or data.get('error') or err}",
            ms,
        )

        code, data, ms, err = req("POST", f"/api/sessions/{sid}/complete", token=tok, body={}, timeout=120)
        rec("practice", "complete session", code == 200 and bool(data.get("ok")), f"err={data.get('detail') or data.get('error') or err} keys={list(data)[:8] if isinstance(data, dict) else ''}", ms)

        code, data, ms, err = req("GET", f"/api/sessions/{sid}/feedback", token=tok, timeout=120)
        fb = data.get("feedback") if isinstance(data, dict) else None
        rec(
            "practice",
            "feedback",
            code == 200 and bool(data.get("ok")) and bool(fb),
            f"has_feedback={bool(fb)} err={data.get('detail') or data.get('error') or err}",
            ms,
        )

        code, data, ms, err = req("GET", "/api/sessions/history", token=tok)
        rec("practice", "history", code == 200, f"n={len(data.get('sessions') or data.get('items') or [])}", ms)

    # ---------- summary ----------
    passed = sum(1 for r in RESULTS if r["ok"])
    failed = [r for r in RESULTS if not r["ok"]]
    print("\n==== SUMMARY ====")
    print(f"total={len(RESULTS)} pass={passed} fail={len(failed)}")
    if failed:
        print("FAILED:")
        for r in failed:
            print(f"  - {r['group']} · {r['name']}: {r['detail']}")
    out = ROOT / "scripts" / "_qa_full_report.json"
    out.write_text(json.dumps({"results": RESULTS, "pass": passed, "fail": len(failed)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {out}")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
