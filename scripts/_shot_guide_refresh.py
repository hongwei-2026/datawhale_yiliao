from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("web/static/guide")
STATIC = Path("server/app/static/guide")
BASE = "http://127.0.0.1:8000"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=1.25,
        ).new_page()
        page.goto(f"{BASE}/#auth", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.fill("#auth-username", "admin")
        page.fill("#auth-password", "Admin2026")
        page.click("#auth-form button[type='submit']")
        page.wait_for_timeout(1500)

        page.goto(f"{BASE}/#practice", wait_until="networkidle")
        page.wait_for_timeout(1000)
        if page.locator("#practice-open-picker").count():
            page.locator("#practice-open-picker").first.click()
            page.wait_for_timeout(600)
        page.locator(".practice-persona-card", has_text="王阿姨").first.click()
        page.wait_for_timeout(1800)

        info = page.evaluate(
            """() => {
              const img = document.querySelector('.persona-dossier-avatar img');
              if (!img) return { missing: true };
              const fb = document.querySelector('.persona-dossier-avatar-fallback');
              return {
                src: img.currentSrc || img.src,
                complete: img.complete,
                naturalWidth: img.naturalWidth,
                hidden: img.hidden,
                fallbackHidden: fb ? fb.hidden : null,
              };
            }"""
        )
        print("avatar", info)

        briefing = page.locator(".practice-briefing")
        if briefing.count():
            briefing.first.scroll_into_view_if_needed()
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / "page-practice-dossier.png"), full_page=False)

        page.goto(f"{BASE}/#guide", wait_until="networkidle")
        page.wait_for_timeout(1800)
        page.screenshot(path=str(OUT / "page-guide.png"), full_page=True)
        browser.close()

    STATIC.mkdir(parents=True, exist_ok=True)
    for name in ("page-practice-dossier.png", "page-guide.png"):
        src = OUT / name
        if src.exists():
            (STATIC / name).write_bytes(src.read_bytes())
            print("copied", name, src.stat().st_size)


if __name__ == "__main__":
    main()
