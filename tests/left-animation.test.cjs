const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { TargetAnimationPlayer, decodeAnimation } = require('../src/animation/target-animation-player.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');
const { PERSONA_LEFT_TARGETS } = require('../assets/animations/left-targets.js');
const { PERSONA_RIGHT_TARGETS } = require('../assets/animations/right-targets.js');

const FRAME = 1 / 60;
const SOURCE_FRAMES = 34;
const START_FRAME = 12;
const HEAD_REPEAT = 13;
// Played sequence: source frames 12..34, then source frames 1..13 again.
const PLAYED_FROM_START = SOURCE_FRAMES - START_FRAME + 1;
const TOTAL_FRAMES = PLAYED_FROM_START + HEAD_REPEAT;

/** Idle and left share one pool, exactly as the application loads them. */
async function createScene(seed = 2026) {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed });
  const [idle, left, right] = await TargetAnimationPlayer.createClips(
    world, [PERSONA_IDLE_TARGETS, PERSONA_LEFT_TARGETS, PERSONA_RIGHT_TARGETS]);
  const controller = new BehaviorController(world, { animationPlayer: idle, animationPlayers: [left, right] });
  return { world, idle, left, right, controller };
}

test('le clip right partage le pool de left et revient à idle', async () => {
  assert.equal(PERSONA_RIGHT_TARGETS.name, 'right');
  assert.equal(PERSONA_RIGHT_TARGETS.kind, 'one-shot');
  assert.equal(PERSONA_RIGHT_TARGETS.next, 'idle');
  assert.equal(PERSONA_RIGHT_TARGETS.frameCount, TOTAL_FRAMES);
  assert.equal(PERSONA_RIGHT_TARGETS.particleCount, PERSONA_LEFT_TARGETS.particleCount);
  assert.deepEqual(PERSONA_RIGHT_TARGETS.extraSources, PERSONA_LEFT_TARGETS.extraSources);
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'right' });
  run(scene, 4.0);
  assert.equal(scene.controller.animationPlayer, scene.idle);
  assert.equal(scene.idle.playing, true);
});

test('right est le miroir horizontal de left : les pixels de la première frame se correspondent par une constante', async () => {
  const scene = await createScene();
  const pixels = (frame) => {
    const set = new Set();
    for (let offset = 0; offset < frame.length; offset += 3) {
      if (frame[offset + 2] !== 0) set.add(`${frame[offset]},${frame[offset + 1]}`);
    }
    return set;
  };
  const leftPixels = pixels(scene.left.fullFrames[0]);
  const rightPixels = pixels(scene.right.fullFrames[0]);
  let best = 0;
  for (let sum = 150; sum <= 260; sum += 1) {
    let matches = 0;
    for (const key of leftPixels) {
      const [x, y] = key.split(',').map(Number);
      if (rightPixels.has(`${sum - x},${y}`)) matches += 1;
    }
    best = Math.max(best, matches / leftPixels.size);
  }
  assert.ok(best > 0.9, `correspondance miroir insuffisante : ${(best * 100).toFixed(1)} %`);
});

test('passer de left à right ne relâche pas la pose', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.8);
  const before = scene.world.particles.map(p => [p.x, p.y]);
  scene.controller.dispatch({ type: 'animation', name: 'right' });
  assert.deepEqual(scene.world.particles.map(p => [p.x, p.y]), before);
  assert.equal(scene.left.playing, false);
  assert.equal(scene.right.playing, true);
});

function run(scene, seconds) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FRAME) {
    scene.controller.advance(FRAME);
    scene.world.step(FRAME);
  }
}

function visibleCount(frame) {
  let count = 0;
  for (let offset = 2; offset < frame.length; offset += 3) if (frame[offset] !== 0) count += 1;
  return count;
}

test('les données left : frames 12 à 34, puis les 13 premières rejouées, puis retour à idle', () => {
  assert.equal(PERSONA_LEFT_TARGETS.name, 'left');
  assert.equal(PERSONA_LEFT_TARGETS.kind, 'one-shot');
  assert.equal(PERSONA_LEFT_TARGETS.next, 'idle');
  assert.equal(PERSONA_LEFT_TARGETS.sourceFrames, SOURCE_FRAMES);
  assert.equal(PERSONA_LEFT_TARGETS.frameCount, TOTAL_FRAMES);
  assert.equal(PERSONA_LEFT_TARGETS.frameActiveCounts.length, TOTAL_FRAMES);
  assert.equal(PERSONA_LEFT_TARGETS.durationMs, TOTAL_FRAMES * 60);
  assert.equal(PERSONA_LEFT_TARGETS.encoding, 'gzip-particle-major-xy16-rgb');
  // Populations measured on the source PNGs (frame 1 = 19703 ... frame 34 = 20803).
  const counts = PERSONA_LEFT_TARGETS.frameActiveCounts;
  assert.equal(counts[0], 16116, 'première frame jouée : source 12');
  assert.equal(counts[PLAYED_FROM_START - 1], 20803, 'dernière frame source : 34');
  assert.equal(counts[PLAYED_FROM_START], 19703, 'reprise : source 1');
  assert.equal(Math.min(...counts), 16079);
  assert.equal(Math.max(...counts), 23311);
});

