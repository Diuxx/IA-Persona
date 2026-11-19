const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { decodeAnimation, adler32 } = require('../tools/motion_analysis/decoder.cjs');
const { analyzeMotion, phaseOffset } = require('../tools/motion_analysis/metrics.cjs');
const { parseArguments } = require('../tools/analyze_motion.cjs');

function fakeAsset() {
  const pixelRuns = Buffer.from([1, 1, 1, 1, 1, 2, 1, 2, 1, 3, 1, 3]);
  const anatomyRuns = Buffer.from([1, 1, 2, 0, 1, 3, 1, 1]);
  const map = {
    width: 6, height: 6, count: 3,
    runs: pixelRuns.toString('base64'),
  };
  const anatomy = {
    width: 6, height: 6, count: 3,
    regions: ['body', 'eye'],
    runs: anatomyRuns.toString('base64'),
  };
  const frames = [
    [[1, 1, 1], [2, 1, 2], [3, 1, 3], [1, 1, 0]],
    [[2, 1, 1], [3, 1, 2], [4, 1, 3], [1, 1, 0]],
    [[2, 2, 1], [3, 2, 2], [4, 2, 3], [2, 3, 1]],
    [[1, 1, 1], [2, 1, 2], [3, 1, 3], [1, 1, 0]],
  ];
  const particleMajor = [];
  for (let particle = 0; particle < 4; particle += 1) {
    for (const frame of frames) particleMajor.push(...frame[particle]);
  }
  const animation = {
    name: 'idle', width: 6, height: 6,
    frameCount: 4, durationMs: 160, particleCount: 4,
    sourceChecksum: adler32(pixelRuns),
    frameActiveCounts: [3, 3, 4, 3],
    extraSources: [0],
    encoding: 'gzip-particle-major-rgb3-dynamic',
    payload: gzipSync(Buffer.from(particleMajor)).toString('base64'),
  };
  return { animation, map, anatomy, frames };
}

test('décodage des positions et des régions anatomiques sans modifier les sources', () => {
  const fixture = fakeAsset();
  const original = structuredClone(fixture.animation);
  const decoded = decodeAnimation(fixture.animation, fixture.map, fixture.anatomy);
  assert.equal(decoded.frameDurationMs, 40);
  assert.equal(decoded.frameCount, 4);
  assert.deepEqual([...decoded.regionIds], [0, 0, 1, 0]);
  assert.deepEqual([...decoded.frames[2].subarray(9, 12)], [2, 3, 1]);
  assert.deepEqual(fixture.animation, original);
});

test('formes en translation : trajectoires et changement de silhouette sont distingués', () => {
  const fixture = fakeAsset();
  const profile = analyzeMotion(decodeAnimation(fixture.animation, fixture.map, fixture.anatomy));
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.analysisKind, 'target-poses-not-rendered-physics');
  assert.equal(profile.frames.length, 4);
  assert.equal(profile.transitions.length, 4);
  assert.equal(profile.transitions[0].meanMatchedSpeedPxPerSec, 25);
  assert.equal(profile.transitions[0].centroidSpeedPxPerSec, 25);
  assert.equal(profile.transitions[0].alignedSilhouetteIoU, 1);
  assert.equal(profile.transitions[0].silhouetteIoU, 0.5);
  assert.equal(profile.population.minVisible, 3);
  assert.equal(profile.population.maxVisible, 4);
  assert.ok(profile.regionSummaries.eye.relativeToBodyAmplitudePx >= 0);
});

test('apparitions, disparitions et bouclage 4→1 sont bien comptabilisés', () => {
  const fixture = fakeAsset();
  const profile = analyzeMotion(decodeAnimation(fixture.animation, fixture.map, fixture.anatomy));
  assert.equal(profile.transitions[1].appearances, 1);
  assert.equal(profile.transitions[2].disappearances, 1);
  assert.equal(profile.transitions[3].fromFrame, 4);
  assert.equal(profile.transitions[3].toFrame, 1);
  assert.equal(profile.timing.seam.silhouetteIoU, 1);
  assert.equal(profile.timing.seam.centroidSpeedPxPerSec, 0);
  assert.equal(profile.timing.seam.appearances, 0);
});

test('validation explicite des corruptions et des données incohérentes', () => {
  const fixture = fakeAsset();
  const { animation, map, anatomy } = fixture;
  assert.throws(() => decodeAnimation({ ...animation, sourceChecksum: 1 }, map, anatomy), /Checksum/);
  assert.throws(() => decodeAnimation({ ...animation, frameActiveCounts: [3, 3, 3, 3] }, map, anatomy), /Population/);
  assert.throws(() => decodeAnimation({ ...animation, extraSources: [800] }, map, anatomy), /Source de particule/);
  assert.throws(() => decodeAnimation({ ...animation, payload: '!!!' }, map, anatomy), /base64/);
  assert.throws(() => decodeAnimation({ ...animation, particleCount: 90000 }, map, anatomy), /Capacité/);
  assert.throws(() => decodeAnimation({ ...animation, payload: gzipSync(Buffer.alloc(1000)).toString('base64') }, map, anatomy), /volume|Taille|larger|output|too large|buffer/i);
});

test('une même entrée produit un profil strictement déterministe et des annotations vides', () => {
  const fixture = fakeAsset();
  const decoded = decodeAnimation(fixture.animation, fixture.map, fixture.anatomy);
  const a = analyzeMotion(decoded);
  const b = analyzeMotion(decoded);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.annotations.movementType, null);
  assert.deepEqual(a.annotations.styleTags, []);
  assert.equal(a.annotations.validatedByHuman, false);
  assert.equal(phaseOffset([1, 1, 1, 1], [2, 3, 4, 5], 40), null);
});

test('ligne de commande : refuse les options et les arguments incomplets', () => {
  assert.equal(parseArguments(['--check']).check, true);
  assert.throws(() => parseArguments(['--delete-all']), /Option inconnue/);
  assert.throws(() => parseArguments(['--output']), /Valeur requise/);
});
