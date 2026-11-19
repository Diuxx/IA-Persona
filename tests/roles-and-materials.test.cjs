const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { BehaviorController } = require('../src/controller/behavior-controller.js');
const { CohesionField } = require('../src/engine/cohesion-field.js');
const { RoleRegistry, ROLE_NAMES } = require('../src/engine/role-registry.js');
const { MATERIAL_PRESETS, REGION_DEFINITIONS } = require('../src/engine/anatomy.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

function createPersona() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  return { world, controller: new BehaviorController(world) };
}

function speedsByRegion(world, regionName) {
  const region = world.anatomy.names.indexOf(regionName);
  return world.particles.filter(p => p.region === region).map(p => Math.hypot(p.vx, p.vy));
}

test('les zones sont des sélecteurs logiques, matériaux et rôles sont séparés', () => {
  const { world } = createPersona();
  const body = world.particles.find(p => p.region === world.anatomy.names.indexOf('body'));
  const eye = world.particles.find(p => p.region === world.anatomy.names.indexOf('eye'));
  const top = world.particles.find(p => p.region === world.anatomy.names.indexOf('puff-top'));
  const left = world.particles.find(p => p.region === world.anatomy.names.indexOf('puff-left'));
  assert.equal(body.material, MATERIAL_PRESETS.cloud);
  assert.equal(eye.material, MATERIAL_PRESETS.optic);
  assert.equal(top.material, left.material, 'different regions can share one material');
  assert.ok(world.roles.has(eye, 'gaze'));
  assert.ok(world.roles.has(eye, 'blink'));
  assert.ok(world.roles.has(left, 'breathe'));
  assert.ok(world.roles.has(body, 'breathe'));
  assert.equal(world.particles.length, 15886);
  assert.deepEqual([...world.anatomy.names].sort(), Object.keys(REGION_DEFINITIONS).sort());
});

test('la cohésion traverse la frontière de deux zones et de deux matériaux', () => {
  const particles = [
    { x: 1, y: 1, homeX: 1, homeY: 1, material: MATERIAL_PRESETS.cloud, region: 0, vx: 0, vy: 0 },
    { x: 2, y: 1, homeX: 2, homeY: 1, material: MATERIAL_PRESETS.optic, region: 1, vx: 0, vy: 0 },
    { x: 3, y: 1, homeX: 3, homeY: 1, material: MATERIAL_PRESETS.droplet, region: 2, vx: 0, vy: 0 },
  ];
  const field = new CohesionField(particles, 5, 3, 0, 0);
  assert.equal(field.linkCount, 2);
  particles[0].x -= 10;
  field.apply(particles, 70, 1 / 60);
  assert.ok(particles[1].vx < 0, 'middle pixel follows its physical neighbor across region boundary');
  assert.equal(particles[1].x, 2, 'cohesion influences velocity, not instantaneous position');
});

test('plusieurs zones partagent le même rôle, indépendamment de leur matériau', () => {
  const { world } = createPersona();
  assert.equal(world.roles.hasRegionRole('droplet-left', 'orbit'), true);
  assert.equal(world.roles.hasRegionRole('droplet-right', 'orbit'), true);
  assert.equal(world.roles.hasRegionRole('puff-top', 'orbit'), false);
  assert.equal(world.roles.hasRegionRole('body', 'express'), true);
  assert.equal(world.roles.hasRegionRole('droplet-left', 'express'), true);
  assert.ok(ROLE_NAMES.includes('gaze'));
});

test('assigner des rôles ne touche ni la physique ni le graphe de cohésion', () => {
  const { world, controller } = createPersona();
  const eyeIndex = world.anatomy.names.indexOf('eye');
  const originalMaterial = world.particles.find(p => p.region === eyeIndex).material;
  const originalLinks = world.cohesionField.linkCount;
  assert.equal(controller.dispatch({ type: 'roles', region: 'eye', roles: ['gaze', 'focus', 'express'] }), true);
  assert.deepEqual(world.roles.getRoles('eye'), ['gaze', 'focus', 'express']);
  assert.equal(world.roles.hasRegionRole('eye', 'blink'), false);
  assert.equal(world.particles.find(p => p.region === eyeIndex).material, originalMaterial);
  assert.equal(world.cohesionField.linkCount, originalLinks);
  controller.reset();
  assert.equal(world.roles.hasRegionRole('eye', 'blink'), true);
});