test('le format compilé partage le pool de l’idle : l’idle est un préfixe des extras de left', () => {
  const idleExtras = PERSONA_IDLE_TARGETS.extraSources;
  assert.deepEqual(PERSONA_LEFT_TARGETS.extraSources.slice(0, idleExtras.length), idleExtras);
  assert.equal(PERSONA_LEFT_TARGETS.particleCount - 15886, PERSONA_LEFT_TARGETS.extraSources.length);
  assert.ok(PERSONA_LEFT_TARGETS.particleCount >= Math.max(...PERSONA_LEFT_TARGETS.frameActiveCounts));
});

test('le pool est agrandi une seule fois, l’idle reste identique et complété par des particules inactives', async () => {
  const alone = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  const idleAlone = await TargetAnimationPlayer.create(alone, PERSONA_IDLE_TARGETS);
  const scene = await createScene(2026);
  assert.equal(alone.particles.length, 16162);
  assert.equal(scene.world.particles.length, PERSONA_LEFT_TARGETS.particleCount);
  // The first 16 162 identities of the shared pool are exactly the idle identities.
  for (let index = 0; index < 16162; index += 1) {
    const a = alone.particles[index];
    const b = scene.world.particles[index];
    assert.equal(a.homeX, b.homeX);
    assert.equal(a.homeY, b.homeY);
    assert.equal(a.eye, b.eye);
  }
  for (let frame = 0; frame < 43; frame += 1) {
    assert.deepEqual(scene.idle.fullFrames[frame].subarray(0, 16162 * 3), idleAlone.fullFrames[frame]);
    for (let offset = 16162 * 3; offset < scene.idle.fullFrames[frame].length; offset += 1) {
      assert.equal(scene.idle.fullFrames[frame][offset], 0);
    }
  }
});

test('l’ordre de chargement ne change ni le pool ni les identités', async () => {
  const reversed = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 1 });
  const [idleLate, leftFirst] = await TargetAnimationPlayer.createClips(reversed, [PERSONA_IDLE_TARGETS, PERSONA_LEFT_TARGETS]);
  const ordered = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 1 });
  const left = await TargetAnimationPlayer.create(ordered, PERSONA_LEFT_TARGETS);
  const idle = await TargetAnimationPlayer.create(ordered, PERSONA_IDLE_TARGETS);
  assert.equal(reversed.particles.length, ordered.particles.length);
  assert.equal(idleLate.frames.length, 43);
  assert.equal(leftFirst.frames.length, TOTAL_FRAMES);
  assert.deepEqual(idleLate.fullFrames[5], idle.fullFrames[5]);
  assert.deepEqual(leftFirst.fullFrames[5], left.fullFrames[5]);
});

test('une population invalide ne fait pas grandir le pool partagé', async () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_LEFT_TARGETS, frameActiveCounts: Array(TOTAL_FRAMES).fill(100) }, world),
    /Population incohérente/
  );
  assert.equal(world.particles.length, 15886);
});

test('left se termine, puis passe automatiquement à idle sans relâcher la pose', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 1.0);
  assert.ok(scene.left.frame > 0 && scene.left.frame < TOTAL_FRAMES - 1, 'la lecture est en cours');
  assert.equal(scene.controller.animationPlayer, scene.left);
  run(scene, 4.0);
  assert.equal(scene.controller.animationPlayer, scene.idle);
  assert.equal(scene.idle.playing, true);
  assert.equal(scene.idle.loop, true);
  assert.equal(scene.left.playing, false);
  assert.equal(scene.left.held, false);
});

test('left ne revient jamais à sa première frame avant la fin, et lit les 36 frames dans l’ordre', async () => {
  const scene = await createScene();
  scene.left.play();
  const seen = [];
  let previous = 0;
  while (scene.left.playing) {
    scene.left.advance(FRAME);
    assert.ok(scene.left.frame >= previous, 'la frame ne recule jamais');
    previous = scene.left.frame;
    seen.push(scene.left.frame);
  }
  assert.equal(scene.left.frame, TOTAL_FRAMES - 1);
  assert.equal(seen.at(-1), TOTAL_FRAMES - 1);
  assert.equal(scene.left.getSnapshot().completed, true);
});

