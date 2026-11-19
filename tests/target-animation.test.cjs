const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../particle-world.js');
const { BehaviorController } = require('../behavior-controller.js');
const { TargetAnimationPlayer, decodeAnimation, adler32 } = require('../target-animation-player.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');

function createWorld(seed = 2026) {
  return new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed });
}

async function createAnimatedWorld() {
  const world = createWorld();
  const player = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  const controller = new BehaviorController(world, { animationPlayer: player });
  return { world, player, controller };
}

test('les 43 PNG fournissent 43 poses sur 1,72 seconde', async () => {
  const { world, player } = await createAnimatedWorld();
  assert.equal(PERSONA_IDLE_TARGETS.sourceFrames, 43);
  assert.equal(PERSONA_IDLE_TARGETS.durationMs, 1720);
  assert.equal(player.frames.length, 43);
  assert.ok(player.frames.every(frame => frame.length === world.particles.length * 3));
  assert.equal(world.particles.length, 15886);
});

test('les mêmes particules conservent leur rôle, matériau et identité', async () => {
  const { world, player } = await createAnimatedWorld();
  const eye = world.particles.find(p => p.eye);
  const material = eye.material;
  const region = eye.region;
  const count = world.particles.length;
  player.play();
  for (let i = 0; i < 220; i += 1) {
    player.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.equal(world.particles.length, count);
  assert.equal(eye.material, material);
  assert.equal(eye.region, region);
  assert.ok(world.roles.has(eye, 'gaze'));
  assert.ok(world.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('interpolation : à 20 ms le lecteur vise exactement le milieu des deux premières poses', async () => {
  const { world, player } = await createAnimatedWorld();
  player.play();
  player.advance(0.02);
  assert.equal(player.frame, 0);
  assert.equal(world.targetPose.from, player.frames[0]);
  assert.equal(world.targetPose.to, player.frames[1]);
  assert.ok(Math.abs(world.targetPose.blend - 0.5) < 1e-9);
});

test('la boucle retourne à la première frame sans arrêter l’animation', async () => {
  const { player } = await createAnimatedWorld();
  player.play();
  player.advance(1.74);
  assert.equal(player.playing, true);
  assert.equal(player.frame, 0);
  assert.ok(Math.abs(player.getSnapshot().progress - (0.02 / 1.72)) < 1e-6);
});

test('une animation non bouclée s’arrête et libère la pose après 1,72 seconde', async () => {
  const { world, player, controller } = await createAnimatedWorld();
  controller.dispatch({ type: 'animation', name: 'idle', loop: false });
  assert.equal(world.targetPose !== null, true);
  player.advance(1.8);
  assert.equal(player.playing, false);
  assert.equal(world.targetPose, null);
});

test('stop, play et reset conservent les API de la V2.3', async () => {
  const { player, world, controller } = await createAnimatedWorld();
  assert.equal(controller.dispatch({ type: 'animation', name: 'idle' }), true);
  assert.equal(controller.getSnapshot().animation.playing, true);
  assert.equal(controller.dispatch({ type: 'animation', action: 'stop' }), true);
  assert.equal(controller.dispatch({ type: 'animation', action: 'stop' }), false);
  assert.equal(world.targetPose, null);
  controller.dispatch({ type: 'animation', name: 'idle' });
  controller.reset();
  assert.equal(player.playing, false);
  assert.equal(controller.state, 'idle');
  assert.equal(world.targetPose, null);
});

test('la pause fige le temps d’animation et les déplacements', async () => {
  const { world, controller, player } = await createAnimatedWorld();
  player.play();
  controller.advance(0.1);
  world.step(0.1);
  world.paused = true;
  const oldTime = player.elapsed;
  const oldPos = world.particles.slice(0, 25).map(p => [p.x, p.y]);
  for (let i = 0; i < 30; i++) {
    controller.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.equal(player.elapsed, oldTime);
  assert.deepEqual(world.particles.slice(0, 25).map(p => [p.x, p.y]), oldPos);
});

test('une commande thinking stoppe le clip sans changer son API', async () => {
  const { controller, player } = await createAnimatedWorld();
  player.play();
  controller.dispatch({ type: 'state', value: 'thinking' });
  assert.equal(controller.state, 'thinking');
  assert.equal(player.playing, false);
  assert.equal(controller.dispatch({ type: 'animation', name: 'idle' }), true);
  assert.equal(controller.state, 'idle');
  assert.equal(player.playing, true);
});

test('les effets physiques restent disponibles pendant la lecture du GIF', async () => {
  const { world, controller, player } = await createAnimatedWorld();
  player.play();
  assert.equal(controller.dispatch({ type: 'effect', name: 'hit' }), true);
  assert.equal(world.mode, 'explode');
  assert.equal(player.playing, true);
  for (let i = 0; i < 215; i++) {
    controller.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.equal(world.mode, 'idle');
  assert.ok(world.targetPose !== null);
  assert.equal(world.particles.length, PERSONA_IDLE_TARGETS.particleCount);
});

test('la palette de chaque pose conserve les pixels blancs de l’œil', async () => {
  const { world, player } = await createAnimatedWorld();
  const eyeIndex = world.particles.findIndex(p => p.eye);
  const bodyIndex = world.particles.findIndex(p => !p.eye);
  const indexEye = eyeIndex * 3 + 2;
  const indexBody = bodyIndex * 3 + 2;
  assert.ok(player.frames.every(frame => frame[indexEye] === 3));
  assert.ok(player.frames.every(frame => frame[indexBody] !== 3));
});

test('les commandes inconnues et les options dangereuses sont rejetées', async () => {
  const { controller } = await createAnimatedWorld();
  assert.throws(() => controller.dispatch({ type: 'animation', name: 'delete-files' }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', name: 'idle', loop: 1 }), TypeError);
  assert.throws(() => controller.dispatch({ type: 'animation', action: 'eval', name: 'idle' }), RangeError);
});

test('l’asset rejette une référence source incompatible ou une taille incohérente', async () => {
  const world = createWorld();
  assert.notEqual(adler32(Uint8Array.from([1,2,3])), 0);
  await assert.rejects(() => decodeAnimation({ ...PERSONA_IDLE_TARGETS, sourceChecksum: 123 }, world), /carte source/);
  await assert.rejects(() => decodeAnimation({ ...PERSONA_IDLE_TARGETS, particleCount: 2 }, world), /incompatible/);
  await assert.rejects(() => decodeAnimation({ ...PERSONA_IDLE_TARGETS, durationMs: -1 }, world), /incompatible/);
});

test('le décodeur rejette les données gzip tronquées et la corruption des cibles', async () => {
  const world = createWorld();
  await assert.rejects(() => decodeAnimation({ ...PERSONA_IDLE_TARGETS, payload: 'AAAA' }, world), /Décompression/);
});

test('deux simulations avec la même source suivent les mêmes trajectoires', async () => {
  const a = await createAnimatedWorld();
  const b = await createAnimatedWorld();
  a.player.play();
  b.player.play();
  for (let i = 0; i < 90; i++) {
    for (const run of [a, b]) {
      run.controller.advance(1 / 60);
      run.world.step(1 / 60);
    }
  }
  for (const index of [0, 200, 2000, 8000, 15885]) {
    assert.deepEqual([a.world.particles[index].x, a.world.particles[index].y],
      [b.world.particles[index].x, b.world.particles[index].y]);
  }
});

test('un gzip dont la sortie dépasse la taille déclarée est rejeté avant allocation du résultat', async () => {
  const { gzipSync } = require('node:zlib');
  const world = createWorld();
  const expectedLength = PERSONA_IDLE_TARGETS.particleCount * PERSONA_IDLE_TARGETS.frameCount * 3;
  const overlargePayload = gzipSync(Buffer.alloc(expectedLength + 65536)).toString('base64');

  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_IDLE_TARGETS, payload: overlargePayload }, world),
    /plus volumineuse que prévu/
  );
});

test('les deux extrémités de la boucle restent proches sans écraser la dernière pose source', async () => {
  const { player, world } = await createAnimatedWorld();
  assert.notDeepEqual(player.frames.at(-1), player.frames[0]);
  let moved = 0;
  for (let offset = 0; offset < player.frames[0].length; offset += 3) {
    if (player.frames.at(-1)[offset] !== player.frames[0][offset] || player.frames.at(-1)[offset + 1] !== player.frames[0][offset + 1]) moved += 1;
  }
  assert.ok(moved > 100, 'la dernière pose doit rester distincte de la première');
  assert.equal(player.frames.length, 43);
  assert.equal(world.particles.length, 15886);
});

test('chaque pose conserve une forme dense et tous les pixels blancs de l’œil', async () => {
  const { player } = await createAnimatedWorld();
  for (const [index, frame] of player.frames.entries()) {
    const visible = new Set();
    for (let offset = 0; offset < frame.length; offset += 3) {
      visible.add((frame[offset + 1] << 8) + frame[offset]);
    }
    assert.ok(visible.size >= 13_000, `pose ${index + 1}: silhouette trop lacunaire`);
  }
});
