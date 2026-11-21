"""Exercise the real page over HTTP and capture deterministic comparison frames."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tracking-diagnostics"


def main():
    OUTPUT.mkdir(exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=ROOT)) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport={"width": 1440, "height": 960})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/")
                page.wait_for_function("window.persona && window.persona.getSnapshot().animation.playing")
                select = page.locator("#animation-tracking")
                assert select.input_value() == "legacy"
                select.select_option("decoupled")
                assert page.evaluate("window.persona.getSnapshot().animationTracking") == "decoupled"
                page.locator("#idle-frame").fill("43")
                assert page.evaluate("world.getTrackingDiagnostics().maxErrorPx") == 0
                page.locator("#idle-resume").click()
                page.wait_for_function("!window.persona.getSnapshot().animation.inspecting")
                for mode in ("legacy", "decoupled"):
                    for clip in ("idle", "left", "right"):
                        # Step the same seeded pose sequence without depending on display refresh.
                        page.evaluate("""({mode, clip}) => {
                          world.paused = false;
                          controller.reset();
                          controller.dispatch({type: 'animation', action: 'tracking', value: mode});
                          controller.dispatch({type: 'animation', name: 'idle'});
                          world.snapToTargetPose();
                          for (let i = 0; i < 18; i++) {
                            controller.advance(1/60); world.step(1/60);
                          }
                          if (clip !== 'idle') controller.dispatch({type: 'animation', name: clip});
                          for (let i = 0; i < 36; i++) {
                            controller.advance(1/60); world.step(1/60);
                          }
                          world.paused = true;
                          document.querySelector('#anti-flicker').dispatchEvent(new Event('change'));
                        }""", {"mode": mode, "clip": clip})
                        page.locator("#stage").screenshot(path=str(OUTPUT / f"{clip}-{mode}.png"))
                page.evaluate("""() => {
                  world.paused = false;
                  controller.trigger('hit');
                  controller.advance(1/60);
                  world.step(1/60);
                  world.paused = true;
                  document.querySelector('#anti-flicker').dispatchEvent(new Event('change'));
                }""")
                assert page.evaluate("world.mode") == "explode"
                page.locator("#stage").screenshot(path=str(OUTPUT / "decoupled-impact.png"))
                page.locator("#tab-settings").click()
                assert page.locator("#tracking-error").is_visible()
                assert page.locator("#tracking-limited").is_visible()
                assert not errors, errors
                browser.close()
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
