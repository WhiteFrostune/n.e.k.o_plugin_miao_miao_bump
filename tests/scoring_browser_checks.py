"""Deterministic animation/lifecycle cases alongside the real full-match browser test."""

import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser_checks import aim, assert_viewport_fit, enable_dev_controls, launch, restart_pool, select_setting, snapshot
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def tick(page, count=1, milliseconds=100):
    page.evaluate("([n, ms]) => { for (let i = 0; i < n; i++) testStep(ms); }", [count, milliseconds])


def finish_flights(page):
    for _ in range(30):
        if not snapshot(page)["flights"]:
            return
        tick(page)
    raise AssertionError("Flights failed to finish within the presentation budget")


def assert_hud(page):
    state = snapshot(page)
    battle = state["battle"]
    entering = {track["id"] for track in state["opening"]}
    for cat in battle["actors"]:
        button = page.locator(f'.cat-portrait[data-id="{cat["id"]}"]')
        expected = ("waiting" if cat["removed"] or cat["hp"] <= 0
                    else "entering" if cat["id"] in entering
                    else "acted" if cat["usedThisRound"] else "available")
        assert button.get_attribute("data-status") == expected
        assert f'{cat["hp"]}/{cat["maxHp"]}' in button.get_attribute("aria-label")
        assert button.locator("canvas").evaluate("e => getComputedStyle(e).filter") == ("grayscale(1)" if expected == "waiting" else "none")
        mark = button.locator(".portrait-mark")
        assert mark.is_hidden() == (expected == "available")
        if expected != "available":
            assert mark.inner_text() == {"entering": "…", "waiting": "×", "acted": "✓"}[expected]
        available = (cat["team"] == 0 and battle["side"] == 0 and battle["phase"] == "ready"
                     and not cat["removed"] and cat["hp"] > 0 and not cat["usedThisRound"] and not state["suspended"])
        assert button.is_disabled() == (not available)
    selected = next(cat for cat in battle["actors"] if cat["id"] == state["selected"])
    hp = page.locator("#selected-healthbar").evaluate("e => [e.value, e.max]")
    assert hp == [selected["hp"], selected["maxHp"]]
    assert f'HP {selected["hp"]}/{selected["maxHp"]}' == page.locator("#selected-health").inner_text()
    expected_state = ("waiting" if selected["removed"] or selected["hp"] <= 0
                      else "entering" if selected["id"] in entering
                      else "acted" if selected["usedThisRound"] else "available")
    label = "defeated" if expected_state == "waiting" else expected_state
    assert page.locator("#selected-turn").text_content() == page.evaluate("key => MiaoI18n.t(key)", "battle." + label)
    if entering and not state["suspended"] and battle["phase"] == "ready":
        assert page.locator("#state").inner_text() == page.evaluate("MiaoI18n.t('state.entering')")
    assert page.locator("#ally-score").inner_text() == str(battle["scores"][0])
    assert page.locator("#enemy-score").inner_text() == str(battle["scores"][1])


