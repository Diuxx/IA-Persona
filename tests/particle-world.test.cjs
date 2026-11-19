const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld, decodePixelMap } = require('../src/engine/particle-world.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');

function world(random = () => 0.5) {
  return new ParticleWorld(PERSONA_PIXEL_MAP, { random });
}

test('décodage RLE : les pixels visibles ont un ancrage et une palette', () => {
  const decoded = decodePixelMap(PERSONA_PIXEL_MAP);
  assert.equal(decoded.pixels.length, PERSONA_PIXEL_MAP.count);
  assert.ok(decoded.pixels.length > 10000);
  assert.equal(decoded.occupancy.length, 40000);
});

test('la simulation conserve un nombre fixe de particules', () => {
  const model = world();
  const before = model.particles.length;
  model.reveal();
  for (let n = 0; n < 120; n++) model.step(1 / 60);
  model.explode();
  for (let n = 0; n < 120; n++) model.step(1 / 60);
  assert.equal(model.particles.length, before);
  assert.ok(model.particles.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('révélation : des points colorés s’éloignent puis redeviennent gris/noirs', () => {
  const model = world();
  model.reveal();
  assert.equal(model.mode, 'reveal');
  assert.equal(model.colorMix, 1);
  assert.ok(model.particles.some((p) => Math.abs(p.x - p.homeX) > 20));
  for (let n = 0; n < 210; n++) model.step(1 / 60);
  assert.equal(model.mode, 'idle');
  assert.equal(model.colorMix, 0);
  const frame = new Uint8ClampedArray(model.size ** 2 * 4);
  model.writePixels(frame);
  assert.ok(frame.some((v) => v > 0));
});

test('explosion : une impulsion affecte les vitesses, puis le ressort ramène les points', () => {
  const model = world();
  model.explode();
  assert.ok(model.particles.some((p) => Math.hypot(p.vx, p.vy) > 100));
  const before = model.particles.reduce((sum, p) => sum + Math.hypot(p.x - p.homeX, p.y - p.homeY), 0);
  for (let n = 0; n < 20; n++) model.step(1 / 60);
  const scattered = model.particles.reduce((sum, p) => sum + Math.hypot(p.x - p.homeX, p.y - p.homeY), 0);
  assert.ok(scattered > before);
  for (let n = 0; n < 180; n++) model.step(1 / 60);
  const settled = model.particles.reduce((sum, p) => sum + Math.hypot(p.x - p.homeX, p.y - p.homeY), 0);
  assert.ok(settled < scattered / 3);
});

test('pause : les positions, horloges et couleurs ne progressent pas', () => {
  const model = world();
  model.reveal();
  const first = model.particles[0];
  const state = [first.x, first.y, model.clock, model.colorMix];
  model.paused = true;
  model.step(1);
  assert.deepEqual([first.x, first.y, model.clock, model.colorMix], state);
  assert.equal(model.explode(), false);
});

test('pixel hit-test sans accès au Canvas, et valeurs de réglages validées', () => {
  const model = world();
  const eye = model.particles.find((p) => p.eye);
  assert.ok(eye);
  assert.equal(model.hitTest(eye.homeX, eye.homeY), true);
  assert.equal(model.hitTest(-10, -10), false);
  assert.throws(() => model.setAccent('untrusted'), RangeError);
  assert.throws(() => model.setElasticity(100), RangeError);
  assert.throws(() => model.setDispersion(0), RangeError);
  model.setAccent('#00ff66');
  assert.deepEqual(model.accent, [0, 255, 102]);
});

test('le tampon RGBA respecte la palette et les couleurs de transformation', () => {
  const model = world();
  const frame = new Uint8ClampedArray(model.size ** 2 * 4);
  model.writePixels(frame);
  const eye = model.particles.find((p) => p.eye);
  const index = (Math.round(eye.y) * model.size + Math.round(eye.x)) * 4;
  assert.ok(frame[index] >= 200);
  model.reveal();
  model.writePixels(frame);
  assert.ok(frame.some((v, i) => i % 4 === 2 && v > 100));
  assert.throws(() => model.writePixels(new Uint8ClampedArray(4)), RangeError);
});

test('une carte corrompue provoque une erreur explicite', () => {
  assert.throws(() => decodePixelMap({ width: 200, height: 200, palette: [], runs: 'AA==' }), /tronqu/);
  assert.throws(() => new ParticleWorld(PERSONA_PIXEL_MAP, { size: 10 }), RangeError);
});
