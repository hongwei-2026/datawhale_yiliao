# -*- coding: utf-8 -*-
from pathlib import Path
import zipfile
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

folder = Path(r"D:/datawhale/PRD2.0/队友对评分设计的收集与设计")
out_dir = folder / "_extracted"
out_dir.mkdir(exist_ok=True)


def extract_text(xml: str) -> str:
    # Remove common table/style noise that leaked as raw tags in prior extract
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"</w:tr>", "\n", xml)
    xml = re.sub(r"<w:tab[^/]*/>", "\t", xml)
    texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", xml)
    parts = []
    for t in texts:
        t = (
            t.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&apos;", "'")
        )
        parts.append(t)
    # Join runs; newlines already inserted via </w:p>
    # Rebuild from paragraph-aware approach:
    paras = re.split(r"</w:p>", xml)
    lines = []
    for para in paras:
        runs = re.findall(r"<w:t[^>]*>(.*?)</w:t>", para)
        if not runs:
            continue
        line = "".join(
            r.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            for r in runs
        ).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


for p in sorted(folder.glob("*.docx")):
    print("=" * 60)
    print(p.name)
    try:
        with zipfile.ZipFile(p) as z:
            xml = z.read("word/document.xml").decode("utf-8", errors="ignore")
        text = extract_text(xml)
        out = out_dir / (p.stem + ".txt")
        out.write_text(text, encoding="utf-8")
        print(f"-> {out.name} ({len(text)} chars)")
    except Exception as e:
        print("ERR", repr(e))
