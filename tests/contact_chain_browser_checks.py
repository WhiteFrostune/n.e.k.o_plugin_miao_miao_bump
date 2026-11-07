"""Controlled real-contact chain and bounded-load checks; no production debug controls."""

import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import median
from threading import Thread

from browser_checks import enable_dev_controls, launch, restart_pool, select_setting, snapshot
from contact_feedback_browser_checks import CLOCK
from playwright.sync_api import sync_playwright
from scoring_browser_checks import tick

ROOT = Path(__file__).resolve().parents[1]
PROFILE = "&knockout=unseat-inertia&camera=release&contact=accent&flight=aligned&costume=swim-v2&feedback=impact&pace=impact-read"


def run(url):
    artifacts = ROOT / "tests/artifacts/contact-chain-1"
    artifacts.mkdir(parents=True, exist_ok=True)
    battle = (ROOT / "static/battle.js").read_text(encoding="utf-8")
    battle = battle.replace("this.reset();", "this.reset(); window.testMatch=this;", 1)
    game = (ROOT / "static/game.js").read_text(encoding="utf-8")
    game = game.replace("window.miaoPlayground = Object.freeze", """
      window.testWorld = () => world;
      window.testBudgets = () => ({normal:normalEffects.length,wake:waterWakes.marks.length,
        queue:world.visualContacts.length,reactions:reactions.size,legacy:effects.length,traits:traitEffects.size});
      window.miaoPlayground = Object.freeze""", 1)
    feedback = (ROOT / "static/contact-feedback.js").read_text(encoding="utf-8") + """
      (() => { const create=MiaoContactFeedback.create;window.testContacts=[];
        MiaoContactFeedback.create=(event,options) => {
          testContacts.push({ids:[...event.ringIds],wall:event.wall,time:event.simulationTime});
          return create(event,options);
        }; })();
    """
    checks, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            context = browser.new_context(viewport={"width": 1600, "height": 900})
            enable_dev_controls(context)
            context.add_init_script(CLOCK)
            context.route("**/battle.js*", lambda r: r.fulfill(body=battle, content_type="text/javascript"))
            context.route("**/game.js*", lambda r: r.fulfill(body=game, content_type="text/javascript"))
            context.route("**/contact-feedback.js*", lambda r: r.fulfill(body=feedback, content_type="text/javascript"))

            def open_page(extra=""):
                page = context.new_page()
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(url + "?locale=zh-CN&motion=full" + PROFILE + extra)
                page.wait_for_function("Boolean(window.miaoPlayground)", polling=25)
                tick(page, milliseconds=0)
                return page

            page = open_page()
            page.evaluate("""() => {
                const positions=[[163,300],[400,470],[650,470],[81,300],[850,470],[1050,470]];
                for (const ring of testMatch.world.rings)
                    Matter.Body.setPosition(ring.body,{x:positions[ring.id][0],y:positions[ring.id][1]});
            }""")
            launch(page, 0, -180, 0)
            tick(page, 15, milliseconds=1000 / 240)
            hits = page.evaluate("testContacts.filter(e => !e.wall && e.ids.includes(0) && e.ids.includes(3))")
            assert len(hits) == 2 and hits[1]["time"] - hits[0]["time"] < 0.075, hits
            state = snapshot(page)
            assert state["battle"]["actors"][3]["hp"] == 72
            assert state["battle"]["scores"] == [0, 0]
            assert len(state["ordinaryContacts"]) <= 3
            assert any(e["wall"] for e in state["ordinaryContacts"])
            assert any(not e["wall"] for e in state["ordinaryContacts"])
            page.screenshot(path=str(artifacts / "rapid-recontact.png"))
            checks.append("real wall return inside 75ms produces both ring-contact feedbacks, two normal 24-damage hits, and a compact local splash")
            page.close()

            page = open_page()
            page.evaluate("""() => {
                for (const ring of testMatch.world.rings)
                    Matter.Body.setPosition(ring.body,{x:300+ring.id*82,y:320});
            }""")
            launch(page, 0, 180, 0)
            moved, times = set(), []
            for i in range(75):
                result = page.evaluate("""() => {
                    const at=performance.now(); testStep(1000/60); const ms=performance.now()-at;
                    return {ms,state:miaoPlayground.snapshot(),budgets:testBudgets()};
                }""")
                state, budget = result["state"], result["budgets"]
                if i >= 10:
                    times.append(result["ms"])
                moved.update(ring["id"] for ring in state["rings"] if abs(ring["vx"]) + abs(ring["vy"]) > 30)
                assert budget["normal"] <= 20 and budget["wake"] <= 128 and budget["queue"] <= 256
                assert budget["traits"] <= 6
                if i == 12:
                    page.screenshot(path=str(artifacts / "six-cat-chain.png"))
            assert len(moved) == 6, moved
            assert len(page.evaluate("testContacts.filter(e => !e.wall)")) >= 5
            frozen = snapshot(page)
            page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, 5)
            paused = snapshot(page)
            for key in ["ordinaryContacts", "waterWake", "flights", "elapsed"]:
                assert paused[key] == frozen[key]
            page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, milliseconds=0)
            restart_pool(page, programmatic=True)
            state = snapshot(page)
            assert not state["ordinaryContacts"] and not state["waterWake"]["marks"] and not state["flights"]
            assert state["battle"]["scores"] == [0, 0]
            for mode in ["practice", "battle", "practice", "battle"]:
                select_setting(page, "#game-mode", mode)
                state = snapshot(page)
                assert not state["ordinaryContacts"] and not state["waterWake"]["marks"] and not state["flights"]
            checks.append("one genuine chain moves all six cats; effect budgets remain bounded; pause, reset and repeated mode changes cleanly restore state")
            chain_times = sorted(times)
            page.close()

            page = open_page()
            page.evaluate("""() => {
                const positions=[[300,320],[350,470],[650,470],[520,320],[630,320],[740,320]];
                for (const ring of testMatch.world.rings)
                    Matter.Body.setPosition(ring.body,{x:positions[ring.id][0],y:positions[ring.id][1]});
                const toggle=document.querySelector('#test-one-hit');toggle.checked=true;
                toggle.dispatchEvent(new Event('change',{bubbles:true}));
            }""")
            launch(page, 0, 180, 0)
            for _ in range(600):
                tick(page, milliseconds=1000/60)
                state = snapshot(page)
                if len(state["flights"]) == 3:
                    break
            assert len(state["flights"]) == 3 and state["battle"]["scores"] == [3, 0]
            assert state["motion"]["activeCameraStyle"] == "release"
            assert not any(not contact["wall"] for contact in state["ordinaryContacts"])
            page.screenshot(path=str(artifacts / "real-triple-knockout.png"))
            frozen = state
            page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, 5)
            paused = snapshot(page)
            for key in ["ordinaryContacts", "waterWake", "flights", "elapsed"]:
                assert paused[key] == frozen[key]
            page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
            tick(page, milliseconds=0)
            page.evaluate("""() => {
                testMatch.world._stop();
            }""")
            assert state["battle"]["remainingActions"] == [2, 0]
            for _ in range(60):
                tick(page)
                state = snapshot(page)
                if state["battle"]["round"] == 2:
                    break
            assert state["battle"]["round"] == 2 and not state["flights"]
            assert [track["id"] for track in state["opening"]] == [3, 4, 5]
            assert not state["ordinaryContacts"] and not state["waterWake"]["marks"]
            assert all(cat["hp"] == cat["maxHp"] for cat in state["battle"]["actors"][3:])
            assert state["battle"]["scores"] == [3, 0]
            assert page.locator("#round-score").is_visible()
            assert page.locator("#round-score-ally").inner_text() == "3"
            restart_pool(page, programmatic=True)
            assert snapshot(page)["battle"]["scores"] == [0, 0]
            assert not snapshot(page)["flights"] and snapshot(page)["motion"]["cameraAge"] is None
            checks.append("three genuine lethal contacts relay the approved camera, pause together and return through real respawn events without old splashes, ghost wakes or duplicate score")
            page.close()

            page = open_page("&mode=practice")
            page.evaluate("""() => {
                const world=testWorld();
                world.reset('free',Array.from({length:6},(_,id)=>({id,x:250+(id%3)*350,y:id<3?170:450})));
                world.launch(0,{x:1300,y:600});
                const velocities=[[1300,600],[-1100,900],[-1300,500],[1200,-800],[-1250,-700],[900,-1100]];
                for (const ring of world.rings)
                    Matter.Body.setVelocity(ring.body,{x:velocities[ring.id][0]/60,y:velocities[ring.id][1]/60});
            }""")
            costs, peak_normal, peak_wake = [], 0, 0
            for i in range(180):
                result = page.evaluate("""() => {
                    const at=performance.now();testStep(1000/60);const ms=performance.now()-at;
                    return {ms,budget:testBudgets()};
                }""")
                budget = result["budget"]
                assert budget["normal"] <= 20 and budget["wake"] <= 128 and budget["queue"] <= 256
                peak_normal, peak_wake = max(peak_normal, budget["normal"]), max(peak_wake, budget["wake"])
                if i >= 10:
                    costs.append(result["ms"])
                if i == 30:
                    page.screenshot(path=str(artifacts / "six-moving-load.png"))
            assert peak_normal > 0 and peak_wake > 10
            page.evaluate("""() => {
                const e=document.querySelector('#motion-mode');e.value='reduce';
                e.dispatchEvent(new Event('change',{bubbles:true}));
            }""")
            state = snapshot(page)
            assert not state["ordinaryContacts"] and not state["waterWake"]["marks"]
            page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}))")
            state = snapshot(page)
            assert state["destroyed"] and not state["flights"] and not state["opening"] and not state["entranceWater"]
            assert page.evaluate("Object.values(testBudgets()).every(n=>n===0)")
            costs.sort()
            performance = {
                "viewport": [1600, 900], "browser": "Edge headless",
                "method": "controlled simulation+draw callback time, excludes screenshot and snapshot serialization; not a physical refresh-rate guarantee",
                "six_cat_chain_ms": {"median": round(median(chain_times), 3), "p95": round(chain_times[int(len(chain_times)*.95)], 3)},
                "six_moving_stress_ms": {"median": round(median(costs), 3), "p95": round(costs[int(len(costs)*.95)], 3)},
                "peak_normal_effects": peak_normal, "peak_wake_marks": peak_wake,
            }
            checks.append("controlled six-body moving load stays within water/effect budgets; simplified motion and page disposal clear all retained presentation queues")
            page.close()
            context.close()
            assert not errors, errors
        finally:
            browser.close()
    report = {"checks": checks, "performance": performance, "errors": errors}
    (artifacts / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
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
