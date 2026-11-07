"""Exercise the production water loop and optionally record its configured period."""
import io
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from browser_checks import enable_dev_controls, launch, restart_pool, snapshot
from contact_feedback_browser_checks import CLOCK
from PIL import Image
from playwright.sync_api import sync_playwright
from scoring_browser_checks import tick

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'tests/artifacts/water-loop-1'
PRESENTATION = ('&motion=full&feedback=impact&pace=impact-read&knockout=unseat-inertia'
                '&camera=release&contact=accent&flight=aligned&costume=swim-v2')


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run(url, output=None):
    ART.mkdir(parents=True, exist_ok=True)
    errors, checks = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1600, 'height': 900})
        enable_dev_controls(context)
        context.add_init_script(CLOCK)

        def open_page(extra='', presentation=PRESENTATION):
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url + '?locale=zh-CN' + presentation + extra)
            page.wait_for_function('Boolean(window.miaoPlayground)', polling=25)
            tick(page, 61)
            return page

        page = open_page()
        state = snapshot(page)
        assert state['waterSurface']['mode'] == 'dynamic'
        assert state['waterSurface']['preset'] == 'pool-loop'
        assert not state['waterSurface']['failed'] and state['waterSurface']['wavelets'] > 0
        assert not state['opening'] and not state['entranceWater']
        initial_rings = state['rings']
        page.screenshot(path=str(ART / 'live-page.png'))
        if output:
            frames = []
            count = round(state['waterSurface']['period'] * 24)
            for i in range(count):
                frames.append(Image.open(io.BytesIO(page.locator('#pool').screenshot())).convert('RGB'))
                tick(page, milliseconds=1000/24)
            for i in [0, count//4, count//2, count*3//4]:
                frames[i].save(ART / f'loop-{i:03}.png')
            frames[0].save(output, save_all=True, append_images=frames[1:],
                           duration=[round((i+1)*1000/24)-round(i*1000/24) for i in range(count)],
                           loop=0, quality=85, method=3)
        assert snapshot(page)['rings'] == initial_rings
        checks.append('production scene: configured water loop; idle physics unchanged')
        frozen = snapshot(page)['waterSurface']
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
        tick(page, 10)
        assert snapshot(page)['waterSurface'] == frozen
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
        tick(page, 2)
        assert snapshot(page)['waterSurface']['time'] > frozen['time']
        launch(page, 0, 180, 0)
        disturbed = False
        for _ in range(1000):
            tick(page, milliseconds=1000/240)
            state = snapshot(page)
            disturbed |= state['waterSurface']['disturbances'] > 0
            if state['ordinaryContacts']:
                break
        assert disturbed
        assert snapshot(page)['battle']['actors'][3]['hp'] == 96
        restart_pool(page, programmatic=True)
        assert not snapshot(page)['waterWake']['marks']
        checks.append('pause freezes water; real launch disturbs it and preserves 24-point damage; reset clears wakes')
        page.close()
        for extra, presentation, mode in [('&water-motion=static', PRESENTATION, 'static'),
                                          ('&water=classic', PRESENTATION, 'static'),
                                          ('', '&motion=reduce', 'reduced')]:
            page = open_page(extra, presentation)
            assert snapshot(page)['waterSurface']['mode'] == mode
            before = page.locator('#pool').screenshot()
            tick(page, 20)
            assert page.locator('#pool').screenshot() == before
            page.close()
        checks.append('static comparison, classic fallback and reduced motion stay static')
        assert not errors, errors
        (ART / 'report.json').write_text(json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
        browser.close()
        print(json.dumps({'checks': checks, 'errors': errors, 'animation': output}, ensure_ascii=False))


if __name__ == '__main__':
    import sys
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        run(f'http://127.0.0.1:{server.server_port}/static/index.html', sys.argv[1] if len(sys.argv) > 1 else None)
    finally:
        server.shutdown()
        server.server_close()
