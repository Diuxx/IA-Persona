const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function createFakeCanvas() {
  const operations = [];
  const context = {
    drawImage: (...args) => operations.push(['drawImage', ...args]),
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillRect: () => {},
  };
  return { width: 0, height: 0, operations, getContext: () => context };
}

const created = [];
const sandbox = {
  document: {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = createFakeCanvas();
      created.push(canvas);
      return canvas;
    },
  },
};
const source = readFileSync(join(__dirname, '../sprite-atlas.js'), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'sprite-atlas.js' });

test('génère idle et blink sans lire les pixels des Canvas', () => {
  const result = sandbox.buildAnimationAtlases({ width: 2000, height: 251 });
  assert.equal(result.idle.width, 6000);
  assert.equal(result.blink.width, 2000);
  assert.equal(result.hit.width, 2000);
  assert.ok(created.some((canvas) => canvas.operations.length > 0));
});

test('rejette une planche Hit aux dimensions incorrectes', () => {
  assert.throws(() => sandbox.buildAnimationAtlases({ width: 251, height: 251 }), /8 images/);
});
