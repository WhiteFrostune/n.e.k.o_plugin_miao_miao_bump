"""Play two complete matches from the lobby with the default knockout settings."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser_checks import aim, assert_viewport_fit, snapshot
from flight_fixture import build
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LINEUP = ["奶盖", "橘子", "布丁"]
PLAYER_READY = """() => {
    const battle = window.miaoPlayground?.snapshot().battle;
    return battle && (battle.phase === 'over' || battle.phase === 'ready' && battle.side === 0);
}"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_fresh_match(page):
    state = snapshot(page)
    battle = state["battle"]
    assert [cat["role"] for cat in battle["actors"]] == [2, 0, 1, 0, 1, 2]
    assert state["map"]["id"] == "summer-pool"
    assert battle["scores"] == [0, 0] and battle["round"] == battle["turn"] == 1
    assert battle["side"] == 0 and battle["phase"] == "ready"
    assert not state["flights"] and len(state["rings"]) == 6
    assert all(cat["hp"] == cat["maxHp"] for cat in battle["actors"])
    assert page.locator("#ally-roster .portrait-label").all_text_contents() == LINEUP
    assert page.locator("#round-score").is_hidden()


def shoot(page, shot):
    speed = snapshot(page)["params"]["maxSpeed"]
    aim(page, shot["id"], shot["x"] / speed * 180, shot["y"] / speed * 180)
    assert snapshot(page)["aiming"]
    page.mouse.up()


def play_match(page, check_pause=False):
    for actions in range(161):
        page.wait_for_function(PLAYER_READY, timeout=20000)
        state = snapshot(page)
        if state["battle"]["phase"] == "over":
            break
        shot = page.evaluate("MiaoBattle.chooseShot(miaoPlayground.snapshot().battle)")
        assert shot is not None
        shoot(page, shot)
        if check_pause and actions == 0:
            pause = """hidden => {
                Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
                document.dispatchEvent(new Event('visibilitychange'));
            }"""
            page.evaluate(pause, True)
            before = snapshot(page)
            page.wait_for_timeout(150)
            assert before["suspended"] and snapshot(page)["rings"] == before["rings"]
            page.evaluate(pause, False)
    else:
        raise AssertionError("Match did not finish")
    battle = state["battle"]
    assert battle["winner"] in (0, 1) and battle["scores"][battle["winner"]] >= 5
    assert not state["flights"]
    page.locator("#result-title").wait_for(state="visible")
    assert f"{battle['scores'][0]} : {battle['scores'][1]}" in page.locator("#result-note").inner_text()
    assert page.locator("#result-lineup li").all_text_contents() == LINEUP
    print(f"Match finished at {battle['scores']}, round {battle['round']}, {actions} player shots.", flush=True)


