"""Optional real-browser checks. Serve the plugin root over localhost first."""

import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def snapshot(page):
    return page.evaluate("window.miaoPlayground.snapshot()")


def ring_point(page, ring_id=0):
    page.locator("#pool").scroll_into_view_if_needed()
    ring = next(ring for ring in snapshot(page)["rings"] if ring["id"] == ring_id)
    bounds = page.locator("#pool").bounding_box()
    return (
        bounds["x"] + ring["x"] / 960 * bounds["width"],
        bounds["y"] + ring["y"] / 600 * bounds["height"],
        bounds["width"] / 960,
    )


def aim(page, ring_id=0, pull_x=180, pull_y=0):
    x, y, scale = ring_point(page, ring_id)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x - pull_x * scale, y - pull_y * scale, steps=8)


def launch(page, ring_id=0, pull_x=180, pull_y=0):
    aim(page, ring_id, pull_x, pull_y)
    page.mouse.up()
    page.wait_for_function("window.miaoPlayground.snapshot().moving", timeout=3000)


def set_slider(page, selector, value):
    page.locator(selector).evaluate(
        "(element, value) => { element.value = value; element.dispatchEvent(new Event('input', {bubbles: true})); }",
        value,
    )


def run(url):
    artifacts = ROOT / "tests" / "artifacts"
    artifacts.mkdir(exist_ok=True)
    checks = []
    errors = []
    external = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={"width": 1360, "height": 960}, device_scale_factor=1)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: external.append(request.url) if not request.url.startswith(url.split('/static')[0]) else None)
            page.goto(url + "?locale=zh-CN")
            page.wait_for_load_state("networkidle")
            page.wait_for_function("Boolean(window.miaoPlayground)")
            assert page.locator("h1").inner_text() == "喵喵碰碰大作战"
            assert len(snapshot(page)["rings"]) == 3
            assert snapshot(page)["art"]["loaded"]
            assert snapshot(page)["art"]["frameCount"] == 3
            pool_bounds = page.locator("#pool").bounding_box()
            controls_bounds = page.locator(".controls").bounding_box()
            assert pool_bounds["width"] >= 1360 * 0.95
            assert controls_bounds["y"] >= pool_bounds["y"] + pool_bounds["height"]
            assert snapshot(page)["art"]["collisionRadius"] == 40
            page.screenshot(path=str(artifacts / "desktop-idle.png"), full_page=True)
            checks.append("desktop load, full-width pool, controls below, matching enlarged collision radius")

            original = snapshot(page)["rings"]
            page.click('[data-pose="1"]')
            assert snapshot(page)["art"]["previewFrame"] == 1
            assert snapshot(page)["rings"] == original
            page.locator("#character-preview").screenshot(path=str(artifacts / "juzi-impact-preview.png"))
            page.click('[data-pose="2"]')
            page.locator("#character-preview").screenshot(path=str(artifacts / "juzi-rebound-preview.png"))
            page.click('[data-pose="0"]')
            other_x, other_y, _ = ring_point(page, 1)
            page.mouse.click(other_x, other_y)
            x, y, scale = ring_point(page)
            page.mouse.click(x, y - 65 * scale)
            assert snapshot(page)["selected"] == 0 and not snapshot(page)["moving"]
            checks.append("three sprite frames, independent expression preview and visible head selection")

            x, y, _ = ring_point(page, 1)
            page.mouse.click(x, y)
            assert snapshot(page)["selected"] == 1
            assert not snapshot(page)["moving"]
            aim(page, 1)
            assert snapshot(page)["aiming"]
            page.keyboard.press("Escape")
            page.mouse.up()
            assert not snapshot(page)["moving"] and not snapshot(page)["aiming"]
            aim(page)
            page.mouse.down(button="right")
            page.mouse.up(button="right")
            page.mouse.up()
            assert not snapshot(page)["moving"]
            aim(page)
            page.locator("#pool").dispatch_event("pointercancel", {"pointerId": 1})
            page.mouse.up()
            assert not snapshot(page)["moving"]
            checks.append("click selection, Escape, context-menu and pointer-cancel")

            page.select_option("#layout", "duel")
            launch(page)
            page.wait_for_function("window.miaoPlayground.snapshot().art.activeFrame === 1", polling="raf")
            assert set(snapshot(page)["art"]["reactingIds"]) == {0, 1}
            page.wait_for_function("window.miaoPlayground.snapshot().art.activeFrame === 2", polling="raf")
            page.click("#reset")
            assert snapshot(page)["art"]["activeFrame"] == 0
            checks.append("collision drives impact/rebound on both floats; reset clears reactions")

            page.select_option("#layout", "chain")
            launch(page)
            assert page.locator("#drag").is_disabled()
            assert not page.locator("#reset").is_disabled()
            page.wait_for_timeout(350)
            page.screenshot(path=str(artifacts / "desktop-shot.png"), full_page=True)
            page.wait_for_function("!window.miaoPlayground.snapshot().moving", timeout=15000)
            state = snapshot(page)
            assert state["collisions"] >= 3 and not state["fault"]
            assert 4 <= state["elapsed"] <= 7
            checks.append({"chain shot": {"seconds": round(state["elapsed"], 3), "impacts": state["collisions"]}})

            launch(page, pull_x=-160, pull_y=30)
            page.click("#reset")
            before = snapshot(page)
            page.wait_for_timeout(180)
            after = snapshot(page)
            assert before["rings"] == after["rings"]
            assert not after["moving"] and after["elapsed"] == 0 and after["collisions"] == 0
            checks.append("reset during motion removes old shot")

            page.locator("#tuning summary").click()
            page.check("#show-hitboxes")
            assert snapshot(page)["art"]["showBoundaries"]
            page.screenshot(path=str(artifacts / "collision-outlines.png"), full_page=True)
            page.uncheck("#show-hitboxes")
            set_slider(page, "#drag", "1.2")
            set_slider(page, "#mass", "2.5")
            assert snapshot(page)["params"]["drag"] == 1.2
            assert snapshot(page)["rings"][0]["mass"] == 2.5
            page.click("#defaults")
            assert snapshot(page)["params"]["drag"] == 0.8
            assert all(ring["mass"] == 1 for ring in snapshot(page)["rings"])
            for locale in ["en", "ja", "ko", "ru", "es", "pt", "zh-TW", "zh-CN"]:
                page.select_option("#language", locale)
                page.wait_for_function("locale => document.documentElement.lang === locale", arg=locale)
                assert not page.locator("#language").is_disabled()
            checks.append("tuning, default restore, all eight locales")

            page.select_option("#layout", "wall")
            launch(page)
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'))")
            paused = snapshot(page)
            page.wait_for_timeout(220)
            assert snapshot(page)["elapsed"] == paused["elapsed"]
            assert not snapshot(page)["aiming"]
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'))")
            page.wait_for_timeout(160)
            assert snapshot(page)["elapsed"] > paused["elapsed"]
            page.click("#reset")
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}))")
            assert snapshot(page)["suspended"]
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}))")
            assert not snapshot(page)["suspended"]
            checks.append("visibility pause/resume and back-forward-cache lifecycle")

            page.set_viewport_size({"width": 520, "height": 900})
            launch(page, pull_x=120, pull_y=30)
            page.click("#reset")
            assert not snapshot(page)["moving"]
            page.screenshot(path=str(artifacts / "compact-idle.png"), full_page=True)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            checks.append("resize, scaled pointer coordinates, no horizontal overflow")

            mobile_context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
            mobile = mobile_context.new_page()
            mobile.on("pageerror", lambda error: errors.append(str(error)))
            mobile.goto(url + "?locale=zh-CN")
            mobile.wait_for_function("Boolean(window.miaoPlayground)")
            x, y, scale = ring_point(mobile)
            client = mobile_context.new_cdp_session(mobile)
            client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            client.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x - 130 * scale, "y": y}]})
            client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            mobile.wait_for_function("window.miaoPlayground.snapshot().moving")
            mobile.click("#reset")
            mobile.screenshot(path=str(artifacts / "mobile-idle.png"), full_page=True)
            assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
            checks.append("real touch drag at phone viewport")
            mobile_context.close()

            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: false}))")
            assert snapshot(page)["destroyed"]
            page.wait_for_timeout(100)
            assert not errors, errors
            assert not external, external
            checks.append("page cleanup, no browser errors, no external requests")
            fallback = context.new_page()
            fallback.route("**/assets/juzi-expressions.png", lambda route: route.abort())
            fallback.goto(url + "?locale=zh-CN")
            fallback.wait_for_function("Boolean(window.miaoPlayground)")
            assert not snapshot(fallback)["art"]["loaded"]
            launch(fallback)
            fallback.click("#reset")
            fallback.close()
            checks.append("sprite-load failure preserves placeholder play")
            context.close()
        finally:
            browser.close()
    report = {"checks": checks, "errors": errors, "external_requests": external}
    (artifacts / "browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="Existing preview URL; omit to use a temporary localhost server")
    args = parser.parse_args()
    if args.url:
        run(args.url)
    else:
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(f"http://127.0.0.1:{server.server_port}/static/index.html")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
