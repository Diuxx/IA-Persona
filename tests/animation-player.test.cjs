const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AnimationPlayer, ANIMATION_CLIPS, FRAME_SIZE } = require('../animation-player.js');

test('les trois états utilisent des frames de dimensions identiques', () => {
  assert.deepEqual(Object.keys(ANIMATION_CLIPS), ['idle', 'blink', 'hit']);
  assert.deepEqual(FRAME_SIZE, { width: 250, height: 251 });
  assert.equal(ANIMATION_CLIPS.idle.frames, 24);
  assert.equal(ANIMATION_CLIPS.blink.frames, 8);
  assert.equal(ANIMATION_CLIPS.hit.frames, 8);
});

test('idle boucle sans reconstruire une pose', () => {
  const player = new AnimationPlayer({ random: () => 1, blinkMin: 20, blinkMax: 20 });
  for (let i = 0; i < 50; i++) player.advance(0.05);
  assert.equal(player.state, 'idle');
  assert.equal(player.getFrameIndex(), 6);
});

test('hit se termine et revient à idle', () => {
  const player = new AnimationPlayer();
  assert.equal(player.triggerHit(), true);
  assert.equal(player.triggerHit(), false);
  for (let i = 0; i < 21; i++) player.advance(0.05);
  assert.equal(player.state, 'idle');
  assert.equal(player.triggerHit(), true);
});

test('blink peut être déclenché et ne peut pas interrompre hit', () => {
  const player = new AnimationPlayer();
  assert.equal(player.triggerBlink(), true);
  assert.equal(player.triggerHit(), true);
  assert.equal(player.triggerBlink(), false);
});

test('un double clignement se joue à la suite du premier', () => {
  const player = new AnimationPlayer({ random: () => 0, blinkMin: 0.1, blinkMax: 0.1, doubleBlinkChance: 1 });
  for (let i = 0; i < 2; i++) player.advance(0.05);
  assert.equal(player.state, 'blink');
  for (let i = 0; i < 6; i++) player.advance(0.05);
  assert.equal(player.state, 'idle');
  for (let i = 0; i < 3; i++) player.advance(0.05);
  assert.equal(player.state, 'blink');
  assert.equal(player.pendingDoubleBlink, false);
});

test('pause et réduction de mouvements bloquent les changements d’état', () => {
  const player = new AnimationPlayer();
  player.paused = true;
  assert.equal(player.triggerHit(), false);
  player.advance(4);
  assert.equal(player.stateElapsed, 0);
  player.paused = false;
  assert.equal(player.triggerHit(), true);
  player.setReducedMotion(true);
  assert.equal(player.state, 'idle');
  assert.equal(player.triggerHit(), false);
  player.advance(4);
  assert.equal(player.stateElapsed, 0);
});

test('vitesse et préférences invalides sont contrôlées', () => {
  const player = new AnimationPlayer();
  assert.throws(() => player.setSpeed(0), RangeError);
  assert.throws(() => player.setSpeed(Infinity), RangeError);
  player.setSpeed(150);
  player.advance(0.05);
  assert.ok(player.stateElapsed > 0.07);
  assert.throws(() => new AnimationPlayer({ blinkMin: 0 }), RangeError);
  assert.throws(() => new AnimationPlayer({ doubleBlinkChance: -1 }), RangeError);
});