test('une impulsion par rôle cible plusieurs zones sans affecter les autres', () => {
  const { world, controller } = createPersona();
  const bodyBefore = speedsByRegion(world, 'body');
  assert.ok(bodyBefore.every(speed => speed === 0));
  assert.equal(controller.dispatch({ type: 'effect', name: 'field', options: {
    x: 200, y: 180, radius: 250, strength: 90, role: 'float',
  } }), true);
  const left = speedsByRegion(world, 'droplet-left');
  const right = speedsByRegion(world, 'droplet-right');
  assert.ok(left.some(speed => speed > 0));
  assert.ok(right.some(speed => speed > 0));
  assert.ok(speedsByRegion(world, 'body').every(speed => speed === 0));
});

test('une cible par rôle peut être affinée avec une zone donnée', () => {
  const { world, controller } = createPersona();
  assert.equal(controller.trigger('field', {
    x: 200, y: 180, radius: 250, strength: 90, role: 'float', region: 'droplet-left',
  }), true);
  assert.ok(speedsByRegion(world, 'droplet-left').some(speed => speed > 0));
  assert.ok(speedsByRegion(world, 'droplet-right').every(speed => speed === 0));
});

test('une action sémantique d’attraction délègue au même moteur validé', () => {
  const a = createPersona();
  const b = createPersona();
  const options = { x: 200, y: 170, radius: 170, strength: 80 };
  assert.equal(a.controller.dispatch({ type: 'action', role: 'gaze', action: 'attract', options }), true);
  assert.equal(b.controller.dispatch({ type: 'action', role: 'gaze', action: 'repel', options }), true);
  const eye = a.world.anatomy.names.indexOf('eye');
  const pa = a.world.particles.find(p => p.region === eye && p.x !== options.x);
  const pb = b.world.particles.find(p => p.region === eye && p.homeX === pa.homeX && p.homeY === pa.homeY);
  assert.ok(Math.hypot(pa.vx, pa.vy) > 0);
  assert.ok(Math.abs(pa.vx + pb.vx) < 1e-9);
  assert.ok(Math.abs(pa.vy + pb.vy) < 1e-9);
  assert.ok(speedsByRegion(a.world, 'body').every(speed => speed === 0));
});

test('les rôles refusent les valeurs inconnues, dupliquées et les injections', () => {
  const { world, controller } = createPersona();
  const before = world.getRoleAssignments();
  assert.throws(() => controller.dispatch({ type: 'roles', region: 'eye', roles: ['eval'] }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'roles', region: 'eye', roles: ['gaze', 'gaze'] }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'roles', region: '__proto__', roles: [] }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'roles', region: 'eye', roles: 'gaze' }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'action', role: 'admin', action: 'repel', options: {} }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'action', role: 'gaze', action: 'eval', options: {} }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'action', role: 'gaze', action: 'attract', options: {
    x: 200, y: 200, strength: -99,
  } }), RangeError);
  assert.throws(() => controller.dispatch({ type: 'effect', name: 'field', options: {
    x: 200, y: 200, role: 'madeUp',
  } }), RangeError);
  assert.deepEqual(world.getRoleAssignments(), before, 'invalid commands do not mutate role assignments');
});

test('les affectations de rôles publiées sont des copies gelées et ne donnent pas accès aux particules', () => {
  const { world } = createPersona();
  const snapshot = world.getRoleAssignments();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.eye));
  assert.ok(!Object.keys(snapshot).includes('particles'));
  world.setRegionRoles('eye', ['focus']);
  assert.deepEqual(snapshot.eye, ['gaze', 'blink', 'focus']);
  assert.deepEqual(world.getRoleAssignments().eye, ['focus']);
});

test('le contrôle sans anatomie reste rétrocompatible pour la physique mais refuse les rôles', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 18 });
  const controller = new BehaviorController(world);
  assert.equal(world.getRoleAssignments().eye, undefined);
  assert.throws(() => world.setRegionRoles('eye', ['gaze']), RangeError);
  assert.throws(() => controller.trigger('field', { x: 200, y: 200, role: 'gaze' }), RangeError);
  world.explode();
  world.step(1 / 60);
  assert.ok(world.particles.every(p => Number.isFinite(p.x)));
});
