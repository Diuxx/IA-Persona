const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/**
 * Reproduce classic <script defer> semantics: all files share one browser global
 * lexical environment. CommonJS require() evaluates each file in an isolated
 * module scope and cannot catch duplicate top-level const declarations.
 */
test('le lecteur et le codec chargent sans collision dans le même contexte navigateur', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"/g)].map((match) => match[1]);

  const codecPath = './src/animation/target-animation-codec.js';
  const playerPath = './src/animation/target-animation-player.js';
  const codecIndex = scripts.indexOf(codecPath);
  const playerIndex = scripts.indexOf(playerPath);

  assert.ok(codecIndex >= 0, 'codec absent de index.html');
  assert.ok(playerIndex > codecIndex, 'le codec doit être chargé avant le lecteur');

  const browser = vm.createContext({});
  browser.window = browser;

  for (const scriptPath of scripts.slice(0, playerIndex + 1)) {
    const filename = path.join(root, scriptPath);
    const code = fs.readFileSync(filename, 'utf8');
    vm.runInContext(code, browser, { filename });
  }

  assert.equal(typeof browser.TargetAnimationCodec.decodeAnimation, 'function');
  assert.equal(typeof browser.TargetAnimationPlayer, 'function');
  assert.equal(vm.runInContext('typeof TargetAnimationPlayer', browser), 'function');
  assert.equal(vm.runInContext('typeof decodeAnimation', browser), 'undefined',
    'decodeAnimation doit rester privé au module');
});
