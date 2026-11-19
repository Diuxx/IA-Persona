const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../particle-world.js');
const { RoleMotionPlayer, ROLE_MOTIONS } = require('../role-motion-player.js');
const { BehaviorController } = require('../behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

function createWorld() {
  return new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 42 });
}

test('les trois mouvements disponibles sont explicites et de durée bornée', () => {
  assert.deepEqual(Object.keys(ROLE_MOTIONS), ['pulse', 'wave', 'orbit']);
  assert.ok(Object.values(ROLE_MOTIONS).every(duration => duration > 0 && duration < 3));
});

test('le mouvement ciblé ne change pas les vitesses des particules sans ce rôle', () => {
  const world = createWorld();
  const motion = new RoleMotionPlayer(world);
  const targeted = world.particles.filter(p => world.roles.has(p, 'float'));
  const others = world.particles.filter(p => !world.roles.has(p, 'float'));
  assert.ok(targeted.length > 0 && others.length > 0);
  motion.play({ name: 'orbit', role: 'float' });
  motion.advance(0.2);
  assert.ok(targeted.some(p => Math.abs(p.vx) + Math.abs(p.vy) > 0));
  assert.ok(others.every(p => p.vx === 0 && p.vy === 0));
});

test('l’animation physique ne change ni l’identité, ni la couleur des particules', () => {
  const world = createWorld();
  const motion = new RoleMotionPlayer(world);
  const count = world.particles.length;
  const reference = world.particles.map(p => p.color);
  motion.play({ name: 'wave' });
  for (let frame = 0; frame < 60; frame++) {
    motion.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.equal(world.particles.length, count);
  assert.ok(world.particles.every((p, i) => p.color === reference[i]));
  assert.ok(world.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('les trois mouvements s’achèvent sans rester actifs', () => {
  for (const name of Object.keys(ROLE_MOTIONS)) {
    const motion = new RoleMotionPlayer(createWorld());
    motion.play({ name, role: 'float' });
    for (let i = 0; i < 160; i++) motion.advance(1 / 60);
    assert.deepEqual(motion.getSnapshot(), { playing: false });
    assert.equal(motion.stop(), false);
  }
});

test('pause physique, reprise et arrêt interrompent proprement un mouvement', () => {
  const world = createWorld();
  const motion = new RoleMotionPlayer(world);
  motion.play({ name: 'pulse', role: 'gaze' });
  world.paused = true;
  motion.advance(0.4);
  assert.equal(motion.getSnapshot().progress, 0);
  assert.ok(world.particles.every(p => p.vx === 0 && p.vy === 0));
  world.paused = false;
  motion.advance(0.2);
  assert.ok(motion.getSnapshot().progress > 0);
  assert.equal(motion.stop(), true);
});

test('les commandes sont validées et les mouvements peuvent être pilotés par le contrôleur', () => {
  const world = createWorld();
  const motion = new RoleMotionPlayer(world);
  const controller = new BehaviorController(world, { roleMotionPlayer: motion });
  assert.throws(() => motion.play({ name: 'unknown' }), RangeError);
  assert.throws(() => motion.play({ name: 'orbit', role: 'unknown' }), RangeError);
  assert.throws(() => motion.advance(-1), RangeError);
  assert.throws(() => motion.advance(Number.NaN), RangeError);
  assert.throws(() => controller.dispatch({ type: 'role-motion', action: 'eval' }), RangeError);
  assert.equal(controller.dispatch({ type: 'role-motion', name: 'pulse', role: 'blink' }), true);
  controller.advance(0.1);
  assert.equal(controller.getSnapshot().roleMotion.name, 'pulse');
  assert.equal(controller.dispatch({ type: 'role-motion', action: 'stop' }), true);
  assert.equal(controller.getSnapshot().roleMotion.playing, false);
  controller.dispatch({ type: 'role-motion', name: 'orbit' });
  controller.reset();
  assert.equal(controller.getSnapshot().roleMotion.playing, false);
});
