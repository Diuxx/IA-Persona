const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BehaviorController, BEHAVIOR_PRESETS } = require('../behavior-controller.js');
const { ParticleWorld } = require('../particle-world.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

function createPersona(seed = 2026) {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed });
  return { world, controller: new BehaviorController(world) };
}

function averageDistanceFromHome(world, region) {
  const pixels = region ? world.particles.filter(p => p.region === region) : world.particles;
  return pixels.reduce((distance, particle) =>
    distance + Math.hypot(particle.x - particle.homeX, particle.y - particle.homeY), 0) / pixels.length;
}

test('les quatre comportements sont stables, connus et modifient seulement la physique', () => {
  assert.deepEqual(Object.keys(BEHAVIOR_PRESETS), ['idle', 'listening', 'thinking', 'speaking']);
  const { controller } = createPersona();
  for (const state of Object.keys(BEHAVIOR_PRESETS)) {
    controller.setState(state);
    assert.equal(controller.state, state);
    assert.equal(controller.getSnapshot().state, state);
  }
  assert.throws(() => controller.setState('root'), RangeError);
  assert.throws(() => controller.setState({ state: 'thinking' }), RangeError);
});

test('transition douce : l’entrée dans thinking ne saute pas immédiatement au nouveau profil', () => {
  const { world, controller } = createPersona();
  const first = world.behaviorDrive;
  assert.equal(controller.setState('thinking'), true);
  assert.equal(world.behaviorDrive.agitation, first.agitation);
  controller.advance(0.1);
  assert.ok(world.behaviorDrive.agitation > first.agitation);
  assert.ok(world.behaviorDrive.agitation < BEHAVIOR_PRESETS.thinking.agitation * controller.energy);
  controller.advance(0.5);
  assert.equal(world.behaviorDrive.agitation, BEHAVIOR_PRESETS.thinking.agitation * controller.energy);
  assert.equal(controller.setState('thinking'), false);
});

test('interruption de transition conserve le dernier état interpolé', () => {
  const { world, controller } = createPersona();
  controller.setState('thinking');
  controller.advance(0.12);
  const before = world.behaviorDrive.agitation;
  controller.setState('listening');
  controller.advance(0.001);
  assert.ok(Math.abs(world.behaviorDrive.agitation - before) < 0.001);
});

test('le signal vocal n’affecte la pulsation que pendant speaking', () => {
  const { world, controller } = createPersona();
  controller.setVoiceLevel(1);
  controller.setState('speaking');
  controller.advance(0.5);
  const loud = world.behaviorDrive.pulse;
  controller.setVoiceLevel(0);
  controller.advance(0.02);
  const quiet = world.behaviorDrive.pulse;
  assert.ok(loud > quiet + 0.65);
  controller.setState('thinking');
  controller.advance(0.5);
  assert.ok(world.behaviorDrive.pulse < loud);
});

test('l’énergie change l’intensité des comportements, jamais le nombre de particules', () => {
  const { world, controller } = createPersona();
  controller.setState('thinking');
  controller.setEnergy(0);
  controller.advance(0.5);
  const calm = world.behaviorDrive.agitation;
  controller.setEnergy(1);
  controller.advance(0.1);
  assert.ok(world.behaviorDrive.agitation > calm);
  assert.equal(world.particles.length, PERSONA_PIXEL_MAP.count);
});

test('explosion temporaire pendant speaking : la personnalité et le niveau vocal sont conservés', () => {
  const { world, controller } = createPersona();
  controller.setState('speaking');
  controller.setVoiceLevel(0.65);
  controller.advance(0.5);
  assert.equal(controller.trigger('hit'), true);
  assert.equal(world.mode, 'explode');
  for (let step = 0; step < 215; step++) {
    controller.advance(1 / 60);
    world.step(1 / 60);
  }
  assert.equal(world.mode, 'idle');
  assert.equal(controller.getSnapshot().state, 'speaking');
  assert.equal(controller.getSnapshot().voiceLevel, 0.65);
  assert.ok(world.behaviorDrive.pulse > 0);
});

test('une impulsion locale peut être limitée à la zone anatomique des gouttes', () => {
  const { world, controller } = createPersona();
  const regionIndex = world.anatomy.names.indexOf('droplet-left');
  const p = world.particles.find(p => p.region === regionIndex);
  const other = world.particles.find(p => p.region !== regionIndex &&
    Math.hypot(p.x - p.homeX, p.y - p.homeY) === 0);
  const previous = [other.vx, other.vy];
  controller.trigger('field', { x: p.x, y: p.y, radius: 200, strength: 150, region: 'droplet-left' });
  assert.ok(world.particles.some(p => p.region === regionIndex && Math.hypot(p.vx, p.vy) > 0));
  assert.deepEqual([other.vx, other.vy], previous);
});

