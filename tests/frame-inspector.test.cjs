const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../particle-world.js');
const { TargetAnimationPlayer } = require('../target-animation-player.js');
const { BehaviorController } = require('../behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');

async function setup() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 42 });
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  const controller = new BehaviorController(world, { animationPlayer: player });
  return { world, player, controller };
}

test('le lecteur expose 43 frames de 40 ms et une boucle complète de 1,72 s', async () => {
  const { player } = await setup();
  const snap = player.getSnapshot();
  assert.equal(snap.frameCount, 43);
  assert.equal(snap.frameDurationMs, 40);
  assert.equal(snap.loopEndFrame, 42);
  assert.equal(snap.playbackDurationMs, 1720);
  assert.equal(snap.inspecting, false);
});

test('le curseur fige une pose exacte et garde les identités de toutes les particules', async () => {
  const { world, controller, player } = await setup();
  const particles = world.particles;
  const eye = particles.find(p => p.eye);
  const sameMaterial = eye.material;
  controller.dispatch({ type: 'animation', action: 'seek', frame: 17 });
  assert.equal(player.playing, true);
  assert.equal(player.inspecting, true);
  assert.equal(player.frame, 17);
  assert.equal(player.elapsed, 17 * 0.04);
  assert.equal(world.targetPose.from, player.frames[17]);
  assert.equal(world.targetPose.to, player.frames[17]);
  assert.equal(world.targetPose.blend, 0);
  assert.equal(world.particles, particles);
  assert.equal(eye.material, sameMaterial);
  for (const index of [0, 1, 200, 5000, 15885]) {
    const particle = particles[index];
    assert.equal(particle.x, world.originX + player.frames[17][index * 3]);
    assert.equal(particle.y, world.originY + player.frames[17][index * 3 + 1]);
    assert.equal(particle.vx, 0);
    assert.equal(particle.vy, 0);
  }
  controller.advance(3);
  assert.equal(player.frame, 17, 'l’inspection ne doit pas avancer');
});

test('figer et reprendre continue depuis la frame sélectionnée', async () => {
  const { controller, player } = await setup();
  controller.dispatch({ type: 'animation', name: 'idle' });
  controller.advance(0.97);
  assert.equal(player.frame, 24);
  assert.equal(controller.dispatch({ type: 'animation', action: 'pause' }), true);
  assert.equal(player.inspecting, true);
  assert.equal(player.elapsed, 24 * 0.04);
  assert.equal(controller.dispatch({ type: 'animation', action: 'pause' }), false);
  controller.advance(1);
  assert.equal(player.frame, 24);
  assert.equal(controller.dispatch({ type: 'animation', action: 'resume' }), true);
  assert.equal(player.inspecting, false);
  controller.advance(0.04);
  assert.equal(player.frame, 25);
  assert.equal(controller.dispatch({ type: 'animation', action: 'resume' }), false);
});

test('une boucle raccourcie revient à la frame 1, mais toutes les autres restent inspectables', async () => {
  const { controller, player } = await setup();
  controller.dispatch({ type: 'animation', action: 'loop-end', frame: 17 });
  assert.equal(player.getSnapshot().playbackDurationMs, 720);
  controller.dispatch({ type: 'animation', name: 'idle' });
  controller.advance(0.76);
  assert.equal(player.frame, 1);
  controller.dispatch({ type: 'animation', action: 'seek', frame: 41 });
  assert.equal(player.frame, 41);
  assert.equal(player.getSnapshot().loopEndFrame, 17);
  controller.dispatch({ type: 'animation', action: 'resume' });
  assert.equal(player.frame, 0, 'reprendre une frame hors boucle redémarre la sélection');
});

test('une réduction de boucle pendant la lecture repositionne proprement la tête de lecture', async () => {
  const { controller, player } = await setup();
  controller.dispatch({ type: 'animation', name: 'idle' });
  controller.advance(1.4);
  controller.dispatch({ type: 'animation', action: 'loop-end', frame: 9 });
  assert.equal(player.frame, 0);
  assert.equal(player.getSnapshot().playbackDurationMs, 400);
  controller.advance(0.09);
  assert.equal(player.frame, 2);
});

test('l’inspection montre la pose de référence, sans couleur d’impact résiduelle', async () => {
  const { world, controller, player } = await setup();
  controller.dispatch({ type: 'animation', name: 'idle' });
  world.explode();
  assert.equal(world.colorMix, 1);
  controller.dispatch({ type: 'animation', action: 'seek', frame: 3 });
  assert.equal(world.mode, 'idle');
  assert.equal(world.colorMix, 0);
  assert.equal(player.frame, 3);
  assert.equal(world.targetPose.blend, 0);
});

test('arrêter la lecture ou changer d’état libère l’inspection sans perdre les particules', async () => {
  const { world, controller, player } = await setup();
  controller.dispatch({ type: 'animation', action: 'seek', frame: 9 });
  assert.equal(controller.dispatch({ type: 'animation', action: 'stop' }), true);
  assert.equal(player.inspecting, false);
  assert.equal(world.targetPose, null);
  controller.dispatch({ type: 'animation', action: 'seek', frame: 4 });
  controller.dispatch({ type: 'state', value: 'thinking' });
  assert.equal(player.playing, false);
  assert.equal(world.targetPose, null);
  assert.equal(world.particles.length, PERSONA_IDLE_TARGETS.particleCount);
});

test('la passerelle rejette les frames invalides et les actions non autorisées', async () => {
  const { controller, player } = await setup();
  for (const frame of [-1, 43, NaN, 3.5, Infinity, '3']) {
    assert.throws(() => controller.dispatch({ type: 'animation', action: 'seek', frame }), RangeError);
  }
  for (const frame of [0, 43, -1, 3.5]) {
    assert.throws(() => controller.dispatch({ type: 'animation', action: 'loop-end', frame }), RangeError);
  }
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'delete' }), RangeError);
  assert.equal(player.getSnapshot().playbackDurationMs, 1720);
});

test('le minuteur d’inspection respecte la pause globale de la simulation', async () => {
  const { world, controller, player } = await setup();
  controller.dispatch({ type: 'animation', name: 'idle' });
  world.paused = true;
  controller.advance(1);
  assert.equal(player.frame, 0);
  controller.dispatch({ type: 'animation', action: 'seek', frame: 15 });
  assert.equal(player.frame, 15);
  assert.equal(player.inspecting, true);
  assert.equal(world.particles[0].x, world.originX + player.frames[15][0]);
  world.paused = false;
  controller.dispatch({ type: 'animation', action: 'resume' });
  controller.advance(0.04);
  assert.equal(player.frame, 16);
});