def run(url, channel=None):
    artifacts = ROOT / "tests/artifacts"
    artifacts.mkdir(exist_ok=True)
    checks, errors = [], []
    battle_source = (ROOT / "static/battle.js").read_text(encoding="utf-8")
    # This response alone exposes Match for controlled lethal-contact fixtures.
    # The production page exports only the existing read-only snapshot.
    battle_source = battle_source.replace("this.reset();", "this.reset(); window.testMatch = this;", 1)
    maps_source = (ROOT / "static/maps.js").read_text(encoding="utf-8")
    fixture = json.loads((ROOT / "tests/fixtures/square-map.json").read_text(encoding="utf-8"))
    clock = """(() => {
        const frames = new Map(); let id = 0, time = 1;
        window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
        window.cancelAnimationFrame = key => frames.delete(key);
        window.testStep = ms => {
            time += ms; const pending = [...frames.values()]; frames.clear();
            pending.forEach(callback => callback(time));
        };
    })();"""
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=channel, headless=True)
        try:
            profiles = [
                ("summer-pool", ""),
                ("test-square", ""),
                ("summer-pool", "&knockout=unseat-inertia&camera=release&contact=accent&flight=aligned&costume=swim-v2&feedback=impact&pace=impact-read"),
            ]
            for map_id, presentation in profiles:
                context = browser.new_context(viewport={"width": 1280, "height": 720})
                enable_dev_controls(context)
                context.add_init_script(clock)
                context.route("**/battle.js*", lambda route: route.fulfill(body=battle_source, content_type="text/javascript"))
                context.route("**/maps.js*", lambda route: route.fulfill(
                    body=maps_source + "\nMiaoMaps.register(" + json.dumps(fixture) + ");", content_type="text/javascript",
                ))
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(url + "?locale=zh-CN&map=" + map_id + presentation)
                page.wait_for_load_state("networkidle")
                page.wait_for_function("Boolean(window.miaoPlayground)")
                tick(page, milliseconds=0)
                assert [track["id"] for track in snapshot(page)["opening"]] == list(range(6))
                assert all(cat["entrance"] for cat in snapshot(page)["art"]["characters"])
                assert_hud(page)
                launch(page, 0, 9, 0)
                page.evaluate("""() => {
                    testMatch.targetScore = 2;
                    for (const id of [3, 4]) {
                        testMatch.actors[id].hp = 1;
                        testMatch.handleContact({wall: false, ringIds: [0, id]});
                    }
                    testMatch.world._stop();
                }""")
                # Contacts here are injected between frames; drain their events at
                # the same instant, as real contacts are drained in their own frame.
                tick(page, milliseconds=0)
                tick(page)
                state = snapshot(page)
                assert state["battle"]["scores"] == [2, 0]
                assert state["battle"]["phase"] == "resolving"
                assert len(state["flights"]) == 2 and len(state["rings"]) == 4
                assert page.locator("#result-dialog").is_hidden()
                assert "2 : 0" in page.locator("#score-status").inner_text()
                assert_hud(page)
                tick(page, 2)
                page.screenshot(path=str(artifacts / f"scoring-{map_id}-flight.png"))
                before = snapshot(page)
                page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'))")
                tick(page, 5)
                assert snapshot(page)["flights"] == before["flights"]
                assert snapshot(page)["battle"]["presentationTime"] == before["battle"]["presentationTime"]
                page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'))")
                tick(page, milliseconds=0)
                tick(page, 4)
                assert page.locator("#result-dialog").is_hidden()
                assert not page.evaluate("testMatch.canLaunch(1)")
                finish_flights(page)
                assert snapshot(page)["battle"]["phase"] == "over"
                assert not snapshot(page)["flights"]
                assert not snapshot(page)["opening"] and not snapshot(page)["entranceWater"]
                assert_hud(page)
                assert page.locator("#result-dialog").is_visible()
                assert page.locator("#result-reveal-ally").text_content() == "2"
                assert page.locator("#result-reveal-rival").text_content() == "0"
                page.wait_for_function(
                    "getComputedStyle(document.querySelector('.result-stage')).opacity === '1'", polling=50,
                )
                assert "2 : 0" in page.locator("#result-note").inner_text()
                page.screenshot(path=str(artifacts / f"scoring-{map_id}-result.png"))

                page.locator("#play-again").evaluate("button => button.click()")
                assert snapshot(page)["battle"]["scores"] == [0, 0]
                assert not snapshot(page)["flights"]
                launch(page, 0, 9, 0)
                page.evaluate("""() => {
                    testMatch.targetScore = 5;
                    for (const id of [3, 4, 5]) {
                        testMatch.actors[id].hp = 1;
                        testMatch.handleContact({wall: false, ringIds: [0, id]});
                    }
                    testMatch.world._stop();
                    testMatch.actors[1].hp = 60;
                    const spawn = testMatch.map.spawns[1][0];
                    Matter.Body.setPosition(testMatch.world.rings.find(r => r.id === 1).body, spawn);
                    for (const cat of testMatch.actors) cat.usedThisRound = true;
                }""")
                tick(page, milliseconds=0)
                tick(page)
                survivors = snapshot(page)["rings"]
                finish_flights(page)
                state = snapshot(page)
                assert state["battle"]["round"] == 2
                assert state["battle"]["scores"] == [3, 0]
                assert all(cat["hp"] == cat["maxHp"] for cat in state["battle"]["actors"][3:])
                assert state["battle"]["actors"][1]["hp"] == 60
                assert [ring for ring in state["rings"] if ring["id"] < 3] == survivors
                spawn = state["battle"]["map"]["spawns"][1][0]
                returned = state["battle"]["actors"][3]
                assert (returned["x"] - spawn["x"]) ** 2 + (returned["y"] - spawn["y"]) ** 2 >= 81 ** 2 - 1e-5
                assert not state["flights"]
                assert [track["id"] for track in state["opening"]] == [3, 4, 5]
                assert [track["id"] for track in state["entranceWater"]] == [3, 4, 5]
                assert not state["entranceWater"][0]["drops"]
                assert_hud(page)
                tick(page, 5)
                state = snapshot(page)
                assert state["battle"]["phase"] == "ready"
                assert [track["id"] for track in state["opening"]] == [3, 4, 5]
                tick(page, 3)
                state = snapshot(page)
                assert state["entranceWater"][0]["drops"]
                assert state["entranceWater"][0]["rings"]
                before = state["entranceWater"]
                page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'))")
                tick(page, 5)
                assert snapshot(page)["entranceWater"] == before
                assert_hud(page)
                page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange'))")
                tick(page, milliseconds=0)
                tick(page, 4)
                state = snapshot(page)
                assert not state["opening"]
                assert state["battle"]["phase"] == "ready"
                assert state["entranceWater"] and not state["entranceWater"][0]["drops"]
                assert_hud(page)
                assert_viewport_fit(page)
                page.screenshot(path=str(artifacts / f"scoring-{map_id}-return.png"))

                restart_pool(page, programmatic=True)
                launch(page, 0, 9, 0)
                page.evaluate("testMatch.actors[3].hp = 1; testMatch.handleContact({wall:false, ringIds:[0,3]})")
                tick(page)
                assert snapshot(page)["flights"]
                restart_pool(page, programmatic=True)
                tick(page, 10)
                assert not snapshot(page)["flights"]
                assert snapshot(page)["battle"]["scores"] == [0, 0]
                assert page.locator("#result-dialog").is_hidden()
                select_setting(page, "#game-mode", "practice")
                assert not snapshot(page)["entranceWater"]
                assert page.locator("#score-status").is_hidden()
                context.close()
                checks.append(map_id + (" impact-read" if presentation else "") + ": six entrances, three-role returns, live HP/portrait/action states, pause, CPU waits for landing, final score and reset")

            context = browser.new_context(viewport={"width": 1600, "height": 900}, reduced_motion="no-preference")
            enable_dev_controls(context)
            context.add_init_script(clock)
            context.route("**/battle.js*", lambda route: route.fulfill(body=battle_source, content_type="text/javascript"))
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + "?locale=zh-CN&motion=full")
            page.wait_for_function("Boolean(window.miaoPlayground)", polling=25)
            tick(page, 18)
            page.evaluate("""() => {
                testMatch.side = 1;
                testMatch.roundStarter = 1;
                if (!testMatch.launch(3, {x: 20, y: 0})) throw new Error('Fixture launch failed');
                for (const id of [0, 1, 2]) {
                    testMatch.actors[id].hp = 1;
                    testMatch.handleContact({wall: false, ringIds: [3, id]});
                }
                testMatch.world._stop();
                for (const cat of testMatch.actors) cat.usedThisRound = true;
            }""")
            tick(page, milliseconds=0)
            assert snapshot(page)["selected"] == 0
            assert page.locator("#selected-health").inner_text() == "HP 0/120"
            assert_hud(page)
            finish_flights(page)
            assert snapshot(page)["battle"]["round"] == 2
            assert snapshot(page)["battle"]["side"] == 0
            assert [track["id"] for track in snapshot(page)["opening"]] == [0, 1, 2]
            assert_hud(page)
            tick(page, 8)
            assert_hud(page)
            page.screenshot(path=str(artifacts / "stage2-ally-return-entering.png"))
            aim(page, 2, 25, 0)
            assert snapshot(page)["aiming"]
            assert not snapshot(page)["opening"] and not snapshot(page)["entranceWater"]
            assert_hud(page)
            page.keyboard.press("Escape")
            page.mouse.up()
            assert snapshot(page)["battle"]["remainingActions"] == [3, 3]
            assert_hud(page)
            restart_pool(page, programmatic=True)
            tick(page, 9)
            assert any(track["drops"] for track in snapshot(page)["entranceWater"])
            restart_pool(page, programmatic=True)
            assert all(track["age"] <= 0 and not track["drops"] for track in snapshot(page)["entranceWater"])
            assert_hud(page)
            context.close()
            checks.append("selected ally HP/cross restores on return; entering portraits keep colour; manual aim skips entry without spending a shot; reset replaces active water")

            context = browser.new_context(viewport={"width": 1600, "height": 900}, reduced_motion="no-preference")
            enable_dev_controls(context)
            context.add_init_script(clock)
            context.route("**/opening-v1/milkcap.png", lambda route: route.abort())
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + "?locale=zh-CN&motion=full")
            page.wait_for_function("Boolean(window.miaoPlayground)", polling=25)
            state = snapshot(page)
            assert [track["id"] for track in state["opening"]] == [0, 1, 3, 4]
            assert [cat["entrance"] for cat in state["art"]["characters"]] == [True, True, False, True, True]
            assert all(cat["loaded"] for cat in state["art"]["characters"])
            assert len(state["rings"]) == 6
            tick(page, 18)
            assert not snapshot(page)["opening"] and not snapshot(page)["entranceWater"]
            context.close()
            checks.append("missing Milkcap entrance image preserves all idle sprites and the other two entrances")

            context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
            enable_dev_controls(context)
            context.add_init_script(clock)
            context.route("**/battle.js*", lambda route: route.fulfill(body=battle_source, content_type="text/javascript"))
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + "?locale=zh-CN")
            page.wait_for_load_state("networkidle")
            tick(page, milliseconds=0)
            launch(page, 0, 9, 0)
            page.evaluate("testMatch.actors[3].hp=1; testMatch.handleContact({wall:false, ringIds:[0,3]}); testMatch.world._stop()")
            tick(page, milliseconds=0)
            tick(page)
            tick(page)
            state = snapshot(page)
            assert state["flights"][0]["rotation"] == 0
            assert state["flights"][0]["duration"] == 0.25
            assert state["flights"][0]["y"] == state["flights"][0]["shadowY"]
            page.screenshot(path=str(artifacts / "scoring-mobile-reduced-motion.png"))
            assert_viewport_fit(page)
            tick(page, 2)
            assert not snapshot(page)["flights"]
            assert snapshot(page)["battle"]["phase"] == "ready"
            assert not snapshot(page)["opening"]
            assert not snapshot(page)["entranceWater"]
            context.close()
            checks.append("mobile reduced-motion departure is short, without spin or an arc")
            assert not errors, errors
        finally:
            browser.close()
    report = {"checks": checks, "errors": errors}
    (artifacts / "scoring-browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default=None)
    args = parser.parse_args()

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        run(f"http://127.0.0.1:{server.server_port}/static/index.html", args.channel)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