test('le lecteur one-shot ralentit en fin de course et ne boucle jamais', async () => {
  const scene = await createScene();
  scene.left.play();
  const duration = scene.left.getSnapshot().playbackDurationMs / 1000;
  assert.equal(scene.left.getSnapshot().playbackDurationMs, TOTAL_FRAMES * 60);
  // Position is monotonic, starts at 0 and ends on the last frame.
  let previous = -1;
  for (let i = 0; i <= 200; i += 1) {
    const position = scene.left.positionAt(duration * i / 200);
    assert.ok(position >= previous - 1e-9);
    previous = position;
  }
  assert.equal(scene.left.positionAt(0), 0);
  assert.ok(Math.abs(scene.left.positionAt(duration) - (TOTAL_FRAMES - 1)) < 1e-9);
  // Terminal slowdown: the last 10% of time advances less than the middle 10%.
  const middle = scene.left.positionAt(0.55 * duration) - scene.left.positionAt(0.45 * duration);
  const end = scene.left.positionAt(duration) - scene.left.positionAt(0.9 * duration);
  assert.ok(end < middle / 4);
});

test('une commande loop:true sur left est rejetée explicitement', async () => {
  const { controller } = await createScene();
  assert.throws(() => controller.dispatch({ type: 'animation', name: 'left', loop: true }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'animation', name: 'left', loop: 1 }), TypeError);
  assert.throws(() => controller.dispatch({ type: 'animation', name: 'left', action: 'loop-end', frame: 5 }), RangeError);
});

test('idle → left ne téléporte pas les particules : rien ne bouge à l’instant du lancement', async () => {
  const scene = await createScene();
  run(scene, 0.5);
  const before = scene.world.particles.map(p => [p.x, p.y]);
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  assert.deepEqual(scene.world.particles.map(p => [p.x, p.y]), before);
  // Particles visible before AND after a step move in bounded steps (springs, not jumps).
  // Newborn particles appear on their target by design and are excluded here.
  let worstStep = 0;
  for (let i = 0; i < 30; i += 1) {
    const previous = scene.world.particles.map(p => ({ x: p.x, y: p.y, activity: p.activity ?? 0 }));
    scene.controller.advance(FRAME);
    scene.world.step(FRAME);
    scene.world.particles.forEach((p, index) => {
      if (previous[index].activity < 1 || (p.activity ?? 0) < 1) return;
      const step = Math.hypot(p.x - previous[index].x, p.y - previous[index].y);
      worstStep = Math.max(worstStep, step);
    });
  }
  assert.ok(worstStep < 12, `déplacement maximal par pas de 1/60 s : ${worstStep.toFixed(2)} px`);
});

test('dispatch idle pendant left : idle prend le relais sans relâcher la pose', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.8);
  const before = scene.world.particles.map(p => [p.x, p.y]);
  scene.controller.dispatch({ type: 'animation', name: 'idle' });
  assert.deepEqual(scene.world.particles.map(p => [p.x, p.y]), before);
  assert.equal(scene.controller.animationPlayer, scene.idle);
  assert.equal(scene.idle.playing, true);
  assert.equal(scene.left.playing, false);
});

test('la fin de left ne fait disparaître aucun pixel brutalement', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.5);
  // Right before the hand-over, left shows its last frame; the first idle frame must be close to it.
  let last = scene.world.visibleParticleCount;
  for (let i = 0; i < 400 && scene.controller.animationPlayer === scene.left; i += 1) {
    scene.controller.advance(FRAME);
    scene.world.step(FRAME);
    last = scene.world.visibleParticleCount;
  }
  assert.equal(scene.controller.animationPlayer, scene.idle);
  assert.ok(Math.abs(last - visibleCount(scene.idle.frames[0])) < 2500, 'pas de chute brutale de la population');
});

test('interrompre et relancer left repart de la frame 1 sans téléportation', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.7);
  assert.ok(scene.left.frame > 0);
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  assert.equal(scene.left.frame, 0);
  assert.equal(scene.left.getSnapshot().completed, false);
  assert.equal(scene.left.playing, true);
});

test('stop libère left en cours de lecture et ne change pas l’idle', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.8);
  assert.equal(scene.controller.dispatch({ type: 'animation', action: 'stop' }), true);
  assert.equal(scene.left.playing, false);
  assert.equal(scene.world.targetPose, null);
  assert.equal(scene.controller.dispatch({ type: 'animation', action: 'stop' }), false);
});

test('changer d’état interrompt left et retour à idle reste possible', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.4);
  scene.controller.dispatch({ type: 'state', value: 'thinking' });
  assert.equal(scene.left.playing, false);
  assert.equal(scene.world.targetPose, null);
  assert.equal(scene.controller.dispatch({ type: 'animation', name: 'idle' }), true);
  assert.equal(scene.controller.state, 'idle');
  assert.equal(scene.idle.playing, true);
});

