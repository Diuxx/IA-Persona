const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { TargetAnimationPlayer } = require('../src/animation/target-animation-player.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');

async function setup() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 10 });
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  return { world, player };
}

test('le ZIP original des 43 poses est conservé avec les ressources', () => {
  const source = path.join(__dirname, '../assets/animations/idle-frames.zip');
  assert.ok(fs.statSync(source).size > 100_000);
  assert.equal(PERSONA_IDLE_TARGETS.sourceFrames, 43);
  assert.equal(PERSONA_IDLE_TARGETS.frameCount, 43);
  assert.equal(PERSONA_IDLE_TARGETS.durationMs, 1720);
});

test('une pose idle figée reste immobile sans ondulation ni retour physique parasite', async () => {
  const { world, player } = await setup();
  player.inspectFrame(8);
  const baseline = world.particles.map(particle => [particle.x, particle.y]);
  for (let step = 0; step < 60; step++) world.step(1 / 60);
  const drift = world.particles.reduce((worst, particle, index) =>
    Math.max(worst, Math.hypot(particle.x - baseline[index][0], particle.y - baseline[index][1])), 0);
  assert.ok(drift < 0.0001, `les poses de référence ne doivent pas dériver : ${drift}`);
});

test('une pose cible contient déjà le visage : aucun deuxième clignement automatique', async () => {
  const { world, player } = await setup();
  player.inspectFrame(0);
  const before = new Uint8ClampedArray(world.size ** 2 * 4);
  world.writePixels(before);
  world.blinkStartedAt = world.clock - 0.1;
  const after = new Uint8ClampedArray(before.length);
  world.writePixels(after);
  assert.deepEqual(after, before, 'les pixels blancs restent ceux de la pose source');
});
