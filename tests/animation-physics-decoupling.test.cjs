const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { TargetAnimationPlayer } = require('../src/animation/target-animation-player.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');
const { PERSONA_LEFT_TARGETS } = require('../assets/animations/left-targets.js');
const { PERSONA_RIGHT_TARGETS } = require('../assets/animations/right-targets.js');

const DT = 1 / 60;
function createWorld() {
  return new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
}

function staticPose(world, translation = 0) {
  const frame = new Int16Array(world.particles.length * 3);
  for (let i = 0; i < world.particles.length; i++) {
    const p = world.particles[i];
    frame[i * 3] = p.homeX - world.originX + translation;
    frame[i * 3 + 1] = p.homeY - world.originY;
    frame[i * 3 + 2] = p.eye ? 3 : 1;
  }
  return { from: frame, to: frame, blend: 0 };
}

function step(world, count = 1) {
  for (let i = 0; i < count; i++) world.step(DT);
}

test('legacy remains default and switches preserve positions and velocities', () => {
  const world = createWorld();
  assert.equal(world.animationTracking, 'legacy');
  world.setTargetPose(staticPose(world));
  world.reveal();
  const p = world.particles[0];
  const before = [p.x, p.y, p.vx, p.vy];
  assert.equal(world.setAnimationTracking('decoupled'), true);
  assert.deepEqual([p.x, p.y, p.vx, p.vy], before);
  assert.equal(world.mode, 'reveal');
  const error = world.getTrackingDiagnostics().meanErrorPx;
  step(world);
  assert.ok(world.getTrackingDiagnostics().meanErrorPx > error * 0.8,
    'switching during reveal must not erase physical displacement');
  assert.equal(world.setAnimationTracking('decoupled'), false);
  assert.throws(() => world.setAnimationTracking('invalid'), RangeError);
  assert.equal(world.setAnimationTracking('legacy'), true);
});

test('decoupled particles track a moving anchor exactly without an interaction', () => {
  const world = createWorld();
  world.setAnimationTracking('decoupled');
  world.setTargetPose(staticPose(world));
  world.snapToTargetPose();
  for (let i = 1; i <= 12; i++) {
    world.setTargetPose(staticPose(world, i * 3));
    step(world);
    assert.equal(world.getTrackingDiagnostics().maxErrorPx, 0);
    assert.equal(world.lastTrackingLimitedCount, 0);
  }
  assert.ok(world.particles.every(p => p.vx === 0 && p.vy === 0));
});

test('the safety cap remains active on a large reference displacement', () => {
  const world = createWorld();
  world.setAnimationTracking('decoupled');
  world.setTargetPose(staticPose(world));
  world.snapToTargetPose();
  const p = world.particles[0];
  const x = p.x;
  world.setTargetPose(staticPose(world, 60));
  step(world);
  assert.ok(Math.abs(p.x - x - 11.5) < 1e-8);
  assert.equal(world.lastTrackingLimitedCount, world.particles.length);
  assert.ok(world.getTrackingDiagnostics().meanErrorPx > 40);
  step(world, 180);
  assert.ok(world.getTrackingDiagnostics().meanErrorPx < 0.1);
});

test('physical impulses displace particles relative to the moving animation and recover', () => {
  const world = createWorld();
  world.setAnimationTracking('decoupled');
  world.setTargetPose(staticPose(world));
  world.snapToTargetPose();
  world.applyField({ x: 200, y: 200, radius: 180, strength: 220 });
  step(world, 8);
  const displaced = world.getTrackingDiagnostics().meanErrorPx;
  assert.ok(displaced > 1);
  for (let i = 0; i < 180; i++) {
    world.setTargetPose(staticPose(world, i % 2 === 0 ? 2 : 4));
    step(world);
  }
  assert.ok(world.getTrackingDiagnostics().meanErrorPx < displaced / 10);
  world.explode();
  step(world, 15);
  assert.ok(world.getTrackingDiagnostics().meanErrorPx > 1);
  step(world, 240);
  assert.equal(world.mode, 'idle');
  assert.ok(world.getTrackingDiagnostics().meanErrorPx < 0.5);
  world.reveal();
  assert.ok(world.getTrackingDiagnostics().meanErrorPx > 10);
  step(world, 300);
  assert.equal(world.mode, 'idle');
  assert.ok(world.getTrackingDiagnostics().meanErrorPx < 0.5);
});

test('inspection, pause, stop and reset retain their contracts', async () => {
  const world = createWorld();
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  const controller = new BehaviorController(world, { animationPlayer: player });
  controller.dispatch({ type: 'animation', name: 'idle' });
  controller.dispatch({ type: 'animation', action: 'tracking', value: 'decoupled' });
  controller.dispatch({ type: 'animation', action: 'seek', frame: 42 });
  assert.equal(world.getTrackingDiagnostics().maxErrorPx, 0);
  assert.equal(world.visibleParticleCount, PERSONA_IDLE_TARGETS.frameActiveCounts[42]);
  controller.dispatch({ type: 'animation', action: 'resume' });
  world.paused = true;
  const time = player.elapsed;
  const before = world.particles.map(p => [p.x, p.y]);
  controller.advance(DT);
  step(world);
  assert.equal(player.elapsed, time);
  assert.deepEqual(world.particles.map(p => [p.x, p.y]), before);
  world.paused = false;
  controller.dispatch({ type: 'animation', action: 'stop' });
  assert.equal(world.getTrackingDiagnostics().meanErrorPx, null);
  controller.reset();
  assert.ok(world.particles.every(p => p.animationAnchorX === null));
  assert.equal(controller.getSnapshot().animationTracking, 'decoupled');
});

test('decoupled real clips keep the pool and bound continuously visible identities', async () => {
  const world = createWorld();
  const [idle, left, right] = await TargetAnimationPlayer.createClips(
    world, [PERSONA_IDLE_TARGETS, PERSONA_LEFT_TARGETS, PERSONA_RIGHT_TARGETS]);
  const controller = new BehaviorController(world, { animationPlayer: idle, animationPlayers: [left, right] });
  const pool = world.particles;
  controller.dispatch({ type: 'animation', action: 'tracking', value: 'decoupled' });
  controller.dispatch({ type: 'animation', name: 'idle' });
  world.snapToTargetPose();
  const previous = new Float64Array(pool.length * 3);
  for (const name of ['idle', 'left', 'right']) {
    controller.dispatch({ type: 'animation', name });
    for (let stepIndex = 0; stepIndex < 180; stepIndex++) {
      for (let i = 0; i < pool.length; i++) {
        previous[i*3] = pool[i].x;
        previous[i*3+1] = pool[i].y;
        previous[i*3+2] = pool[i].activity ?? 0;
      }
      controller.advance(DT);
      world.step(DT);
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (previous[i*3+2] <= 0 || !(p.activity > 0)) continue;
        assert.ok(Math.hypot(p.x-previous[i*3], p.y-previous[i*3+1]) <= 11.500001,
          name + ': identity ' + i + ' at step ' + stepIndex);
      }
    }
    assert.equal(controller.animationPlayer, idle);
    assert.equal(world.particles, pool);
  }
});
