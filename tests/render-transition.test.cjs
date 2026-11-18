const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function createRenderHarness() {
  const draws = [];
  let presentation = { state: 'idle', frame: 0, previous: null };
  const alphaStack = [];
  const context = {
    globalAlpha: 1,
    save() { alphaStack.push(this.globalAlpha); },
    restore() { this.globalAlpha = alphaStack.pop(); },
    clearRect() {},
    setTransform() {},
    drawImage(sprite) { draws.push({ name: sprite.name, opacity: this.globalAlpha }); },
  };
  const canvas = { getContext: () => context, addEventListener() {} };
  const element = { addEventListener() {}, setAttribute() {} };
  const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
  const sandbox = {
    document: { querySelector: (selector) => selector === '#mascot' ? canvas : element },
    window: { matchMedia: () => ({ matches: false }) },
    AnimationPlayer: class {
      setReducedMotion() {}
      getPresentation() { return presentation; }
    },
    ANIMATION_CLIPS: { hit: { src: '/hit.png', frames: 8 } },
    FRAME_SIZE: { width: 250, height: 251 },
    Image: class { set src(value) { this._src = value; } },
    buildAnimationAtlases() { throw new Error('Ne doit pas être appelé sans chargement d’image'); },
  };
  vm.runInNewContext(`${source}\nglobalThis.testApi = { render, sprites };`, sandbox);
  for (const state of ['idle', 'blink', 'hit']) {
    sandbox.testApi.sprites.set(state, { name: state });
  }

  return {
    show(nextPresentation) {
      presentation = nextPresentation;
      draws.length = 0;
      sandbox.testApi.render();
      return [...draws];
    },
  };
}

test('sans transition, une seule image est dessinée à pleine opacité', () => {
  const render = createRenderHarness();
  assert.deepEqual(render.show({ state: 'idle', frame: 4, previous: null }), [
    { name: 'idle', opacity: 1 },
  ]);
});

test('pendant un fondu, l’ancienne image reste opaque et la suivante apparaît dessus', () => {
  const render = createRenderHarness();
  assert.deepEqual(render.show({ state: 'hit', frame: 0, previous: { state: 'idle', frame: 3, alpha: 0.5 } }), [
    { name: 'idle', opacity: 1 },
    { name: 'hit', opacity: 0.5 },
  ]);
});

test('aux extrémités du fondu, la silhouette est dessinée une seule fois', () => {
  const render = createRenderHarness();
  assert.deepEqual(render.show({ state: 'blink', frame: 0, previous: { state: 'idle', frame: 0, alpha: 1 } }), [
    { name: 'idle', opacity: 1 },
  ]);
  assert.deepEqual(render.show({ state: 'blink', frame: 1, previous: { state: 'idle', frame: 0, alpha: 0 } }), [
    { name: 'blink', opacity: 1 },
  ]);
});
