const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HitController } = require('../hit-controller.js');

test('la réaction échantillonne exactement huit frames de 120 ms', () => {
  const hit = new HitController();
  assert.equal(hit.trigger(2), true);
  assert.equal(hit.sampleAt(2).frame, 0);
  assert.equal(hit.sampleAt(2.12).frame, 1);
  assert.equal(hit.sampleAt(2.36).frame, 3);
  assert.equal(hit.sampleAt(2.84).frame, 7);
  assert.equal(hit.sampleAt(2.96).active, false);
});

test('le clic pendant la réaction est ignoré, puis une nouvelle réaction peut démarrer', () => {
  const hit = new HitController();
  assert.equal(hit.trigger(0), true);
  assert.equal(hit.trigger(0.4), false);
  assert.equal(hit.trigger(0.97), true);
});

test('les premières et dernières images se fondent avec l’idle', () => {
  const hit = new HitController();
  hit.trigger(1);
  assert.equal(hit.sampleAt(1).opacity, 0);
  assert.equal(hit.sampleAt(1.2).opacity, 1);
  assert.ok(hit.sampleAt(1.93).opacity < 1);
});

test('la transition entre deux images conserve des indices valides', () => {
  const hit = new HitController();
  hit.trigger(1);
  for (let step = 0; step < 96; step += 1) {
    const state = hit.sampleAt(1 + step / 100);
    assert.ok(state.frame >= 0 && state.frame < 8);
    assert.ok(state.nextFrame >= state.frame && state.nextFrame < 8);
    assert.ok(state.blend >= 0 && state.blend <= 1);
    assert.ok(state.opacity >= 0 && state.opacity <= 1);
  }
});

test('les paramètres invalides sont rejetés', () => {
  assert.throws(() => new HitController({ frameCount: 1 }), RangeError);
  assert.throws(() => new HitController({ frameDuration: 0 }), RangeError);
  assert.throws(() => new HitController({ fadeIn: -1 }), RangeError);
  assert.throws(() => new HitController({ fadeIn: 1, fadeOut: 1 }), RangeError);
  assert.equal(new HitController().trigger(NaN), false);
});

// Contrôle des pauses : le contrôleur ne dépend que du temps d'animation transmis.
test('une horloge qui ne progresse pas conserve exactement la même image', () => {
  const hit = new HitController();
  hit.trigger(0);
  assert.deepEqual(hit.sampleAt(0.22), hit.sampleAt(0.22));
});
