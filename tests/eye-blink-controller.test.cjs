const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EyeBlinkController } = require('../eye-blink-controller.js');

test('l’œil reste ouvert jusqu’au prochain clignement', () => {
  const blink = new EyeBlinkController({ random: () => 0.5 });
  assert.equal(blink.closureAt(0), 0);
  assert.equal(blink.closureAt(5), 0);
});

test('un clignement ferme puis rouvre l’œil de manière continue', () => {
  const blink = new EyeBlinkController({ random: () => 0.5 });
  blink.blinkNow(1);
  assert.equal(blink.closureAt(1), 0);
  assert.ok(blink.closureAt(1.04) > 0);
  assert.equal(blink.closureAt(1.09), 1);
  assert.ok(blink.closureAt(1.17) < 1);
  assert.equal(blink.closureAt(1.23), 0);
});

test('un double clignement contient deux fermetures distinctes', () => {
  const blink = new EyeBlinkController({ random: () => 0.5 });
  blink.blinkNow(2);
  blink.doubleBlink = true;
  assert.equal(blink.closureAt(2.09), 1);
  assert.equal(blink.closureAt(2.25), 0);
  assert.equal(blink.closureAt(2.38), 1);
  assert.equal(blink.closureAt(2.52), 0);
});

test('l’échéance suivante respecte les intervalles configurés', () => {
  const blink = new EyeBlinkController({ random: () => 0, minInterval: 4, maxInterval: 8, doubleBlinkChance: 0 });
  assert.equal(blink.nextStart, 4);
  assert.equal(blink.closureAt(4.3), 0);
  assert.equal(blink.nextStart, 8.3);
});

test('un grand saut temporel n’entraîne pas une rafale de clignements', () => {
  const blink = new EyeBlinkController({ random: () => 0.5 });
  assert.equal(blink.closureAt(100), 0);
  assert.ok(blink.nextStart > 100);
});

test('les paramètres invalides sont rejetés', () => {
  assert.throws(() => new EyeBlinkController({ minInterval: 0 }), RangeError);
  assert.throws(() => new EyeBlinkController({ minInterval: 8, maxInterval: 5 }), RangeError);
  assert.throws(() => new EyeBlinkController({ doubleBlinkChance: 2 }), RangeError);
});
