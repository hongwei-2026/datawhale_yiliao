"""Capture real UI screenshots for the user manual."""
from __future__ import annotations

import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "static" / "guide"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:8000"
USER = "admin"
PASS = "Admin2026"


def settle(page, ms=800):
    page.wait_for_timeout(ms)


def shot(page, name: str, full_page=False):
    path = OUT / name
    page.screenshot(path=str(path), full_page=full_page)
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def login(page):
    page.goto(f"{BASE}/#auth", wait_until="networkidle")
    settle(page, 1200)
    page.fill("#auth-username", USER)
    page.fill("#auth-password", PASS)
    page.click("#auth-form button[type='submit']")
    settle(page, 2000)
    print("after login url:", page.url)


def pick_wang(page):
    page.goto(f"{BASE}/#practice", wait_until="networkidle")
    settle(page, 1200)
    # open picker if needed
    open_btn = page.locator("#practice-open-picker")
    if open_btn.count():
        open_btn.first.click()
        settle(page, 800)
    # click 王阿姨 card
    card = page.locator(".practice-persona-card", has_text="王阿姨")
    if card.count():
        card.first.click()
        settle(page, 1200)
    else:
        # try any trainable
        page.locator(".practice-persona-card:not(.is-pending)").first.click()
        settle(page, 1200)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1.25)
        page = context.new_page()

        login(page)

        # 1) 模拟对话 · 开练档案页
        pick_wang(page)
        page.evaluate("window.scrollTo(0, 0)")
        settle(page, 500)
        shot(page, "page-practice-briefing.png", full_page=True)

        # scroll to briefing area if present
        briefing = page.locator(".practice-briefing")
        if briefing.count():
            briefing.first.scroll_into_view_if_needed()
            settle(page, 400)
            shot(page, "page-practice-dossier.png", full_page=False)

        # 2) 开始练习 → 对话中界面
        start = page.locator("#practice-start")
        if start.count() and start.first.is_enabled():
            start.first.click()
            settle(page, 3500)
            # wait for gal wrap
            page.wait_for_selector(".practice-gal-wrap, .gal-dialog-glass", timeout=15000)
            settle(page, 2000)
            shot(page, "page-practice-chat.png", full_page=False)
        else:
            print("start button missing/disabled; skip chat shot")

        # 3) 病例详情
        page.goto(f"{BASE}/#cases", wait_until="networkidle")
        settle(page, 1500)
        shot(page, "page-cases.png", full_page=True)

        # 4) 对话记录
        page.goto(f"{BASE}/#records", wait_until="networkidle")
        settle(page, 1500)
        shot(page, "page-records.png", full_page=True)

        # 5) 练习反馈
        page.goto(f"{BASE}/#feedback", wait_until="networkidle")
        settle(page, 1500)
        shot(page, "page-feedback.png", full_page=True)

        # 6) 使用手册当前页（可选对照）
        page.goto(f"{BASE}/#guide", wait_until="networkidle")
        settle(page, 1200)
        shot(page, "page-guide-before.png", full_page=True)

        browser.close()


if __name__ == "__main__":
    main()
