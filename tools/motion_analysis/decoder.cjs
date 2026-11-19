'use strict';

const { gunzipSync } = require('node:zlib');

const MAX_FRAMES = 160;
const MAX_PARTICLES = 40000;
const MAX_UNCOMPRESSED_BYTES = 20_000_000;
const MAX_COMPRESSED_BYTES = 5_000_000;

function assertInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} invalide : ${String(value)}`);
  }
}

function readBase64(encoded, label) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new TypeError(`${label} : base64 invalide.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    throw new TypeError(`${label} : base64 non canonique.`);
  }
  return bytes;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const value of bytes) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function decodeRegionAssignments(pixelMap, anatomy, extraSources, particleCount) {
  const { width, height } = pixelMap;
  if (!anatomy || anatomy.width !== width || anatomy.height !== height ||
      !Array.isArray(anatomy.regions) || anatomy.regions.length === 0 ||
      anatomy.regions.length > 255 || new Set(anatomy.regions).size !== anatomy.regions.length) {
    throw new TypeError('Carte anatomique incompatible.');
  }

  const regions = new Uint8Array(width * height).fill(255);
  const anatomyRuns = readBase64(anatomy.runs, 'Anatomie');
  if (anatomyRuns.length % 4) throw new Error('Segments anatomiques tronqués.');
  for (let i = 0; i < anatomyRuns.length; i += 4) {
    const [y, x, length, region] = anatomyRuns.subarray(i, i + 4);
    if (!length || y >= height || x + length > width || region >= anatomy.regions.length) {
      throw new Error('Segment anatomique hors limites.');
    }
    for (let column = x; column < x + length; column += 1) {
      const index = y * width + column;
      if (regions[index] !== 255) throw new Error('Chevauchement anatomique.');
      regions[index] = region;
    }
  }

  const pixelRuns = readBase64(pixelMap.runs, 'Carte de particules');
  if (pixelRuns.length % 4) throw new Error('Carte de particules tronquée.');
  const sourceRegions = [];
  const sourceEye = [];
  for (let i = 0; i < pixelRuns.length; i += 4) {
    const [y, x, length, shade] = pixelRuns.subarray(i, i + 4);
    if (!length || y >= height || x + length > width || shade < 1 || shade > 3) {
      throw new Error('Segment de particules hors limites.');
    }
    for (let column = x; column < x + length; column += 1) {
      const region = regions[y * width + column];
      if (region === 255) throw new Error('Particule sans région anatomique.');
      sourceRegions.push(region);
      sourceEye.push(shade === 3);
    }
  }
  if (sourceRegions.length !== pixelMap.count || sourceRegions.length !== anatomy.count ||
      sourceRegions.length + extraSources.length !== particleCount) {
    throw new Error('La capacité du pool ne correspond pas à la carte source.');
  }

  const regionIds = new Uint8Array(particleCount);
  const eyeIds = new Uint8Array(particleCount);
  for (let index = 0; index < particleCount; index += 1) {
    const source = index < sourceRegions.length ? index : extraSources[index - sourceRegions.length];
    assertInteger(source, 0, sourceRegions.length - 1, 'Source de particule supplémentaire');
    regionIds[index] = sourceRegions[source];
    eyeIds[index] = sourceEye[source] ? 1 : 0;
  }
  return { regionIds, eyeIds, sourceChecksum: adler32(pixelRuns) };
}

function decodeAnimation(animation, pixelMap, anatomy) {
  if (!animation || !pixelMap || !anatomy ||
      animation.encoding !== 'gzip-particle-major-rgb3-dynamic' ||
      animation.width !== pixelMap.width || animation.height !== pixelMap.height) {
    throw new TypeError('Animation dynamique incompatible avec le pixel map.');
  }
  assertInteger(animation.width, 1, 255, 'Largeur');
  assertInteger(animation.height, 1, 255, 'Hauteur');
  assertInteger(animation.frameCount, 2, MAX_FRAMES, 'Nombre de frames');
  assertInteger(animation.particleCount, 1, MAX_PARTICLES, 'Capacité des particules');
  assertInteger(animation.durationMs, 1, 60_000, 'Durée');
  if (typeof animation.name !== 'string' || !/^[a-z][a-z-]{0,49}$/.test(animation.name) ||
      !Array.isArray(animation.frameActiveCounts) ||
      animation.frameActiveCounts.length !== animation.frameCount ||
      animation.frameActiveCounts.some(n => !Number.isSafeInteger(n) || n <= 0 || n > animation.particleCount) ||
      !Array.isArray(animation.extraSources)) {
    throw new TypeError('Métadonnées d’animation invalides.');
  }

  const { regionIds, eyeIds, sourceChecksum } = decodeRegionAssignments(
    pixelMap, anatomy, animation.extraSources, animation.particleCount);
  if (animation.sourceChecksum !== sourceChecksum) {
    throw new Error('Checksum de la carte source incompatible.');
  }
  const expectedLength = animation.particleCount * animation.frameCount * 3;
  if (expectedLength > MAX_UNCOMPRESSED_BYTES) {
    throw new RangeError('Animation non compressée trop volumineuse.');
  }
  const compressed = readBase64(animation.payload, 'Animation');
  if (compressed.length > MAX_COMPRESSED_BYTES) throw new RangeError('Animation compressée trop volumineuse.');
  const decoded = gunzipSync(compressed, { maxOutputLength: expectedLength });
  if (decoded.length !== expectedLength) throw new Error('Taille de l’animation incohérente.');

  const frames = Array.from({ length: animation.frameCount },
    () => new Uint8Array(animation.particleCount * 3));
  const counts = new Uint32Array(frames.length);
  const occupied = frames.map(() => new Uint8Array(animation.width * animation.height));
  for (let particle = 0; particle < animation.particleCount; particle += 1) {
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const position = (particle * frames.length + frameIndex) * 3;
      const x = decoded[position];
      const y = decoded[position + 1];
      const shade = decoded[position + 2];
      if (x >= animation.width || y >= animation.height || shade > 3 ||
          (shade !== 0 && (shade === 3) !== Boolean(eyeIds[particle]))) {
        throw new Error(`Pixel invalide dans la frame ${frameIndex + 1}, particule ${particle}.`);
      }
      const destination = particle * 3;
      frames[frameIndex][destination] = x;
      frames[frameIndex][destination + 1] = y;
      frames[frameIndex][destination + 2] = shade;
      if (!shade) continue;
      const pixel = y * animation.width + x;
      if (occupied[frameIndex][pixel]) throw new Error(`Pixel dupliqué dans la frame ${frameIndex + 1}.`);
      occupied[frameIndex][pixel] = 1;
      counts[frameIndex] += 1;
    }
  }
  counts.forEach((count, index) => {
    if (count !== animation.frameActiveCounts[index]) {
      throw new Error(`Population invalide pour la frame ${index + 1}.`);
    }
  });

  return {
    name: animation.name,
    width: animation.width,
    height: animation.height,
    frameCount: animation.frameCount,
    frameDurationMs: animation.durationMs / animation.frameCount,
    particleCount: animation.particleCount,
    sourceParticleCount: pixelMap.count,
    regionNames: anatomy.regions,
    regionIds,
    frames,
  };
}

module.exports = { decodeAnimation, adler32 };
