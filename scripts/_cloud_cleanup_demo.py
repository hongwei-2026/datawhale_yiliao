"""Clear practice history + sync cleaned cases to AutoDL, restart service."""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

import paramiko

HOST = "connect.westc.seetacloud.com"
PORT = 46150
USER = "root"
PASSWORD = "kBzO16USFxOk"
REMOTE = "/root/autodl-tmp/aisp-datawhale"
LOCAL = Path(__file__).resolve().parents[1]

FILES = [
    "web/data/cases-index.json",
    "server/app/case_ingest.py",
    "server/app/sessions.py",
    "server/app/admin_svc.py",
]


def clear_local_sessions() -> None:
    db = LOCAL / "data" / "sp_training.db"
    if not db.exists():
        print("local db missing, skip")
        return
    conn = sqlite3.connect(db)
    for t in (
        "feedback_report",
        "score_result",
        "session_message",
        "ai_generation_log",
        "ai_agent_run",
        "training_session",
    ):
        try:
            conn.execute(f"DELETE FROM {t}")
        except Exception as e:
            print("skip", t, e)
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM training_session").fetchone()[0]
    conn.close()
    print("local sessions cleared, remaining", n)


def ssh() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        port=PORT,
        username=USER,
        password=PASSWORD,
        timeout=60,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 120) -> str:
    print("$", cmd[:160])
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip()[:3000])
    if err.strip():
        print("STDERR", err.rstrip()[:1500])
    print("=>", code)
    return out


def main() -> int:
    clear_local_sessions()
    c = ssh()
    try:
        sftp = c.open_sftp()
        for rel in FILES:
            local = LOCAL / rel
            remote = f"{REMOTE}/{rel}"
            print("put", rel)
            sftp.put(str(local), remote)
        # wipe custom case files + portraits on remote
        run(
            c,
            f"rm -f {REMOTE}/web/data/cases/CASE-ADM-CUSTOM-*.json "
            f"{REMOTE}/web/live2d/portraits/PER-ADM-*.webp "
            f"{REMOTE}/server/app/static/live2d/portraits/PER-ADM-*.webp "
            f"2>/dev/null; ls {REMOTE}/web/data/cases | head",
        )
        # clear sessions on remote DB
        run(
            c,
            f"cd {REMOTE} && source .venv/bin/activate && python - <<'PY'\n"
            "import sqlite3\n"
            "from pathlib import Path\n"
            "p=Path('data/sp_training.db')\n"
            "print('db', p.exists(), p.stat().st_size if p.exists() else 0)\n"
            "if p.exists():\n"
            "  conn=sqlite3.connect(p)\n"
            "  for t in ['feedback_report','score_result','session_message','ai_generation_log','ai_agent_run','training_session']:\n"
            "    try: conn.execute(f'DELETE FROM {t}'); print('cleared', t)\n"
            "    except Exception as e: print('skip', t, e)\n"
            "  conn.commit()\n"
            "  print('sessions left', conn.execute('SELECT COUNT(*) FROM training_session').fetchone()[0])\n"
            "  conn.close()\n"
            "PY",
        )
        # verify index has no CUSTOM
        run(
            c,
            f"python - <<'PY'\n"
            "import json\n"
            f"idx=json.load(open('{REMOTE}/web/data/cases-index.json',encoding='utf-8'))\n"
            "codes=[d.get('disease_code') for d in idx.get('diseases',[])]\n"
            "print('diseases', codes)\n"
            "print('flat', [c.get('case_id') for c in idx.get('cases',[])])\n"
            "assert 'CUSTOM' not in codes\n"
            "print('ok')\n"
            "PY",
        )
        run(c, f"bash {REMOTE}/stop.sh; sleep 1; bash {REMOTE}/start.sh")
        time.sleep(2)
        run(c, "curl -sS -m 10 http://127.0.0.1:6008/health; echo")
        run(
            c,
            "curl -sS -m 10 http://127.0.0.1:6008/api/cases 2>/dev/null | python -c "
            "\"import sys,json; d=json.load(sys.stdin); print(json.dumps(d,ensure_ascii=False)[:1200])\" "
            "|| curl -sS -m 10 http://127.0.0.1:6008/api/admin/cases | head -c 800",
        )
        sftp.close()
    finally:
        c.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
