const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HitController } = require('../hit-controller.js');

test('une réaction commence au clic et revient à une pose neutre', () => {
  const hit = new HitController();
  assert.equal(hit.poseAt(0).active, false);
  assert.equal(hit.trigger(2), true);
  assert.equal(hit.poseAt(2).active, true);
  assert.equal(hit.poseAt(3.15).active, false);
  assert.equal(hit.poseAt(3.15).eyeOpen, 0);
});

test('le corps se tasse puis s’étire, et l’œil s’ouvre', () => {
  const hit = new HitController();
  hit.trigger(0);
  assert.ok(hit.poseAt(0.115).squash > 0.95);
  assert.ok(hit.poseAt(0.391).stretch > 0.95);
  assert.ok(hit.poseAt(0.391).eyeOpen > 0.95);
  assert.ok(hit.poseAt(0.598).scatter > 0.7);
});

test('le second clic ne relance pas une animation en cours', () => {
  const hit = new HitController();
  assert.equal(hit.trigger(0), true);
  assert.equal(hit.trigger(0.6), false);
  assert.equal(hit.startedAt, 0);
  assert.equal(hit.trigger(1.16), true);
});

test('les poses interpolées restent toujours dans la plage attendue', () => {
  const hit = new HitController();
  hit.trigger(2);
  for (let i = 0; i < 115; i++) {
    const pose = hit.poseAt(2 + i / 100);
    for (const value of [pose.squash, pose.stretch, pose.scatter, pose.eyeOpen]) {
      assert.ok(value >= 0 && value <= 1);
    }
  }
});

test('une configuration ou une activation invalide est rejetée', () => {
  assert.throws(() => new HitController({ duration: 0 }), RangeError);
  assert.throws(() => new HitController({ duration: Infinity }), RangeError);
  const hit = new HitController();
  assert.equal(hit.trigger(NaN), false);
  assert.equal(hit.trigger(-1), false);
});
