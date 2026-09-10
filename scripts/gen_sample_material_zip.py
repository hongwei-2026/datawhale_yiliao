# -*- coding: utf-8 -*-
"""Generate a sample ZIP for admin「交材料」with valid + junk files.

人物：周明华 · 场景：知情同意（与已导入的王秀英随访区分开）
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "web" / "data" / "samples"
STAGING = OUT_DIR / "_staging_zhouminghua"
OUT_ZIP = OUT_DIR / "sample-material-zhouminghua-icf-with-junk.zip"
# 旧示例（王秀英随访）若还在则删掉，避免混淆
OLD_ZIPS = [
    OUT_DIR / "sample-material-wangxiuying-with-junk.zip",
]


def _write_minimal_docx(path: Path, text: str) -> None:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{text}</w:t></w:r></w:p>
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
    for old in OLD_ZIPS:
        if old.exists():
            old.unlink()
    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)

    (STAGING / "01-病例概要.txt").write_text(
        """【病例概要】
姓名：周明华
性别：男
年龄：48岁
职业：物流仓库主管
场景：知情同意（2型糖尿病 II 期口服新药临床试验 · 首次面谈）
就诊背景：门诊筛查符合入组条件，今天第一次见面谈知情同意；需讲清研究目的、随机/对照、访视负担、风险受益、自愿与退出。
主诉/来访目的：医生说可以参加一个吃药的研究，想搞清楚「是不是白老鼠」「万一分到安慰剂怎么办」。
现病史要点：2型糖尿病 5 年；近半年空腹血糖控制一般；无严重低血糖史。
既往史：高血压 2 年（氨氯地平控制尚可）；否认肾病透析；无药物过敏。
用药：二甲双胍 0.5g bid；氨氯地平 5mg qd。
沟通难点：怕被当试验品、担心分到安慰剂耽误治疗、对「随机」听不懂、时间紧怕频繁跑医院。
""",
        encoding="utf-8",
    )

    (STAGING / "02-知情要点与禁忌.txt").write_text(
        """【知情同意要点】
1. 用白话说明研究目的：比较新药与现有治疗/安慰剂，看控糖是否更好、安全性如何
2. 解释随机与盲法：不是医生挑你吃哪一种，电脑分组；有的组可能是安慰剂或标准治疗
3. 讲清访视：约 12 周、抽血与随访次数、大概要花多少时间
4. 风险与不适：可能的胃肠道反应、低血糖监测；紧急情况怎么联系
5. 权利：自愿参加、随时可退出、退出不影响正常诊疗
6. 确认理解：请对方用自己的话复述关键点；回答「万一分到安慰剂」的担心

【禁忌与边界】
- 不得承诺「一定分到真药」「一定能治好」
- 不得施压催签；对方说要回家商量，应尊重
- 不得编造未写明的疗效数据或报销承诺
- 紧急医学问题引导就医，不替代临床处置
""",
        encoding="utf-8",
    )

    (STAGING / "03-人物性格与示范话术.txt").write_text(
        """【人物性格】
直爽、时间观念强；一听「试验」就警觉；会连珠炮提问；听懂白话后态度会缓和。

【示范开场】
学员：周先生您好，我是研究护士小刘。今天主要把这项糖尿病吃药研究说清楚：为什么做、怎么分组、要来几次、有什么风险、您有哪些权利。您可以随时打断提问，也完全可以今天不签、回去再想。
病人：行，你先说。我就怕你们拿我当小白鼠，还有万一吃到假药怎么办。

【评分关注】
目的与流程、随机/安慰剂解释、风险受益、自愿退出、确认理解、共情与不施压。
""",
        encoding="utf-8",
    )

    _write_minimal_docx(
        STAGING / "04-知情补充说明.docx",
        "【补充说明】解释安慰剂时可用「有的人吃研究药，有的人吃外观一样但不含这味新药的对照，好公平比较」；强调两种情况下原有二甲双胍等基础治疗是否继续，以方案书面说明为准，现场勿口头保证报销比例。",
    )

    # junk / invalid
    (STAGING / "readme.md").write_text(
        "# 随便写的说明\n不要用这个当病例。\n内部备忘，不应进入病例正文。\n",
        encoding="utf-8",
    )
    (STAGING / "desktop.ini").write_text(
        "[.ShellClassInfo]\nIconResource=shell32.dll,4\n",
        encoding="utf-8",
    )
    (STAGING / "Thumbs.db").write_bytes(b"\x00\x01THUMBNAIL_JUNK" + b"\xff" * 120)
    (STAGING / "old-notes.doc").write_bytes(
        b"\xd0\xcf\x11\xe0" + b"OLD_DOC_BINARY_NOT_SUPPORTED" * 8
    )
    (STAGING / "screenshot-微信截图.png").write_bytes(
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 200 + b"FAKE_PNG_BYTES"
    )
    (STAGING / "lab-results.xlsx").write_bytes(
        b"PK\x03\x04FAKE_XLSX_NOT_ALLOWED" + b"\x00" * 80
    )
    (STAGING / "internal-dump.json").write_text(
        '{"debug":true,"secret":"do-not-use","notes":"内部调试导出，不是病例材料"}',
        encoding="utf-8",
    )
    (STAGING / "空白占位.txt").write_text("", encoding="utf-8")

    nested = STAGING / "嵌套垃圾"
    nested.mkdir(exist_ok=True)
    (nested / "cache.tmp").write_bytes(b"tmp-cache-xxxxx")
    (nested / "照片.jpg").write_bytes(b"\xff\xd8\xff\xe0JFIF" + b"\x00" * 100)

    macosx = STAGING / "__MACOSX"
    macosx.mkdir(exist_ok=True)
    (macosx / "._01-病例概要.txt").write_bytes(b"Mac resource fork junk")
    (STAGING / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1" + b"\x00" * 40)

    with zipfile.ZipFile(OUT_ZIP, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in STAGING.rglob("*"):
            if p.is_file():
                zf.write(p, p.relative_to(STAGING).as_posix())

    print("wrote", OUT_ZIP)
    print("size", OUT_ZIP.stat().st_size)
    with zipfile.ZipFile(OUT_ZIP) as zf:
        for n in zf.namelist():
            print(" -", n)

    shutil.rmtree(STAGING)


if __name__ == "__main__":
    main()
