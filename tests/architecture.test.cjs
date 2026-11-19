const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

const ROOT = path.resolve(__dirname, '..');

test('the application root contains only its HTML runtime entry point', () => {
  const misplaced = fs.readdirSync(ROOT).filter(name => /\.(?:js|css|png|gif|py)$/.test(name));
  assert.deepEqual(misplaced, []);
  assert.ok(fs.existsSync(path.join(ROOT, 'index.html')));
});

test('the roles stay usable but the role-motion command is removed', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 21 });
  const controller = new BehaviorController(world);
  assert.ok(world.getRoleAssignments().eye.length > 0);
  assert.throws(() => controller.dispatch({ type: 'role-motion', name: 'orbit' }), RangeError);
  assert.ok(!Object.hasOwn(controller.getSnapshot(), 'roleMotion'));
});

test('the UI exposes FPS and the actual particle population without role-motion controls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="fps"/);
  assert.equal((html.match(/id="particle-count"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="panel-roles"|role-motion-player\.js|id="tab-roles"/);
  assert.match(html, /src\/ui\/metrics\.js/);
  assert.match(html, /src\/ui\/controls\.js/);
});

test('docs/PROJECT.md remains identical to its owner-approved initial version', () => {
  const { createHash } = require('node:crypto');
  const data = fs.readFileSync(path.join(ROOT, 'docs/PROJECT.md'));
  const gitBlobSha = createHash('sha1')
    .update(`blob ${data.byteLength}\0`)
    .update(data)
    .digest('hex');
  assert.equal(gitBlobSha, 'a293486b81f302d0fbfdb91f285218a4956c786e');
});

test('the manual behavior controls are absent while the state API stays available', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');

  for (const id of ['behavior-state', 'behavior-energy', 'voice-level']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(app, new RegExp(`querySelector\\(['"]#${id}['"]\\)`));
  }

  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 34 });
  const controller = new BehaviorController(world);
  assert.equal(controller.dispatch({ type: 'state', value: 'listening' }), true);
  assert.equal(controller.getSnapshot().state, 'listening');
});
