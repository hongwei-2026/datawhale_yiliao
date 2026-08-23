#!/usr/bin/env python3
"""本地 / CI 共用质量门禁。失败即非 0 退出。"""

from __future__ import annotations

import json
import os
import py_compile
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILED: list[str] = []

# 高风险密钥形态（宁可误报人工复核，不可漏报）
SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9]{20,}"), "疑似 API Key (sk-...)"),
    (re.compile(r"-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----"), "疑似私钥文件内容"),
    (re.compile(r"(?i)(api[_-]?key|secret|token)\s*=\s*['\"][^'\"]{16,}['\"]"), "疑似硬编码密钥赋值"),
]

FORBIDDEN_PATH_PARTS = {
    ".env",
    ".env.local",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
}

SKIP_DIR_NAMES = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    ".mypy_cache",
    ".ruff_cache",
    "data",  # sqlite 等本地库
}


def fail(msg: str) -> None:
    FAILED.append(msg)
    print(f"[FAIL] {msg}")


def ok(msg: str) -> None:
    print(f"[OK]   {msg}")


def iter_text_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(p in SKIP_DIR_NAMES for p in path.parts):
            continue
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".doc", ".docx", ".db", ".sqlite"}:
            continue
        if path.stat().st_size > 1_500_000:
            fail(f"文件过大（>{1_500_000} bytes）: {path.relative_to(ROOT)}")
            continue
        yield path


def check_forbidden_tracked_names() -> None:
    """禁止仓库中出现敏感文件名（本地已 gitignore 的 .env 不报错）。"""
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8", errors="ignore")
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(p in SKIP_DIR_NAMES for p in path.parts):
            continue
        name = path.name
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        if name == ".env.example":
            continue
        if name == ".env" or name.startswith(".env."):
            # 允许本地存在，但必须被 gitignore；CI 检出不应包含
            if ".env" not in gi:
                fail(".env 存在且未被 gitignore")
            continue
        if name.lower().endswith(".pem") or name in {"credentials.json", "id_rsa", "id_ed25519"}:
            fail(f"禁止提交的敏感文件名: {rel}")
        if rel.startswith("data/") and name.endswith((".db", ".sqlite", ".sqlite3")):
            # 本地可有，CI 不应检出；若被跟踪会在 git 检查中拦
            continue


def check_secrets_in_text() -> None:
    allow_files = {
        "scripts/ci_check.py",
        ".env.example",
    }
    for path in iter_text_files():
        rel = str(path.relative_to(ROOT)).replace("\\", "/")
        if rel in allow_files or path.name.startswith(".env"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for pat, label in SECRET_PATTERNS:
            if pat.search(text):
                fail(f"{label} @ {rel}")


def check_python_syntax() -> None:
    py_files = list((ROOT / "server").rglob("*.py")) + list((ROOT / "scripts").rglob("*.py"))
    for path in py_files:
        try:
            py_compile.compile(str(path), doraise=True)
        except py_compile.PyCompileError as exc:
            fail(f"Python 语法错误: {path.relative_to(ROOT)} -> {exc}")
    ok(f"Python 语法检查通过（{len(py_files)} 个文件）")


def check_json_data() -> None:
    data_dir = ROOT / "web" / "data"
    count = 0
    for path in data_dir.rglob("*.json"):
        count += 1
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"JSON 无效: {path.relative_to(ROOT)} -> {exc}")
    if count == 0:
        fail("未找到 web/data/*.json")
    else:
        ok(f"JSON 校验通过（{count} 个文件）")


def check_required_docs() -> None:
    required = [
        "README.md",
        "CONTRIBUTING.md",
        "项目架构设计文档.md",
        "标准设计文档.md",
        "病例设计文档.md",
        "数据库设计文档.md",
        "评分引擎设计文档.md",
        "AI设计文档.md",
        "server/requirements.txt",
        ".gitignore",
        ".env.example",
    ]
    for name in required:
        if not (ROOT / name).exists():
            fail(f"缺少必要文件: {name}")
    ok("必要文档/配置存在")


def check_gitignore_env() -> None:
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8", errors="ignore")
    if ".env" not in gi:
        fail(".gitignore 必须忽略 .env")
    else:
        ok(".gitignore 已忽略 .env")


def check_imports_smoke() -> None:
    sys.path.insert(0, str(ROOT))
    try:
        from server.app.case_loader import load_case, load_rubric
        from server.app.scoring_engine import rule_pass

        case = load_case()
        rubric = load_rubric()
        assert case["meta"]["case_id"]
        assert rubric["items"]
        msgs = [
            {"turn_index": 0, "role": "trainee", "content": "一定能治好，绝对安全，不签就不给你看病"},
        ]
        enabled = [i for i in rubric["items"] if i.get("enabledMvp")]
        ruled = rule_pass(msgs, enabled)
        assert "IC-X02" in ruled
        ok("核心模块 import + 规则层冒烟通过")
    except Exception as exc:
        fail(f"模块冒烟失败: {exc}")


def main() -> int:
    os.chdir(ROOT)
    print("== CI quality gate ==")
    check_gitignore_env()
    check_required_docs()
    check_forbidden_tracked_names()
    check_secrets_in_text()
    check_python_syntax()
    check_json_data()
    check_imports_smoke()

    if FAILED:
        print(f"\n共 {len(FAILED)} 项失败。请修复后再提交/合并。")
        return 1
    print("\n全部质量门禁通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
