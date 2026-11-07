"""Real physics contacts in the production page; fixtures exist only in test responses."""

import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser_checks import enable_dev_controls, launch, restart_pool, select_setting, snapshot
from playwright.sync_api import sync_playwright
from scoring_browser_checks import tick

ROOT = Path(__file__).resolve().parents[1]
CLOCK = """(() => {
    const frames = new Map(); let id = 0, time = 1;
    window.requestAnimationFrame = fn => {frames.set(++id, fn); return id;};
    window.cancelAnimationFrame = id => frames.delete(id);
    window.testStep = ms => {
        time += ms; const pending = [...frames.values()]; frames.clear();
        pending.forEach(fn => fn(time));
    };
})();"""


def run(url):
    artifacts = ROOT / "tests/artifacts/ordinary-contact-1"
    artifacts.mkdir(parents=True, exist_ok=True)
    battle = (ROOT / "static/battle.js").read_text(encoding="utf-8")
    battle = battle.replace("this.reset();", "this.reset(); window.testMatch = this;", 1)
    errors, checks = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            context = browser.new_context(viewport={"width": 1600, "height": 900})
            enable_dev_controls(context)
            context.add_init_script(CLOCK)
            context.route("**/battle.js*", lambda route: route.fulfill(body=battle, content_type="text/javascript"))

            def open_page(extra=""):
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url + "?locale=zh-CN&motion=full" + extra)
                page.wait_for_function("Boolean(window.miaoPlayground)", polling=25)
                tick(page, milliseconds=0)
                return page

            def until_contact(page, wall=False):
                for _ in range(1000):
                    tick(page, milliseconds=1000 / 240)
                    contacts = snapshot(page)["ordinaryContacts"]
                    if any(contact["wall"] == wall for contact in contacts):
                        return next(contact for contact in contacts if contact["wall"] == wall)
                raise AssertionError("No actual physics contact arrived")

            page = open_page("&knockout=unseat-inertia&camera=release&contact=accent&flight=aligned&costume=swim-v2&feedback=impact&pace=impact-read")
            # Unmodified opening positions and an actual pointer drag.
            launch(page, 0, 180, 0)
            strong = until_contact(page)
            assert strong["speed"] > 500 and len(strong["ringIds"]) == 2
            tick(page, 4, milliseconds=1000 / 240)
            state = snapshot(page)
            assert state["battle"]["actors"][3]["hp"] == 96
            assert state["battle"]["scores"] == [0, 0]
            assert state["motion"]["cameraAge"] is None and not state["motion"]["impactBeat"]
            assert state["ordinaryContacts"][0]["pose"]["along"] < 0.9
            assert state["ordinaryContacts"][0]["drops"]
            assert state["waterWake"]["marks"]
            assert all(mark["id"] in [0, 3] for mark in state["waterWake"]["marks"])
            frozen_wake = state["waterWake"]
            page.screenshot(path=str(artifacts / "battle-strong-contact.png"))
            before = state["ordinaryContacts"]
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, 5)
            assert snapshot(page)["ordinaryContacts"] == before
            assert snapshot(page)["waterWake"] == frozen_wake
            page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, milliseconds=0)
            # Stop bodies only in this fixture; the original marks must fade, not vanish.
            page.locator("#tuning-dialog").evaluate("e => e.showModal()")
            page.evaluate("testMatch.world._stop()")
            tick(page, milliseconds=1000 / 60)
            assert snapshot(page)["waterWake"]["marks"]
            tick(page, 40, milliseconds=1000 / 60)
            assert not snapshot(page)["waterWake"]["marks"]
            restart_pool(page, programmatic=True)
            assert not snapshot(page)["ordinaryContacts"]
            assert not snapshot(page)["waterWake"]["marks"]
            checks.append("natural battle drag: speed-based wake, strong hit, 24 damage, no KO camera; pause freezes water and stopping lets it fade")
            page.close()

            page = open_page()
            page.evaluate("Matter.Body.setPosition(testMatch.world.rings.find(r => r.id === 3).body, {x:351,y:200})")
            launch(page, 0, 9, 0)
            weak = until_contact(page)
            tick(page, 4, milliseconds=1000 / 240)
            state = snapshot(page)
            assert 0 < weak["speed"] < 65
            assert weak["strength"] < strong["strength"]
            assert state["collisions"] == 0
            assert state["battle"]["actors"][3]["hp"] == 96
            assert 0.9 < state["ordinaryContacts"][0]["pose"]["along"] < 1
            page.screenshot(path=str(artifacts / "battle-gentle-contact.png"))
            tick(page, 80, milliseconds=1000 / 240)
            assert not snapshot(page)["ordinaryContacts"][0]["drops"]
            page.evaluate("""() => {
                const e = document.querySelector('#motion-mode'); e.value='reduce';
                e.dispatchEvent(new Event('change', {bubbles:true}));
            }""")
            assert not snapshot(page)["ordinaryContacts"]
            assert not snapshot(page)["waterWake"]["marks"]
            checks.append("actual gentle contact under old visual threshold still deals normal damage with smaller presentation; reduced-motion switch clears it")
            page.close()

            page = open_page()
            page.evaluate("Matter.Body.setPosition(testMatch.world.rings.find(r => r.id === 3).body, {x:270,y:360})")
            launch(page, 0, 0, 120)
            until_contact(page)
            tick(page, 5, milliseconds=1000 / 240)
            assert snapshot(page)["battle"]["actors"][3]["hp"] == 96
            assert abs(snapshot(page)["ordinaryContacts"][0]["axis"]["y"]) > 0.97
            page.screenshot(path=str(artifacts / "battle-vertical-contact.png"))
            checks.append("vertical ring contact follows its actual normal, with water layered between cats")
            page.close()

            page = open_page("&mode=practice")
            select_setting(page, "#layout", "wall")
            launch(page, 0, 180, 0)
            wall = until_contact(page, wall=True)
            assert wall["axis"]["x"] < -0.97
            tick(page, 8, milliseconds=1000 / 240)
            state = snapshot(page)
            assert any(contact["drops"] for contact in state["ordinaryContacts"])
            assert any(mark["dx"] > 0.9 for mark in state["waterWake"]["marks"])
            assert any(mark["dx"] < -0.9 for mark in state["waterWake"]["marks"])
            page.screenshot(path=str(artifacts / "practice-wall-contact.png"))
            select_setting(page, "#layout", "free")
            assert not snapshot(page)["ordinaryContacts"]
            assert not snapshot(page)["waterWake"]["marks"]
            checks.append("actual wall collision sprays inward; old wake points right and new wake points left; practice reset clears both")
            page.close()

            page = open_page()
            page.locator("#test-one-hit").evaluate("e => {e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}")
            launch(page, 0, 180, 0)
            for _ in range(300):
                tick(page, milliseconds=1000 / 240)
                if snapshot(page)["flights"]:
                    break
            state = snapshot(page)
            assert state["flights"] and state["battle"]["scores"] == [1, 0]
            assert all(mark["id"] != 3 for mark in state["waterWake"]["marks"])
            assert not any(set(contact["ringIds"]) == {0, 3} for contact in state["ordinaryContacts"])
            checks.append("lethal contacts keep the separate approved knockout effect without ordinary-splash duplication")
            page.close()

            context.close()
            context = browser.new_context(viewport={"width": 1366, "height": 768}, reduced_motion="reduce")
            enable_dev_controls(context)
            context.add_init_script(CLOCK)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + "?locale=zh-CN&mode=practice")
            page.wait_for_function("Boolean(window.miaoPlayground)", polling=25)
            tick(page, milliseconds=0)
            select_setting(page, "#layout", "duel")
            launch(page, 0, 180, 0)
            until_contact(page)
            tick(page, 5, milliseconds=1000 / 240)
            for contact in snapshot(page)["ordinaryContacts"]:
                assert not contact["drops"] and contact["pose"]["along"] == 1
            assert not snapshot(page)["waterWake"]["marks"]
            checks.append("system reduced motion uses a brief contact ripple with no squeeze, spray or moving wake")
            context.close()
            assert not errors, errors
        finally:
            browser.close()
    report = {"checks": checks, "errors": errors}
    (artifacts / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        run(f"http://127.0.0.1:{server.server_port}/static/index.html")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