def run(url, channel, full_playtest=False):
    with sync_playwright() as driver:
        browser = driver.chromium.launch(channel=channel, headless=True)
        try:
            page = browser.new_page(viewport={"width": 1366, "height": 768}, reduced_motion="reduce")
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            # Accelerate the display clock only. Every shot is real pointer input,
            # and Match, the CPU and Matter retain their production logic.
            page.add_init_script("""(() => {
                const request = window.requestAnimationFrame.bind(window);
                let clock = 0;
                const seen = new Map();
                const traits = new Set();
                let damagePopups = 0;
                for (const method of ['fillText', 'strokeText']) {
                    const draw = CanvasRenderingContext2D.prototype[method];
                    CanvasRenderingContext2D.prototype[method] = function(text, ...args) {
                        if (this.canvas.id === 'pool' && /^[−-][0-9]+$/.test(text)) damagePopups++;
                        return draw.call(this, text, ...args);
                    };
                }
                localStorage.setItem('miao-bump-motion', 'reduce');
                localStorage.setItem('miao-bump-knockout', 'legacy');
                localStorage.setItem('miao-bump-camera', 'quick');
                window.testFlights = () => [...seen.values()];
                window.testTraits = () => ({ kinds: [...traits], damagePopups });
                window.requestAnimationFrame = callback => request(() => {
                    callback(clock += 100);
                    const state = window.miaoPlayground?.snapshot();
                    for (const f of state?.flights ?? []) {
                        seen.set(f.role, [f.role, f.version, f.parts.length, f.unseat?.alignedFlight]);
                    }
                    for (const trait of state?.traits ?? []) traits.add(trait.kind);
                });
            })();""")
            page.goto(url + "/preparation.html?locale=zh-CN")
            assert page.locator(".preview-links").count() == 0
            page.locator("#ally-lineup button").first.click()
            for key in ["milkcap", "juzi", "pudding"]:
                page.locator(f'#picker-cats [data-cat="{key}"]').click()
            page.locator("#picker-confirm").click()
            assert page.locator("#ally-lineup .slot-name").all_text_contents() == LINEUP
            page.locator("#choose-map").click()
            assert page.locator(".map-template").count() == 0
            page.locator('.map-choice[data-map="summer-pool"]').click()
            page.locator("#map-picker-confirm").click()
            page.locator("#start-match").click()
            page.locator("#versus-cue").wait_for(state="visible")
            assert page.url.startswith(url + "/index.html?")
            assert len(snapshot(page)["opening"]) == 6
            page.wait_for_function("window.miaoPlayground && !miaoPlayground.snapshot().opening.length")
            check_fresh_match(page)
            shoot(page, {"id": 0, "x": 1000, "y": 0})
            page.go_back()
            page.locator("#ally-lineup button").first.wait_for(state="visible")
            assert page.locator("#ally-lineup .slot-name").all_text_contents() == LINEUP
            assert page.locator("#current-map-name").inner_text() == "夏日水池"
            page.locator("#start-match").click()
            page.wait_for_function("window.miaoPlayground && !miaoPlayground.snapshot().opening.length")
            check_fresh_match(page)
            state = snapshot(page)
            page.locator("#show-tuning").click()
            assert page.locator("#game-mode").is_visible()
            for control in ["motion-mode", "knockout-version", "camera-style", "impact-contact",
                            "test-one-hit", "show-hitboxes", "tuning-fields"]:
                assert page.locator(f"#{control}").count() == int(full_playtest)
            if full_playtest:
                assert not page.locator("#test-one-hit").is_checked()
                assert page.locator("#fixture-case").count() == 0
            page.keyboard.press("Escape")
            assert state["motion"]["knockoutVersion"] == "unseat-inertia"
            assert state["motion"]["cameraStyle"] == "release"
            assert state["motion"]["systemReduced"]
            assert state["motion"]["preference"] == "full" and not state["motion"]["reduced"]
            assert state["waterSurface"]["mode"] == "dynamic"
            assert all(cat["unseat"] and cat["knockoutSet"] == "swim-v2" for cat in state["art"]["characters"])
            for width, height in [(1366, 768), (1024, 600)]:
                page.set_viewport_size({"width": width, "height": height})
                assert_viewport_fit(page)
            for locale in ["en", "zh-CN"]:
                page.locator("#language").select_option(locale)
                page.wait_for_function("lang => document.documentElement.lang === lang", arg=locale)
                assert_viewport_fit(page)
            page.set_viewport_size({"width": 1280, "height": 720})

            shoot(page, {"id": 0, "x": 1000, "y": 0})
            page.locator("#reset").click()
            dialog = page.locator("#restart-dialog")
            assert dialog.is_visible()
            paused = snapshot(page)
            page.wait_for_timeout(150)
            assert snapshot(page)["rings"] == paused["rings"]
            dialog.locator("[data-close]").click()
            assert dialog.is_hidden()
            assert snapshot(page)["battle"]["actors"][0]["usedThisRound"]
            page.locator("#reset").click()
            page.locator("#confirm-restart").click()
            assert dialog.is_hidden()
            check_fresh_match(page)

            shoot(page, {"id": 0, "x": 1000, "y": 0})
            page.reload(wait_until="commit")
            page.wait_for_url("**/preparation.html?*")
            assert page.url.startswith(url + "/preparation.html?")
            page.locator("#ally-lineup button").first.wait_for(state="visible")
            assert page.locator("#ally-lineup .slot-name").all_text_contents() == LINEUP
            assert page.locator("#current-map-name").inner_text() == "夏日水池"
            page.locator("#start-match").click()
            page.wait_for_function("window.miaoPlayground && !miaoPlayground.snapshot().opening.length")
            check_fresh_match(page)
            print("Browser refresh returned to preparation; restart cancel and confirm both worked.", flush=True)

            play_match(page, check_pause=True)
            page.locator("#play-again").click()
            assert page.locator("#result-dialog").is_hidden()
            check_fresh_match(page)
            play_match(page)
            flights = page.evaluate("testFlights()")
            assert flights, "No real knockout was observed"
            assert all((version, parts, aligned) == ("unseat-inertia", 2, True) for _, version, parts, aligned in flights)
            print(f"Observed split knockouts in normal play: {flights}.", flush=True)
            feedback = page.evaluate("testTraits()")
            assert set(feedback["kinds"]) == {"guard", "bounce", "heavy"}, feedback
            assert feedback["damagePopups"] == 0
            print("All three traits triggered in full matches; no damage popups.", flush=True)

            page.locator("#result-back").click()
            page.locator("#ally-lineup button").first.wait_for(state="visible")
            assert page.url.startswith(url + "/preparation.html?")
            assert page.locator("#ally-lineup .slot-name").all_text_contents() == LINEUP
            assert page.locator("#current-map-name").inner_text() == "夏日水池"
            assert page.locator("#start-match").is_enabled()
            assert not errors, errors
        finally:
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default=None)
    parser.add_argument("--full-playtest", action="store_true")
    args = parser.parse_args()
    if args.full_playtest:
        build()
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=ROOT)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            path = "/tests/artifacts/full-playtest" if args.full_playtest else "/static"
            run(f"http://127.0.0.1:{server.server_port}{path}", args.channel, args.full_playtest)
        finally:
            server.shutdown()
