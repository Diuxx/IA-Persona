const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld, decodePixelMap } = require('../particle-world.js');
const { CohesionField } = require('../cohesion-field.js');
const { assignAnatomy, ANATOMY_PROFILES } = require('../anatomy.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

function createWorld(seed = 2026) {
  return new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed });
}

function cloneMap(overrides) {
  return { ...PERSONA_ANATOMY, ...overrides };
}

test('la carte couvre chaque pixel et répartit le personnage dans les 11 zones', () => {
  const world = createWorld();
  assert.equal(world.particles.length, 15886);
  assert.equal(world.anatomy.names.length, 11);
  assert.equal(world.anatomy.counts.reduce((sum, value) => sum + value, 0), 15886);
  assert.ok(world.anatomy.counts.every((value) => value > 0));
  assert.ok(world.anatomy.names.includes('eye'));
  assert.ok(world.anatomy.names.includes('spark'));
  assert.ok(world.anatomy.names.includes('droplet-left'));
  assert.ok(world.particles.every((p) => p.profile === world.anatomy.profiles[p.region]));
});

test('les segments doivent référencer uniquement des pixels visibles, sans doublons', () => {
  const decoded = decodePixelMap(PERSONA_PIXEL_MAP);
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ count: 123 }), 200, 200), /nombre/);
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ width: 199 }), 200, 200), /incompatible/);
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ regions: ['body', 'mystery'] }), 200, 200), /zones/);
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ regions: ['body', 'body'] }), 200, 200), /zones/);
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ runs: 'AQ==' }), 200, 200), /tronquée/);

  const overlap = Buffer.from([1, 1, 1, 0, 1, 1, 1, 0]).toString('base64');
  assert.throws(() => assignAnatomy(decoded.pixels, cloneMap({ runs: overlap }), 200, 200), /Chevauchement/);
});

test('la cohésion relie les pixels voisins même à travers deux zones logiques', () => {
  const pts = [
    { homeX: 1, homeY: 1, eye: false, region: 0 },
    { homeX: 2, homeY: 1, eye: false, region: 0 },
    { homeX: 3, homeY: 1, eye: false, region: 2 },
  ];
  const field = new CohesionField(pts, 6, 6, 0, 0);
  assert.equal(field.linkCount, 2);
  assert.deepEqual([...field.counts], [1, 2, 1]);
});

test('les profils rendent la dispersion des gouttes différente de celle de l’œil', () => {
  const withAnatomy = createWorld(100);
  const original = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 100 });
  withAnatomy.explode();
  original.explode();
  const eyeIndex = withAnatomy.particles.findIndex((p) => p.profile === ANATOMY_PROFILES.eye);
  const dropletIndex = withAnatomy.particles.findIndex((p) => p.profile === ANATOMY_PROFILES['droplet-left']);
  const speed = (p) => Math.hypot(p.vx, p.vy);
  assert.ok(Math.abs(speed(withAnatomy.particles[eyeIndex]) / speed(original.particles[eyeIndex]) - 0.7) < 1e-8);
  assert.ok(Math.abs(speed(withAnatomy.particles[dropletIndex]) / speed(original.particles[dropletIndex]) - 1.35) < 1e-8);
});

test('le debug anatomique recolore les pixels sans modifier la simulation', () => {
  const world = createWorld();
  const eye = world.particles.find((particle) => particle.profile === ANATOMY_PROFILES.eye);
  const frame = new Uint8ClampedArray(world.size * world.size * 4);
  const index = (Math.round(eye.y) * world.size + Math.round(eye.x)) * 4;
  const originalX = eye.x;
  world.writePixels(frame);
  const natural = [...frame.slice(index, index + 3)];
  world.writePixels(frame, { showAnatomy: true });
  const preview = [...frame.slice(index, index + 3)];
  assert.notDeepEqual(preview, natural);
  assert.deepEqual(preview, ANATOMY_PROFILES.eye.debug);
  assert.equal(eye.x, originalX);
  assert.equal(world.particles.length, PERSONA_PIXEL_MAP.count);
});

test('explosion, récupération et clignement conservent les particules sans valeur invalide', () => {
  const world = createWorld();
  world.reveal();
  for (let i = 0; i < 200; i++) world.step(1 / 60);
  world.explode();
  for (let i = 0; i < 210; i++) world.step(1 / 60);
  assert.equal(world.mode, 'idle');
  assert.equal(world.colorMix, 0);
  assert.equal(world.particles.length, PERSONA_PIXEL_MAP.count);
  assert.ok(world.particles.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  world.blinkStartedAt = world.clock - 0.11;
  assert.ok(world.getBlinkAmount() > 0.99);
  const frame = new Uint8ClampedArray(world.size * world.size * 4);
  world.writePixels(frame);
  assert.ok(frame.some((channel) => channel !== 0));
});

test('la V2.1 reste utilisable sans carte anatomique', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 2026 });
  assert.equal(world.anatomy, null);
  assert.ok(world.particles.every((p) => p.profile === undefined));
  world.explode();
  world.step(1 / 60);
  assert.ok(world.particles.every((p) => Number.isFinite(p.vx)));
});

test('l’anatomie avec graine reproduit exactement l’état physique', () => {
  const first = createWorld(42);
  const second = createWorld(42);
  for (const world of [first, second]) {
    world.reveal();
    for (let i = 0; i < 80; i++) world.step(1 / 60);
  }
  assert.deepEqual(first.particles.map(({ x, y, vx, vy }) => [x, y, vx, vy]),
    second.particles.map(({ x, y, vx, vy }) => [x, y, vx, vy]));
});
