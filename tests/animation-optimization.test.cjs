const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { TargetAnimationPlayer } = require('../src/animation/target-animation-player.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { PixelStabilizer } = require('../src/animation/pixel-stabilizer.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');

async function create() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  const controller = new BehaviorController(world, { animationPlayer: player });
  return { world, player, controller };
}

test('la vitesse change le timing sans retirer aucune des 43 frames', async () => {
  const { world, player, controller } = await create();
  controller.dispatch({ type: 'animation', action: 'speed', value: 2 });
  assert.equal(player.getSnapshot().frameCount, 43);
  assert.equal(player.getSnapshot().playbackDurationMs, 860);
  player.play();
  player.advance(0.02);
  assert.equal(player.frame, 1);
  assert.equal(world.particles.length, PERSONA_IDLE_TARGETS.particleCount);
  controller.dispatch({ type: 'animation', action: 'speed', value: 0.5 });
  assert.equal(player.getSnapshot().playbackDurationMs, 3440);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'speed', value: 0 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'speed', value: 5 }), RangeError);
});

test('la densité fixe un plafond sans recréer les particules ni retirer de frames', async () => {
  const { world, player, controller } = await create();
  const original = [...world.particles];
  player.play();
  controller.dispatch({ type: 'animation', action: 'particle-count', count: 4000 });
  assert.equal(world.particles.length, PERSONA_IDLE_TARGETS.particleCount);
  assert.deepEqual(world.particles, original);
  assert.equal(player.getSnapshot().densityLimit, 4000);
  assert.equal(player.frames.length, 43);
  assert.ok(player.frames.every(frame => frame.length === world.particles.length * 3));
  for (let index = 0; index < 43; index += 1) {
    const visible = player.frames[index].reduce((count, value, offset) =>
      count + (offset % 3 === 2 && value !== 0 ? 1 : 0), 0);
    assert.equal(visible, 4000, `frame ${index + 1}`);
  }
  player.inspectFrame(12);
  assert.equal(world.visibleParticleCount, 4000);
  assert.equal(controller.getSnapshot().particleCount, 4000);
  assert.ok(world.particles.some(p => p.eye && p.activity > 0));
});

test('la densité auto restitue chaque population source et les rôles restent intacts', async () => {
  const { world, player, controller } = await create();
  const original = [...world.particles];
  player.inspectFrame(42);
  controller.dispatch({ type: 'animation', action: 'particle-count', count: 2000 });
  assert.equal(world.visibleParticleCount, 2000);
  assert.equal(player.frame, 42);
  assert.equal(player.inspecting, true);
  assert.ok(world.roles.has(world.particles.find(p => p.eye && p.activity > 0), 'gaze'));
  controller.dispatch({ type: 'animation', action: 'particle-count', count: 'auto' });
  assert.equal(world.visibleParticleCount, PERSONA_IDLE_TARGETS.frameActiveCounts[42]);
  assert.deepEqual(world.particles, original);
  assert.equal(world.cohesionField.linkCount, 31220);
  assert.ok(player.frames.every((frame, i) => frame === player.fullFrames[i]));
  assert.equal(world.targetPose.from, player.frames[42]);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'particle-count', count: 100 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'particle-count', count: 99999 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'particle-count', count: 8000.5 }), RangeError);
});

test('le filtre amortit une disparition momentanée sans changer les poses sources', () => {
  const filter = new PixelStabilizer(8, 2);
  const first = new Uint8ClampedArray([7, 7, 7, 255, 224, 224, 222, 255]);
  filter.apply(first, 1 / 60);
  const next = new Uint8ClampedArray([0, 0, 0, 0, 224, 224, 222, 255]);
  filter.apply(next, 1 / 60);
  assert.ok(next[3] > 0 && next[3] < 255, 'le pixel disparaît progressivement');
  assert.equal(next[7], 255, 'le pixel encore visible reste opaque');
  filter.reset();
  const exact = new Uint8ClampedArray(8);
  filter.apply(exact, 1 / 60, false);
  assert.equal(exact[3], 0, 'une frame inspectée doit rester parfaitement exacte');
  assert.throws(() => filter.apply(exact, NaN), RangeError);
});

test('la stabilisation ne laisse pas de fantôme loin de la silhouette actuelle', () => {
  const filter = new PixelStabilizer(4 * 5, 5);
  const initial = new Uint8ClampedArray(20);
  initial[0] = 8;
  initial[3] = 255;
  filter.apply(initial, 1 / 60);
  const shifted = new Uint8ClampedArray(20);
  shifted[16] = 8;
  shifted[19] = 255;
  filter.apply(shifted, 1 / 60);
  assert.equal(shifted[3], 0, 'les particules éloignées doivent disparaître immédiatement');
  assert.equal(shifted[19], 255, 'la nouvelle silhouette apparaît sans retard');
});
