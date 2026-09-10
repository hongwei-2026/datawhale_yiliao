"""Restore original gal overlay layout CSS/HTML approach from git HEAD snippets."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
css_path = ROOT / "web" / "css" / "main.css"
js_path = ROOT / "web" / "js" / "app.js"

orig = subprocess.check_output(["git", "show", "HEAD:web/css/main.css"], cwd=ROOT).decode("utf-8")
cur = css_path.read_text(encoding="utf-8")

# --- Original CSS blocks from HEAD ---
gal_start = orig.find("/* ── Galgame")
gal_end = orig.find(".gal-dialog-feed-meta", gal_start)
gal_block = orig[gal_start:gal_end]

live_start = orig.find("/* 练习模式 · 左上受试者状态")
live_end = orig.find(".live-rail-panel", live_start)
live_block = orig[live_start:live_end]

check_start = orig.find("/* 沟通检查点：右侧独立浮层")
check_end = orig.find(".checkpoint-panel", check_start)
check_block = orig[check_start:check_end]

hud_start = orig.rfind(".practice-gal-hud {")
hud_tail = orig[hud_start:]
m = re.search(
    r"\.practice-gal-hud \{[\s\S]*?\.practice-gal-hud \.status-pill \{[\s\S]*?\}\n\n@media \(max-width: 900px\) \{\n  \.practice-gal-vn-layer \{[\s\S]*?\n\}\n",
    hud_tail,
)
if not m:
    raise SystemExit("could not find original hud+media block")
hud_block = m.group(0)

# Replace current gal section (from Galgame comment through our media max-width 900 for gal)
cur_gal_start = cur.find("/* ── Galgame")
if cur_gal_start < 0:
    cur_gal_start = cur.find("body.gal-immersive .topbar")
cur_gal_end = cur.find(".gal-dialog-feed-meta", cur_gal_start)
if cur_gal_start < 0 or cur_gal_end < 0:
    raise SystemExit(f"current gal markers missing {cur_gal_start} {cur_gal_end}")

# Keep practice/feedback page widening (user liked large pages for other modes) —
# only restore immersive chat overlay layout.
new_gal = gal_block  # already ends before .gal-dialog-feed-meta
cur = cur[:cur_gal_start] + new_gal + cur[cur_gal_end:]

# Replace live-rail absolute block if our comment version exists
for old_pat, new_block in [
    (
        re.compile(r"/\* live-rail 布局见上方[\s\S]*?(?=\.live-rail-panel)"),
        live_block,
    ),
    (
        re.compile(r"/\* 练习模式 · 左上受试者状态[\s\S]*?(?=\.live-rail-panel)"),
        live_block,
    ),
]:
    if old_pat.search(cur):
        cur = old_pat.sub(new_block, cur, count=1)
        break

for old_pat, new_block in [
    (
        re.compile(r"/\* 检查点面板外观[\s\S]*?(?=\.checkpoint-panel)"),
        check_block,
    ),
    (
        re.compile(r"/\* 沟通检查点：右侧独立浮层[\s\S]*?(?=\.checkpoint-panel)"),
        check_block,
    ),
]:
    if old_pat.search(cur):
        cur = old_pat.sub(new_block, cur, count=1)
        break

# Ensure end hud block exists (original had it near file end). Remove duplicate flex hud if any leftover.
# If current file lacks trailing hud media, append original hud_block before EOF.
if ".practice-gal-hud {" not in cur[cur.find(".dh-live2d-state.is-error") :]:
    # append before last content
    if not cur.rstrip().endswith("}"):
        pass
    cur = cur.rstrip() + "\n\n" + hud_block + "\n"
else:
    # replace trailing absolute hud if present with original
    tail_pat = re.compile(
        r"\.practice-gal-hud \{[\s\S]*?\.practice-gal-hud \.status-pill \{[\s\S]*?\}\n(?:\n@media \(max-width: 900px\) \{\n  \.practice-gal-vn-layer \{[\s\S]*?\n\}\n)?\Z"
    )
    if tail_pat.search(cur):
        cur = tail_pat.sub(hud_block + "\n", cur)

css_path.write_text(cur, encoding="utf-8")
print("CSS restored overlay gal layout")

# --- Restore JS HTML structure (no practice-gal-body) ---
js = js_path.read_text(encoding="utf-8")

# Fix patchCheckpointRail insert point
js = js.replace(
    """  } else {
    const body = document.querySelector('.practice-gal-body');
    body?.insertAdjacentHTML('beforeend', html);
  }
}""",
    """  } else {
    const mount = $('#digital-human-mount');
    mount?.insertAdjacentHTML('afterend', html);
  }
}""",
)

# Replace the gal session HTML body structure if practice-gal-body present
if "practice-gal-body" in js:
    old = """            <div class="practice-gal-body">
              ${active && engagement === 'practice' ? buildLiveFeedbackRailHtml(p.messages, p.patientAffect, { busy: p.busy }) : ''}
              <div class="practice-gal-center">
                <div class="practice-gal-stage-mount" id="digital-human-mount" aria-label="受试者形象"></div>
              </div>
              ${active && p.checkpointOpen && engagement === 'practice' ? `
                <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
                  ${buildCheckpointPanelHtml(p.messages, { engagement })}
                </aside>
              ` : ''}
            </div>

            <div class="practice-gal-vn-layer">"""
    new = """            <div class="practice-gal-stage-mount" id="digital-human-mount" aria-label="受试者形象"></div>

            ${active && engagement === 'practice' ? buildLiveFeedbackRailHtml(p.messages, p.patientAffect, { busy: p.busy }) : ''}

            ${active && p.checkpointOpen && engagement === 'practice' ? `
              <aside class="practice-checkpoint-rail" id="practice-checkpoint-drawer" aria-label="沟通检查点">
                ${buildCheckpointPanelHtml(p.messages, { engagement })}
              </aside>
            ` : ''}

            <div class="practice-gal-vn-layer">"""
    if old not in js:
        raise SystemExit("JS practice-gal-body block not found for replace")
    js = js.replace(old, new)
    # also remove has-live-rail / is-assessment class extras? keep them, harmless
    js_path.write_text(js, encoding="utf-8")
    print("JS structure restored")
else:
    print("JS already without practice-gal-body")

print("done")
