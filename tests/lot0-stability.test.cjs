const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld, createSeededRandom } = require('../particle-world.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');

const frameBuffer = (world) => new Uint8ClampedArray(world.size * world.size * 4);

function smallWorld() {
  // One dark body pixel, one white-eye pixel. Neither belongs to a rendered asset.
  const map = {
    width: 5,
    height: 5,
    palette: [[0, 0, 0, 0], [6, 6, 8, 255], [51, 51, 54, 255], [224, 224, 222, 255]],
    runs: Buffer.from([1, 1, 1, 1, 1, 2, 1, 3]).toString('base64'),
    count: 2,
  };
  return new ParticleWorld(map, { size: 20, seed: 7 });
}

test('une même graine reproduit exactement les particules et leurs mouvements', () => {
  const first = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 2026 });
  const second = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 2026 });
  for (const world of [first, second]) {
    world.reveal();
    for (let step = 0; step < 40; step++) world.step(1 / 60);
    world.explode();
    for (let step = 0; step < 45; step++) world.step(1 / 60);
  }
  assert.deepEqual(first.particles, second.particles);
  const firstFrame = frameBuffer(first);
  const secondFrame = frameBuffer(second);
  first.writePixels(firstFrame);
  second.writePixels(secondFrame);
  assert.deepEqual(firstFrame, secondFrame);
  assert.equal(first.clock, second.clock);
  const other = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 2027 });
  assert.notEqual(first.particles[0].phase, other.particles[0].phase);
});

test('les graines invalides ou mélangées à une source aléatoire sont refusées', () => {
  assert.throws(() => createSeededRandom(-1), RangeError);
  assert.throws(() => createSeededRandom(1.5), RangeError);
  assert.throws(() => createSeededRandom(Number.NaN), RangeError);
  assert.throws(() => new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 12, random: Math.random }), TypeError);
  const random = createSeededRandom(10);
  assert.ok(random() >= 0 && random() < 1);
});

test('le hit-test suit la position actuelle des pixels pendant la dispersion', () => {
  const world = smallWorld();
  const body = world.particles.find((particle) => !particle.eye);
  const origin = [body.x, body.y];
  for (const particle of world.particles) {
    particle.x += 8;
    particle.y += 7;
  }
  assert.equal(world.hitTest(...origin, 1), false);
  assert.equal(world.hitTest(body.x, body.y, 1), true);
  assert.equal(world.hitTest(body.x + 1, body.y + 1, 2), true);
  assert.equal(world.hitTest(-1, -1), false);
  assert.equal(world.hitTest(Number.NaN, 10), false);
  assert.equal(world.hitTest(2, 2, -1), false);
});

test('deux pixels superposés sont combinés, sans écrasement du premier', () => {
  const world = smallWorld();
  const body = world.particles.find((particle) => !particle.eye);
  const eye = world.particles.find((particle) => particle.eye);
  body.x = eye.x;
  body.y = eye.y;
  const buffer = frameBuffer(world);
  world.writePixels(buffer);
  const index = (Math.round(eye.y) * world.size + Math.round(eye.x)) * 4;
  assert.equal(world.lastCollisionCount, 1);
  assert.ok(buffer[index] > body.color[0], 'the eye remains visible despite the dark pixel');
  assert.ok(buffer[index] < eye.color[0], 'both particles contribute to the color');
  assert.equal(buffer[index + 3], 255);

  body.x += 3;
  world.writePixels(buffer);
  assert.equal(world.lastCollisionCount, 0);
  const darkIndex = (Math.round(body.y) * world.size + Math.round(body.x)) * 4;
  assert.equal(buffer[darkIndex], 6);
});

test('une réduction d’opacité lors d’un blink reste stable avec collisions', () => {
  const world = smallWorld();
  const body = world.particles.find((particle) => !particle.eye);
  const eye = world.particles.find((particle) => particle.eye);
  body.x = eye.x;
  body.y = eye.y;
  world.mode = 'idle';
  world.blinkStartedAt = 0;
  world.clock = 0.11; // max fermeture
  const buffer = frameBuffer(world);
  world.writePixels(buffer);
  const pixel = (Math.round(eye.y) * world.size + Math.round(eye.x)) * 4;
  assert.ok(buffer[pixel] < 60, 'the dark body remains underneath the nearly closed eye');
  assert.equal(buffer[pixel + 3], 255);
});

test('explode et reveal reviennent à idle après leur récupération', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 8 });
  world.explode();
  for (let index = 0; index < 200; index++) world.step(1 / 60);
  assert.equal(world.mode, 'idle');
  assert.equal(world.colorMix, 0);

  world.reveal();
  for (let index = 0; index < 200; index++) world.step(1 / 60);
  assert.equal(world.mode, 'idle');
  assert.equal(world.colorMix, 0);
  assert.ok(world.particles.every((particle) => Number.isFinite(particle.x) && Number.isFinite(particle.y)));
});

test('un hit interrompt une révélation en cours sans réinitialiser artificiellement la position', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 5 });
  world.reveal();
  world.step(1 / 60);
  const particle = world.particles[0];
  const position = [particle.x, particle.y];
  world.explode();
  assert.equal(world.mode, 'explode');
  assert.deepEqual([particle.x, particle.y], position);
  world.step(1 / 60);
  assert.ok(Number.isFinite(particle.x) && Number.isFinite(particle.y));
});

test('la pause préserve intégralement simulation, couleurs et positions', () => {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { seed: 10 });
  world.reveal();
  world.step(1 / 60);
  world.paused = true;
  const snapshot = {
    state: world.mode,
    time: world.clock,
    modeTime: world.modeTime,
    colorMix: world.colorMix,
    particles: world.particles.map((p) => [p.x, p.y, p.vx, p.vy]),
  };
  for (let index = 0; index < 50; index++) world.step(1 / 60);
  assert.equal(world.mode, snapshot.state);
  assert.equal(world.clock, snapshot.time);
  assert.equal(world.modeTime, snapshot.modeTime);
  assert.equal(world.colorMix, snapshot.colorMix);
  assert.deepEqual(world.particles.map((p) => [p.x, p.y, p.vx, p.vy]), snapshot.particles);
  assert.equal(world.explode(), false);
  world.paused = false;
  world.step(1 / 60);
  assert.ok(world.clock > snapshot.time);
});

test('les pas de simulation invalides sont rejetés avant de contaminer les coordonnées', () => {
  const world = smallWorld();
  assert.throws(() => world.step(Number.NaN), RangeError);
  assert.throws(() => world.step(-1), RangeError);
  assert.throws(() => world.step(Infinity), RangeError);
  assert.ok(world.particles.every((particle) => Number.isFinite(particle.x)));
});
