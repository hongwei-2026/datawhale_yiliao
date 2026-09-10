# -*- coding: utf-8 -*-
"""Generate ZIP for admin「手头有 Word/PDF」· 周阿姨 · 家属协同 × COPD.

与「纯人写」样例刻意不同：本包是碎片化访视笔记 + 家属提问条 + 垃圾文件，
不是同一篇结构化全文。
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "web" / "data" / "samples"
STAGING = OUT_DIR / "_staging_zhouayi_family"
OUT_ZIP = OUT_DIR / "sample-material-zhouayi-family-copd-with-junk.zip"


def _write_minimal_docx(path: Path, text: str) -> None:
    safe = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{safe}</w:t></w:r></w:p>
  </w:body>
</w:document>"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    with zipfile.ZipFile(path, "w") as dz:
        dz.writestr("[Content_Types].xml", content_types)
        dz.writestr("_rels/.rels", rels)
        dz.writestr("word/document.xml", document_xml)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)

    # —— 可保留正文（碎片材料，刻意不像「纯人写」那篇完整结构）——
    (STAGING / "01-门诊便签-周阿姨.txt").write_text(
        """【门诊便签 · 手写转录】
周阿姨 女 58 退休 带孙子
COPD 吸入试验 第6周
今天女儿陪着来（女儿约三十出头，老师）
本人：客气 爱笑 说药「差不多都吸」
女儿插话多：问伤不伤肺、能不能少跑医院
研究者任务：两边都要安抚 + 把安排说清楚 + 追问真实吸药情况
""",
        encoding="utf-8",
    )

    (STAGING / "02-家属提问纸条.txt").write_text(
        """【家属随手写的问题】
1. 这个吸入药会不会把肺吸坏？
2. 她最近咳痰多，是不是试验药副作用？
3. 我们住得远，能不能改电话随访？
4. 那些知情文件字太多，能不能讲人话？
5. 如果中途不想做了，补助还算不算？（研究者勿乱承诺）
""",
        encoding="utf-8",
    )

    (STAGING / "03-吸药与买药备忘.txt").write_text(
        """【研究护士备忘 · 待核实】
- 日记本翻了：有两天字迹像后来补的
- 本人承认「忙起来会忘」，具体次数含糊（先写：近两周至少漏了两次以上）
- 包里有止咳糖浆空瓶 + 药店小票（非试验发放）
- 气短：家属说比上月重，本人说「还行」
- 无急诊/住院记录（材料里没写就别编）
""",
        encoding="utf-8",
    )

    _write_minimal_docx(
        STAGING / "04-沟通提醒.docx",
        "【带教提醒】家属在场时先点名双方都能听；解释风险用短句；追问漏吸时先说明「不是责怪」。勿只顾跟女儿辩论而冷落受试者。",
    )

    # —— 垃圾 / 应刷掉 ——
    (STAGING / "readme.md").write_text(
        "# 内部说明\n此 ZIP 仅供管理端「交材料」扫描演示，不是纯人写全文。\n",
        encoding="utf-8",
    )
    (STAGING / "desktop.ini").write_text("[.ShellClassInfo]\nIconResource=shell32.dll,4\n", encoding="utf-8")
    (STAGING / "Thumbs.db").write_bytes(b"\x00\x01THUMBNAIL_JUNK" + b"\xff" * 120)
    (STAGING / "old-scan.doc").write_bytes(b"\xd0\xcf\x11\xe0" + b"OLD_DOC_BINARY" * 10)
    (STAGING / "微信截图-候诊.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 180 + b"FAKE_PNG")
    (STAGING / "化验单.xlsx").write_bytes(b"PK\x03\x04FAKE_XLSX" + b"\x00" * 60)
    (STAGING / "debug-export.json").write_text(
        '{"note":"内部导出","do_not_use":true}',
        encoding="utf-8",
    )
    (STAGING / "空白.txt").write_text("", encoding="utf-8")

    nested = STAGING / "杂项"
    nested.mkdir(exist_ok=True)
    (nested / "cache.tmp").write_bytes(b"tmp-xxxx")
    (nested / "合影.jpg").write_bytes(b"\xff\xd8\xff\xe0JFIF" + b"\x00" * 80)

    macosx = STAGING / "__MACOSX"
    macosx.mkdir(exist_ok=True)
    (macosx / "._01-门诊便签-周阿姨.txt").write_bytes(b"Mac resource fork")
    (STAGING / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1" + b"\x00" * 32)

    with zipfile.ZipFile(OUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fp in STAGING.rglob("*"):
            if fp.is_file():
                zf.write(fp, fp.relative_to(STAGING).as_posix())

    print("wrote", OUT_ZIP)
    print("size", OUT_ZIP.stat().st_size)
    with zipfile.ZipFile(OUT_ZIP) as zf:
        for n in sorted(zf.namelist()):
            print(" -", n)
    shutil.rmtree(STAGING)


if __name__ == "__main__":
    main()
