const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');
const { generateProfile } = require('../tools/analyze_motion.cjs');

test('l’idle V2.5 fournit un profil complet sur 43 frames et 11 régions', () => {
  const profile = generateProfile(PERSONA_IDLE_TARGETS);
  assert.equal(profile.animation.frameCount, 43);
  assert.equal(profile.animation.frameDurationMs, 40);
  assert.equal(profile.animation.durationMs, 1720);
  assert.deepEqual(profile.animation.canvasSize, [200, 200]);
  assert.equal(profile.population.capacity, 16162);
  assert.equal(profile.population.originalCapacity, 15886);
  assert.equal(profile.population.minVisible, 13623);
  assert.equal(profile.population.maxVisible, 16103);
  assert.equal(profile.frames.length, 43);
  assert.equal(profile.transitions.length, 43);
  assert.equal(Object.keys(profile.regionSummaries).length, 11);
  assert.ok(profile.frames.every((frame, index) =>
    frame.visibleCount === PERSONA_IDLE_TARGETS.frameActiveCounts[index]));
  assert.equal(profile.timing.seam.fromFrame, 43);
  assert.equal(profile.timing.seam.toFrame, 1);
  assert.ok(profile.timing.seam.silhouetteIoU > 0);
  assert.ok(profile.globalMotion.centerAmplitudePx >= 0);
  assert.equal(profile.annotations.validatedByHuman, false);
});