test('les commandes inconnues sont rejetées et laissent l’état intact', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'idle' });
  assert.throws(() => scene.controller.dispatch({ type: 'animation', name: 'up' }), RangeError);
  assert.throws(() => scene.controller.dispatch({ type: 'animation', name: 'left', action: 'eval' }), RangeError);
  assert.throws(() => scene.controller.dispatch({ type: 'animation' }), RangeError);
  assert.equal(scene.controller.animationPlayer, scene.idle);
  assert.equal(scene.idle.playing, true);
});

test('getSnapshot expose l’animation active, la progression et les particules réellement visibles', async () => {
  const scene = await createScene();
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  run(scene, 0.8);
  const { animation } = scene.controller.getSnapshot();
  assert.equal(animation.name, 'left');
  assert.equal(animation.kind, 'one-shot');
  assert.equal(animation.frameCount, TOTAL_FRAMES);
  assert.equal(animation.playing, true);
  assert.equal(animation.completed, false);
  assert.equal(animation.held, false);
  assert.equal(animation.speed, 1);
  assert.equal(animation.visibleCount, scene.world.visibleParticleCount);
  assert.ok(animation.progress > 0 && animation.progress < 1);
  run(scene, 4.0);
  const afterward = scene.controller.getSnapshot().animation;
  assert.equal(afterward.name, 'idle');
  assert.equal(afterward.loop, true);
  assert.equal(afterward.playing, true);
});

test('une limite de particules s’applique aux identités de left sans changer ses frames', async () => {
  const scene = await createScene();
  const sources = scene.left.fullFrames.slice();
  scene.controller.dispatch({ type: 'animation', action: 'particle-count', count: 8000 });
  scene.controller.dispatch({ type: 'animation', name: 'left' });
  for (const frame of scene.left.frames) assert.ok(visibleCount(frame) <= 8000);
  assert.deepEqual(scene.left.fullFrames, sources);
  scene.controller.dispatch({ type: 'animation', action: 'particle-count', count: 'auto' });
  run(scene, 0.2);
  assert.ok(scene.world.visibleParticleCount > 8000);
});

test('les 36 poses de left restent dans la scène et ne dépassent jamais les yeux disponibles', async () => {
  const scene = await createScene();
  const eyeIdentities = scene.world.particles.filter(particle => particle.eye).length;
  // The eye pool is larger than the 375 eyes of the map: the compiler clones source eyes.
  assert.ok(eyeIdentities >= 414, `pool d’yeux insuffisant : ${eyeIdentities}`);
  assert.equal(scene.left.fullFrames.length, TOTAL_FRAMES);
  for (const frame of scene.left.fullFrames) {
    let eyes = 0;
    for (let index = 0; index < frame.length; index += 3) {
      const x = frame[index];
      const y = frame[index + 1];
      const shade = frame[index + 2];
      if (shade === 0) continue;
      assert.ok(x >= -scene.world.originX && x < scene.world.size - scene.world.originX);
      assert.ok(y >= -scene.world.originY && y < scene.world.size - scene.world.originY);
      if (shade === 3) eyes += 1;
    }
    assert.ok(eyes <= eyeIdentities);
  }
});

test('les particules hors scène et les frames incohérentes sont refusées', async () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_LEFT_TARGETS, payload: 'AAAA' }, world),
    /Décompression/
  );
  await assert.rejects(
    () => decodeAnimation({ ...PERSONA_LEFT_TARGETS, sourceChecksum: 1 }, world),
    /carte source/
  );
});

// Exercise the entire clip, including the hand-over to idle, not only its first 0.5 seconds.
test('left et right : aucune identité continuellement visible ne téléporte durant la lecture et le retour idle', async () => {
  for (const name of ['left', 'right']) {
    const scene = await createScene();
    scene.controller.dispatch({ type: 'animation', name: 'idle' });
    run(scene, 0.3);
    scene.controller.dispatch({ type: 'animation', name });
    const particles = scene.world.particles;
    const previous = new Float64Array(particles.length * 3);
    let maximum = 0;
    for (let step = 0; step < 180; step += 1) {
      for (let i = 0; i < particles.length; i += 1) {
        const offset = i * 3;
        previous[offset] = particles[i].x;
        previous[offset + 1] = particles[i].y;
        previous[offset + 2] = particles[i].activity ?? 0;
      }
      scene.controller.advance(FRAME);
      scene.world.step(FRAME);
      for (let i = 0; i < particles.length; i += 1) {
        const offset = i * 3;
        if (previous[offset + 2] < 1 || (particles[i].activity ?? 0) < 1) continue;
        const movement = Math.hypot(particles[i].x - previous[offset], particles[i].y - previous[offset + 1]);
        maximum = Math.max(maximum, movement);
      }
      assert.ok(maximum < 12, `${name} : déplacement de ${maximum.toFixed(2)} px par pas (étape ${step})`);
    }
    assert.equal(scene.controller.animationPlayer, scene.idle, `${name} doit revenir à idle`);
  }
});
