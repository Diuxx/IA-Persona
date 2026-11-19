const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CohesionField } = require('../cohesion-field.js');
const { ParticleWorld } = require('../particle-world.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');

function point(x, y, eye = false) {
  return { homeX: x, homeY: y, x, y, vx: 0, vy: 0, eye };
}

function averageNeighborGap(points) {
  return points.slice(1).reduce((sum, point, index) => {
    const neighbor = points[index];
    return sum + Math.abs((point.x - point.homeX) - (neighbor.x - neighbor.homeX));
  }, 0) / (points.length - 1);
}

test('le graphe de cohésion relie les pixels contigus même de matériaux différents', () => {
  const particles = [point(1, 1), point(2, 1), point(3, 1), point(3, 2, true), point(5, 1)];
  const field = new CohesionField(particles, 7, 4, 0, 0);
  assert.equal(field.linkCount, 3);
  assert.deepEqual([...field.counts], [1, 2, 2, 1, 0]);
});

test('la force rapproche les déplacements de deux voisins sans téléporter leurs points', () => {
  const points = [point(1, 1), point(2, 1)];
  points[0].x -= 8;
  points[1].x += 8;
  const field = new CohesionField(points, 5, 5, 0, 0);
  const initialGap = averageNeighborGap(points);
  field.apply(points, 70, 1 / 60);
  assert.ok(points[0].vx > 0);
  assert.ok(points[1].vx < 0);
  assert.equal(averageNeighborGap(points), initialGap, 'the field modifies velocities, not positions');
});

test('désactiver la cohésion supprime uniquement la force locale', () => {
  const points = [point(1, 1), point(2, 1)];
  points[0].x -= 10;
  const field = new CohesionField(points, 5, 5, 0, 0);
  field.apply(points, 0, 1 / 60);
  assert.equal(points[0].vx, 0);
  assert.equal(points[1].vx, 0);
});

test('la cohésion réduit la dispersion relative des voisins sans modifier le nombre de particules', () => {
  const loose = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 21 });
  const cohesive = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 21 });
  loose.setCohesion(0);
  cohesive.setCohesion(120);
  for (const world of [loose, cohesive]) {
    const n = world.particles.length;
    const index = Math.floor(n * 0.6);
    world.particles[index].x += 55;
    world.particles[index + 1].y -= 30;
  }
  for (let step = 0; step < 24; step += 1) {
    loose.step(1 / 60);
    cohesive.step(1 / 60);
  }
  const index = Math.floor(loose.particles.length * 0.6);
  const gap = (world) => Math.abs(world.particles[index].x - world.particles[index].homeX) +
    Math.abs(world.particles[index + 1].y - world.particles[index + 1].homeY);
  assert.ok(gap(cohesive) < gap(loose), `expected ${gap(cohesive)} < ${gap(loose)}`);
  assert.equal(cohesive.particles.length, PERSONA_PIXEL_MAP.count);
});

test('les liens sont faibles pendant un impact puis reviennent progressivement', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 15 });
  assert.equal(world.getRecoveryFactor(), 1);
  world.explode();
  assert.equal(world.getRecoveryFactor(), 0);
  for (let step = 0; step < 36; step++) world.step(1 / 60);
  const intermediate = world.getRecoveryFactor();
  assert.ok(intermediate > 0 && intermediate < 1);
  for (let step = 0; step < 75; step++) world.step(1 / 60);
  assert.equal(world.getRecoveryFactor(), 1);
  for (let step = 0; step < 100; step++) world.step(1 / 60);
  assert.equal(world.mode, 'idle');
});

test('révélation puis explosion préservent la silhouette et les couleurs', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 95 });
  world.reveal();
  for (let i = 0; i < 200; i++) world.step(1 / 60);
  world.explode();
  for (let i = 0; i < 230; i++) world.step(1 / 60);
  assert.equal(world.mode, 'idle');
  assert.equal(world.colorMix, 0);
  assert.ok(world.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const distance = world.particles.reduce((total, p) => total + Math.hypot(p.x - p.homeX, p.y - p.homeY), 0);
  assert.ok(distance / world.particles.length < 5, `average resting displacement: ${distance / world.particles.length}`);
});

test('la respiration peut être atténuée ou amplifiée indépendamment de la cohésion', () => {
  const still = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 100 });
  const breathing = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 100 });
  still.setOrganicMotion(0);
  breathing.setOrganicMotion(2);
  for (let i = 0; i < 80; i++) {
    still.step(1 / 60);
    breathing.step(1 / 60);
  }
  const p = Math.floor(still.particles.length / 3);
  assert.ok(Math.abs(still.particles[p].x - breathing.particles[p].x) > 0.1);
  assert.equal(still.cohesionField.linkCount, breathing.cohesionField.linkCount);
});

test('les paramètres rejettent les valeurs hors limites', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 8 });
  for (const invalid of [-1, 121, NaN, Infinity]) {
    assert.throws(() => world.setCohesion(invalid), RangeError);
  }
  for (const invalid of [-0.1, 2.1, NaN, Infinity]) {
    assert.throws(() => world.setOrganicMotion(invalid), RangeError);
  }
  world.setCohesion(0);
  world.setOrganicMotion(0);
  assert.equal(world.cohesion, 0);
  assert.equal(world.organicMotion, 0);
});

test('la physique organique reste déterministe et la pause fige les vitesses', () => {
  const a = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 123 });
  const b = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 123 });
  for (const world of [a, b]) {
    world.reveal();
    for (let i = 0; i < 70; i++) world.step(1 / 60);
    world.paused = true;
  }
  assert.deepEqual(a.particles, b.particles);
  const positions = a.particles.map(({ x, y, vx, vy }) => [x, y, vx, vy]);
  for (let i = 0; i < 12; i++) a.step(1 / 60);
  assert.deepEqual(a.particles.map(({ x, y, vx, vy }) => [x, y, vx, vy]), positions);
});