test('attraction et répulsion inversent l’impulsion autour du même centre', () => {
  const a = createPersona(44);
  const b = createPersona(44);
  const center = { x: 180, y: 185, radius: 145 };
  a.controller.trigger('field', { ...center, strength: 95 });
  b.controller.trigger('field', { ...center, strength: -95 });
  const index = a.world.particles.findIndex(p => Math.hypot(p.x - center.x, p.y - center.y) < 120);
  assert.ok(index >= 0);
  const outward = a.world.particles[index];
  const inward = b.world.particles[index];
  assert.ok(Math.abs(outward.vx + inward.vx) < 1e-9);
  assert.ok(Math.abs(outward.vy + inward.vy) < 1e-9);
});

test('aucune commande ne peut injecter des paramètres physiques invalides', () => {
  const { controller } = createPersona();
  assert.throws(() => controller.setEnergy(-1), RangeError);
  assert.throws(() => controller.setEnergy(Infinity), RangeError);
  assert.throws(() => controller.setVoiceLevel(NaN), RangeError);
  assert.throws(() => controller.trigger('field', { x: NaN, y: 40 }), RangeError);
  assert.throws(() => controller.trigger('field', { x: 100, y: 100, strength: 1e20 }), RangeError);
  assert.throws(() => controller.trigger('field', { x: 100, y: 100, region: 'unknown' }), RangeError);
  assert.throws(() => controller.trigger('arbitrary-script'), RangeError);
  assert.throws(() => controller.dispatch({ type: 'eval', value: 'alert(1)' }), RangeError);
  assert.throws(() => controller.dispatch(null), TypeError);
});

test('dispatch applique uniquement les intentions autorisées', () => {
  const { controller, world } = createPersona();
  assert.equal(controller.dispatch({ type: 'state', value: 'listening' }), true);
  assert.equal(controller.dispatch({ type: 'energy', value: 0.7 }), true);
  assert.equal(controller.dispatch({ type: 'voice', value: 0.5 }), true);
  assert.equal(controller.dispatch({ type: 'effect', name: 'blink' }), true);
  assert.equal(world.getBlinkAmount(), 0);
  world.step(0.1);
  assert.ok(world.getBlinkAmount() > 0);
  assert.equal(controller.dispatch({ type: 'effect', name: 'field', options: { x: 180, y: 200, radius: 60, strength: 45 } }), true);
});

test('pause fige le contrôleur et rejette les réactions physiques', () => {
  const { world, controller } = createPersona();
  controller.setState('thinking');
  controller.advance(0.15);
  const agitation = world.behaviorDrive.agitation;
  world.paused = true;
  controller.advance(2);
  assert.equal(world.behaviorDrive.agitation, agitation);
  assert.equal(controller.trigger('field', { x: 100, y: 100, radius: 90, strength: 50 }), false);
  assert.equal(controller.trigger('hit'), false);
  world.paused = false;
  controller.advance(0.5);
  assert.ok(world.behaviorDrive.agitation > agitation);
});

test('reset revient à idle sans modifier la carte anatomique ni les pixels', () => {
  const { world, controller } = createPersona();
  controller.setState('speaking');
  controller.setEnergy(0.9);
  controller.setVoiceLevel(0.75);
  controller.trigger('reveal');
  controller.reset();
  assert.deepEqual(controller.getSnapshot(), {
    state: 'idle', energy: 0.45, voiceLevel: 0, effect: 'idle', paused: false, particleCount: 15886,
  });
  assert.equal(world.particles.length, 15886);
  assert.equal(world.anatomy.names.length, 11);
  assert.equal(world.colorMix, 0);
});

test('simulation reproductible pour une même suite de commandes', () => {
  const first = createPersona(5150);
  const second = createPersona(5150);
  for (const { world, controller } of [first, second]) {
    controller.setEnergy(0.75);
    controller.setState('thinking');
    for (let i = 0; i < 40; i++) { controller.advance(1 / 60); world.step(1 / 60); }
    controller.trigger('field', { x: 210, y: 190, strength: 130, radius: 110 });
    controller.setState('listening');
    for (let i = 0; i < 40; i++) { controller.advance(1 / 60); world.step(1 / 60); }
  }
  assert.deepEqual(first.world.particles, second.world.particles);
});
