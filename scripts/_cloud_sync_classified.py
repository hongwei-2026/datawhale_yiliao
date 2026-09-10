"""Sync restored classified cases + code to AutoDL."""
from __future__ import annotations

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
    "web/data/cases/CASE-ADM-CUSTOM-777524.json",
    "web/data/cases/CASE-ADM-CUSTOM-1189B9.json",
    "web/data/cases/CASE-ADM-CUSTOM-9FD106.json",
    "data/admin_case_drafts/DRAFT-CCA21A19-A.json",
    "data/admin_case_drafts/DRAFT-D3882D84-8.json",
    "data/admin_case_drafts/DRAFT-42587DB7-E.json",
    "server/app/case_ingest.py",
    "server/app/main.py",
    "server/app/admin_svc.py",
    "server/app/sessions.py",
    "web/js/admin.js",
]


def main() -> int:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=60, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    for rel in FILES:
        local = LOCAL / rel
        if not local.exists():
            print("MISSING", rel)
            continue
        remote = f"{REMOTE}/{rel}"
        # ensure remote dir
        remote_dir = "/".join(remote.split("/")[:-1])
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            # mkdir -p via ssh
            c.exec_command(f"mkdir -p {remote_dir}")
            time.sleep(0.2)
        print("put", rel)
        sftp.put(str(local), remote)
    sftp.close()

    def run(cmd: str) -> None:
        print("$", cmd[:120])
        _, out, err = c.exec_command(cmd, timeout=120)
        print(out.read().decode("utf-8", "replace")[:2000])
        e = err.read().decode("utf-8", "replace")
        if e.strip():
            print("E", e[:800])

    run(f"bash {REMOTE}/stop.sh; sleep 1; bash {REMOTE}/start.sh")
    time.sleep(2)
    run(
        f"cd {REMOTE} && source .venv/bin/activate && python - <<'PY'\n"
        "import json\n"
        "idx=json.load(open('web/data/cases-index.json',encoding='utf-8'))\n"
        "for d in idx['diseases']:\n"
        "  print(d['disease_code'], d['name_zh'], [c['case_id'] for c in d.get('cases') or []])\n"
        "assert not any(x.get('disease_code')=='CUSTOM' for x in idx['diseases'])\n"
        "print('ok')\n"
        "PY"
    )
    run("curl -sS -m 10 http://127.0.0.1:6008/health; echo")
    c.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
