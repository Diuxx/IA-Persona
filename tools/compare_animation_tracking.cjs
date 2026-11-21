/** Offline comparison of both tracking modes against their own direct interpolated target raster. */
'use strict';
const { performance } = require('node:perf_hooks');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { TargetAnimationPlayer } = require('../src/animation/target-animation-player.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');
const { PERSONA_LEFT_TARGETS } = require('../assets/animations/left-targets.js');
const { PERSONA_RIGHT_TARGETS } = require('../assets/animations/right-targets.js');

const DT = 1/60;

function targetOverlap(world, rgba, mask) {
  mask.fill(0);
  for (let i = 0; i < world.particles.length; i++) {
    if (!(world.particles[i].activity > 0)) continue;
    const x = Math.round(world.targetCoordinate(world.targetPose, i*3, 0));
    const y = Math.round(world.targetCoordinate(world.targetPose, i*3, 1));
    if (x >= 0 && x < world.size && y >= 0 && y < world.size) mask[y*world.size+x] = 1;
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < mask.length; i++) {
    const visible = rgba[i*4+3] > 0;
    if (visible || mask[i]) union++;
    if (visible && mask[i]) intersection++;
  }
  return union ? intersection / union : 1;
}

async function measure(mode, name) {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  const [idle, left, right] = await TargetAnimationPlayer.createClips(
    world, [PERSONA_IDLE_TARGETS, PERSONA_LEFT_TARGETS, PERSONA_RIGHT_TARGETS]);
  const controller = new BehaviorController(world, { animationPlayer: idle, animationPlayers: [left, right] });
  controller.dispatch({ type: 'animation', action: 'tracking', value: mode });
  controller.dispatch({ type: 'animation', name: 'idle' });
  world.snapToTargetPose();
  // Same starting phase and duration for both methods. Exclude one-shot handover from clip metrics.
  for (let i = 0; i < 18; i++) { controller.advance(DT); world.step(DT); }
  if (name !== 'idle') controller.dispatch({ type: 'animation', name });
  const rgba = new Uint8ClampedArray(world.size ** 2 * 4);
  const mask = new Uint8Array(world.size ** 2);
  const steps = name === 'idle' ? Math.ceil(1.72 / DT) : Math.ceil(2.16 / DT);
  const totals = { meanErrorPx: 0, maxErrorPx: 0, collisions: 0, limitedCount: 0,
    targetIoU: 0, simulationMs: 0, renderingMs: 0 };
  let samples = 0;
  for (let i = 0; i < steps; i++) {
    const start = performance.now();
    controller.advance(DT);
    world.step(DT);
    const middle = performance.now();
    if (controller.animationPlayer.animation.name !== name) break;
    world.writePixels(rgba);
    const end = performance.now();
    const errors = world.getTrackingDiagnostics();
    totals.meanErrorPx += errors.meanErrorPx;
    totals.maxErrorPx = Math.max(totals.maxErrorPx, errors.maxErrorPx);
    totals.collisions += world.lastCollisionCount;
    totals.limitedCount += errors.limitedCount;
    totals.targetIoU += targetOverlap(world, rgba, mask);
    totals.simulationMs += middle - start;
    totals.renderingMs += end - middle;
    samples++;
  }
  if (!samples) throw new Error('No samples: ' + name);
  return { samples, ...Object.fromEntries(Object.entries(totals).map(([key, value]) =>
    [key, Number((key === 'maxErrorPx' ? value : value/samples).toFixed(4))])) };
}

async function main() {
  const report = {};
  for (const name of ['idle', 'left', 'right']) {
    report[name] = {};
    for (const mode of ['legacy', 'decoupled']) report[name][mode] = await measure(mode, name);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
