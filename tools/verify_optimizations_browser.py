"""Local Chromium smoke test, using inlined scripts to avoid file:// script restrictions."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf8')
html = html.replace('<link rel="stylesheet" href="./src/styles/main.css" />',
                    '<style>' + (root / 'src/styles/main.css').read_text(encoding='utf8') + '</style>')
paths = [
    'assets/persona-map.js', 'src/engine/cohesion-field.js', 'assets/persona-anatomy.js',
    'src/engine/anatomy.js', 'src/engine/role-registry.js', 'src/engine/particle-world.js',
    'src/controller/behavior-controller.js', 'assets/animations/idle-targets.js',
    'src/animation/target-animation-player.js', 'src/animation/pixel-stabilizer.js',
    'src/ui/controls.js', 'src/ui/metrics.js', 'src/app.js',
]
for path in paths:
    tag = f'<script defer src="./{path}"></script>'
    assert tag in html, f'Missing browser script {path}'
    html = html.replace(tag, '')
html = html.replace('</body>', '\n'.join(
    f'<script>{(root / path).read_text(encoding="utf8")}</script>' for path in paths
) + '\n</body>')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium',
                                         args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html, wait_until='load')
    page.wait_for_function('window.persona && targetPlayer && targetPlayer.frames.length === 43')
    assert page.locator('#idle-speed-value').inner_text() == '1×'
    page.locator('#tab-settings').click()
    assert not page.locator('#anti-flicker').is_checked()
    page.locator('#anti-flicker').check()
    assert page.locator('#anti-flicker').is_checked() is True
    page.locator('#anti-flicker').uncheck()
    page.locator('#tab-animations').click()
    assert page.evaluate('world.visibleParticleCount') > 13000
    page.locator('#idle-speed').fill('2')
    assert page.evaluate('targetPlayer.speed') == 2
    assert page.evaluate('targetPlayer.playbackDurationMs') == 860
    page.locator('#particle-density').select_option('4000')
    assert page.evaluate('world.visibleParticleCount') == 4000
    assert page.evaluate('targetPlayer.frames.length') == 43
    assert page.evaluate('targetPlayer.frames[42].length') == 16162 * 3
    page.locator('#idle-frame').fill('43')
    assert page.evaluate('targetPlayer.frame') == 42
    assert page.evaluate('targetPlayer.inspecting') is True
    assert '43' in page.locator('#idle-frame-value').inner_text()
    page.locator('#idle-speed').fill('0.5')
    assert page.evaluate('targetPlayer.playbackDurationMs') == 3440
    page.locator('#particle-density').select_option('auto')
    assert page.evaluate('world.visibleParticleCount') == 13694
    assert page.evaluate('targetPlayer.frame') == 42
    page.locator('#idle-resume').click()
    page.wait_for_timeout(250)
    assert page.evaluate('targetPlayer.playing && !targetPlayer.inspecting') is True
    assert '2' not in page.locator('#idle-speed-value').inner_text()
    assert errors == [], errors
    screenshot_path = root / 'assets' / 'diagnostics' / 'optimization-preview.png'
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshot_path))
    print({'frames': 43, 'speed': '0.5x - 2x', 'density': '4000 -> auto',
           'frame43': 'exact', 'filter': 'active only during playback',
           'page_errors': errors, 'screenshot': str(screenshot_path)})
    browser.close()
