const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { BehaviorController, BEHAVIOR_PRESETS } = require('../src/controller/behavior-controller.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

function createPersona() {
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  return { world, controller: new BehaviorController(world) };
}

function render(world, options) {
  const pixels = new Uint8ClampedArray(world.size * world.size * 4);
  world.writePixels(pixels, options);
  return pixels;
}

test('tous les comportements ne pilotent que des coefficients physiques, sans palette implicite', () => {
  for (const preset of Object.values(BEHAVIOR_PRESETS)) {
    assert.equal(Object.hasOwn(preset, 'tint'), false);
    assert.equal(Object.hasOwn(preset, 'accent'), false);
  }
  const { world, controller } = createPersona();
  const reference = render(world);
  for (const state of Object.keys(BEHAVIOR_PRESETS)) {
    controller.setState(state);
    controller.advance(0.5);
    assert.deepEqual(render(world), reference, `l'état ${state} ne doit pas recolorer les pixels`);
  }
});

test('les états animent la silhouette sans injecter de couleurs artificielles', () => {
  for (const state of Object.keys(BEHAVIOR_PRESETS)) {
    const { world, controller } = createPersona();
    controller.setState(state);
    controller.advance(0.5);
    for (let i = 0; i < 50; i++) {
      controller.advance(1 / 60);
      world.step(1 / 60);
    }
    const frame = render(world);
    let visible = 0;
    for (let i = 0; i < frame.length; i += 4) {
      if (frame[i + 3] === 0) continue;
      visible++;
      assert.ok(Math.abs(frame[i] - frame[i + 1]) <= 1, `${state}: red/green channels differ`);
      assert.ok(Math.abs(frame[i + 1] - frame[i + 2]) <= 3, `${state}: artificial accent detected`);
    }
    assert.ok(visible > 3000, `${state}: le nuage doit rester visible`);
  }
});

test('les teintes des effets manuels restent indépendantes de l’état actif', () => {
  const { world, controller } = createPersona();
  controller.setState('thinking');
  controller.advance(0.5);
  const before = render(world);
  world.setAccent('#ff0000');
  assert.deepEqual(render(world), before, 'changer la couleur d’effet ne doit pas recolorer l’état');
  world.explode();
  const colored = render(world);
  assert.ok(colored.some((value, i) => i % 4 === 0 && value > 80 &&
    value > colored[i + 1] + 25), 'la teinte d’explosion reste personnalisable');
});
