const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { TargetAnimationPlayer, decodeAnimation } = require('../src/animation/target-animation-player.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');

async function create() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 99 });
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  return { world, player };
}

function active(frame) {
  let count = 0;
  for (let i = 2; i < frame.length; i += 3) if (frame[i]) count++;
  return count;
}

test('les 43 poses conservent chaque pixel visible, avec sa propre population', async () => {
  const { world, player } = await create();
  assert.equal(PERSONA_IDLE_TARGETS.frameCount, 43);
  assert.equal(PERSONA_IDLE_TARGETS.durationMs, 1720);
  assert.equal(world.sourceParticleCount, 15886);
  assert.equal(world.particles.length, 16162);
  assert.equal(Math.min(...PERSONA_IDLE_TARGETS.frameActiveCounts), 13623);
  assert.equal(Math.max(...PERSONA_IDLE_TARGETS.frameActiveCounts), 16103);
  for (let index = 0; index < 43; index++) {
    const frame = player.frames[index];
    assert.equal(active(frame), PERSONA_IDLE_TARGETS.frameActiveCounts[index]);
    const pixels = new Set();
    for (let offset = 0; offset < frame.length; offset += 3) {
      if (!frame[offset + 2]) continue;
      const id = (frame[offset + 1] << 8) + frame[offset];
      assert.equal(pixels.has(id), false, `duplicate pixel in frame ${index + 1}`);
      pixels.add(id);
    }
  }
});

test('inspecter une frame affiche exactement sa population sans en créer de nouvelles', async () => {
  const { world, player } = await create();
  const pool = [...world.particles];
  for (const frame of [0, 19, 31, 42]) {
    player.inspectFrame(frame);
    assert.equal(world.visibleParticleCount, PERSONA_IDLE_TARGETS.frameActiveCounts[frame]);
    const buffer = new Uint8ClampedArray(world.size * world.size * 4);
    world.writePixels(buffer);
    let rendered = 0;
    for (let i = 3; i < buffer.length; i += 4) if (buffer[i]) rendered++;
    assert.equal(rendered, PERSONA_IDLE_TARGETS.frameActiveCounts[frame]);
    assert.ok(pool.every((particle, index) => particle === world.particles[index]));
  }
});

test('les naissances et disparitions progressent entre deux poses sans téléporter les points conservés', async () => {
  const { world, player } = await create();
  player.inspectFrame(1); // Frame 2 has fewer pixels than frame 3.
  const was = player.frames[1];
  const will = player.frames[2];
  const newborn = world.particles.findIndex((_, index) =>
    was[index * 3 + 2] === 0 && will[index * 3 + 2] !== 0);
  assert.ok(newborn >= 0);
  player.resume();
  player.advance(0.02);
  assert.equal(player.frame, 1);
  assert.ok(world.particles[newborn].activity > 0 && world.particles[newborn].activity < 1);
  const offset = newborn * 3;
  assert.equal(world.particles[newborn].x, world.originX + will[offset]);
  assert.equal(world.particles[newborn].y, world.originY + will[offset + 1]);
  assert.equal(world.particles[newborn].vx, 0);
});

test('un plafond de qualité garde le même pool et limite exactement les pixels actifs', async () => {
  const { world, player } = await create();
  const original = world.particles.slice();
  assert.equal(player.setParticleCount(8000), true);
  for (const frame of player.frames) assert.equal(active(frame), 8000);
  player.inspectFrame(31);
  assert.equal(world.visibleParticleCount, 8000);
  assert.equal(world.densityLimit, 8000);
  assert.equal(player.setParticleCount('auto'), true);
  assert.equal(world.visibleParticleCount, 16103);
  assert.equal(world.densityLimit, null);
  assert.deepEqual(world.particles, original);
  assert.strictEqual(player.frames[31], player.fullFrames[31]);
});

test('les 43 poses restent identiques à travers les changements de qualité et de vitesse', async () => {
  const { world, player } = await create();
  const sources = player.fullFrames.slice();
  player.setSpeed(2);
  player.play();
  player.setParticleCount(2000);
  player.advance(0.03);
  player.setParticleCount('auto');
  assert.equal(player.frames.length, 43);
  assert.deepEqual(player.fullFrames, sources);
  assert.equal(world.particles.length, PERSONA_IDLE_TARGETS.particleCount);
  assert.equal(player.getSnapshot().playbackDurationMs, 860);
});

test('un pool mal défini est rejeté avant toute allocation supplémentaire', async () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_IDLE_TARGETS, extraSources: [0] }, world),
    /Métadonnées/
  );
  assert.equal(world.particles.length, 15886);
  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_IDLE_TARGETS, frameActiveCounts: Array(43).fill(100) }, world),
    /Population incohérente/
  );
  assert.equal(world.particles.length, 15886);
});
