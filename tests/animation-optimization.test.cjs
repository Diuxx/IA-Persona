const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../particle-world.js');
const { TargetAnimationPlayer } = require('../target-animation-player.js');
const { BehaviorController } = require('../behavior-controller.js');
const { PixelStabilizer } = require('../pixel-stabilizer.js');
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
  assert.equal(player.frames.length, 43);
  assert.equal(world.particles.length, 15886);
  controller.dispatch({ type: 'animation', action: 'speed', value: 0.5 });
  assert.equal(player.getSnapshot().playbackDurationMs, 3440);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'speed', value: 0 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'speed', value: 5 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'speed', value: 'fast' }), RangeError);
});

test('la densité réduit les points vraiment simulés et conserve les 43 poses', async () => {
  const { world, player, controller } = await create();
  const originalEye = world.particles.filter(p => p.eye).length;
  player.play();
  assert.equal(controller.dispatch({ type: 'animation', action: 'particle-count', count: 4000 }), true);
  assert.equal(world.particles.length, 4000);
  assert.equal(controller.getSnapshot().particleCount, 4000);
  assert.equal(world.cohesionField.counts.length, 4000);
  assert.ok(world.cohesionField.linkCount > 0);
  assert.ok(world.particles.filter(p => p.eye).length > 0);
  assert.ok(world.particles.filter(p => p.eye).length < originalEye);
  assert.equal(player.frames.length, 43);
  assert.ok(player.frames.every(f => f.length === 4000 * 3));
  assert.equal(world.targetPose.from.length, 4000 * 3);
  for (let frame = 0; frame < 43; frame += 1) {
    for (const index of [0, 500, 3999]) {
      const sourceIndex = world.particles[index].sourceIndex;
      assert.deepEqual(
        [...player.frames[frame].subarray(index * 3, index * 3 + 3)],
        [...player.fullFrames[frame].subarray(sourceIndex * 3, sourceIndex * 3 + 3)]
      );
    }
  }
  for (let i = 0; i < 30; i += 1) {
    controller.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.ok(world.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('densité réversible sans perte de rôles, suivi ni pixels sources', async () => {
  const { world, player, controller } = await create();
  const original = [...world.particles];
  player.inspectFrame(42);
  controller.dispatch({ type: 'animation', action: 'particle-count', count: 2000 });
  assert.equal(player.frame, 42);
  assert.equal(player.inspecting, true);
  assert.ok(world.roles.has(world.particles.find(p => p.eye), 'gaze'));
  assert.equal(world.particles.length, 2000);
  controller.dispatch({ type: 'animation', action: 'particle-count', count: 15886 });
  assert.equal(world.particles.length, 15886);
  assert.deepEqual(world.particles, original);
  assert.equal(world.cohesionField.linkCount, 31220);
  assert.ok(player.frames.every((frame, i) => frame === player.fullFrames[i] ||
    frame.every((v, offset) => v === player.fullFrames[i][offset])));
  assert.equal(world.targetPose.from, player.frames[42]);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'particle-count', count: 100 }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'particle-count', count: 15887 }), RangeError);
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
