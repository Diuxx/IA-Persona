/** Validate and decode reference frames into persistent particle targets. */
const MAX_ANIMATION_FRAMES = 160;
const MAX_COMPRESSED_BYTES = 5_000_000;
const MAX_IDENTITIES = 40000;
const ANIMATION_KINDS = ['loop', 'one-shot'];
// Dynamic encodings let a clip use fewer identities than the shared pool.
const DYNAMIC_ENCODINGS = ['gzip-particle-major-rgb3-dynamic', 'gzip-particle-major-xy16-rgb'];
const SIGNED_COORDINATE_ENCODING = 'gzip-particle-major-xy16-rgb';

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const value of bytes) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

async function inflateGzip(base64, maxOutputBytes) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError('Taille maximale de décompression invalide.');
  }
  if (typeof base64 !== 'string' || base64.length > MAX_COMPRESSED_BYTES * 2) {
    throw new TypeError('Animation compressée invalide.');
  }
  let compressed;
  try {
    compressed = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
  } catch {
    throw new Error('Données d’animation base64 invalides.');
  }
  if (compressed.length > MAX_COMPRESSED_BYTES) {
    throw new RangeError('Animation compressée trop volumineuse.');
  }
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Ce navigateur ne prend pas en charge DecompressionStream (gzip).');
  }
  const reader = new Blob([compressed]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let decompressedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      decompressedBytes += value.byteLength;
      if (decompressedBytes > maxOutputBytes) {
        throw new RangeError('Animation décompressée plus volumineuse que prévu.');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RangeError) throw error;
    throw new Error('Décompression de l’animation impossible.', { cause: error });
  } finally {
    reader.releaseLock();
  }

  // Allocate only after validating the total output size, not for untrusted gzip data.
  const output = new Uint8Array(decompressedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateAnimation(animation, world) {
  if (!animation || typeof animation.name !== 'string' || !/^[a-z][a-z-]{0,49}$/.test(animation.name) ||
      animation.width !== world.map.width || animation.height !== world.map.height ||
      !Number.isInteger(animation.frameCount) || animation.frameCount < 2 ||
      animation.frameCount > MAX_ANIMATION_FRAMES ||
      (animation.encoding === 'gzip-particle-major-rgb3'
        ? animation.particleCount !== world.particles.length
        : animation.particleCount < world.sourceParticleCount || animation.particleCount > MAX_IDENTITIES) ||
      !Number.isFinite(animation.durationMs) || animation.durationMs <= 0 || animation.durationMs > 60000 ||
      !['gzip-particle-major-rgb3', ...DYNAMIC_ENCODINGS].includes(animation.encoding) ||
      !ANIMATION_KINDS.includes(animation.kind ?? 'loop')) {
    throw new TypeError('Animation cible incompatible avec la simulation.');
  }
  if (DYNAMIC_ENCODINGS.includes(animation.encoding)) {
    if (!Array.isArray(animation.extraSources) ||
        animation.extraSources.length !== animation.particleCount - world.sourceParticleCount ||
        !Array.isArray(animation.frameActiveCounts) ||
        animation.frameActiveCounts.length !== animation.frameCount ||
        animation.frameActiveCounts.some(n => !Number.isInteger(n) || n <= 0 || n > animation.particleCount)) {
      throw new TypeError('Métadonnées de population dynamique invalides.');
    }
  }
  const sourceMap = Uint8Array.from(atob(world.map.runs), value => value.charCodeAt(0));
  if (animation.sourceChecksum !== adler32(sourceMap)) {
    throw new Error('La carte source ne correspond pas à celle utilisée pour l’animation.');
  }
}

/** Eye flag of an identity, read without mutating the world (identities may not exist yet). */
function identityIsEye(animation, world, particleIndex) {
  if (particleIndex < world.sourceParticleCount) return Boolean(world.allParticles[particleIndex].eye);
  const sourceIndex = animation.extraSources[particleIndex - world.sourceParticleCount];
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= world.sourceParticleCount) {
    throw new RangeError('Source d’une particule supplémentaire invalide.');
  }
  return Boolean(world.allParticles[sourceIndex].eye);
}

async function decodeAnimation(animation, world) {
  validateAnimation(animation, world);
  const count = animation.particleCount;
  const frameCount = animation.frameCount;
  const signed = animation.encoding === SIGNED_COORDINATE_ENCODING;
  const dynamic = animation.encoding !== 'gzip-particle-major-rgb3';
  const bytesPerTarget = signed ? 5 : 3;
  const expectedLength = count * frameCount * bytesPerTarget;
  if (expectedLength > 20_000_000) throw new RangeError('Animation trop volumineuse.');
  const raw = await inflateGzip(animation.payload, expectedLength);
  if (raw.length !== expectedLength) throw new Error('Nombre de cibles incohérent.');

  // Everything is validated before the shared pool may grow: a rejected clip leaves the world intact.
  const FrameArray = signed ? Int16Array : Uint8Array;
  const frames = Array.from({ length: frameCount }, () => new FrameArray(count * 3));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const counts = new Uint32Array(frameCount);
  for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
    const expectedEye = identityIsEye(animation, world, particleIndex);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const sourceOffset = (particleIndex * frameCount + frameIndex) * bytesPerTarget;
      let x;
      let y;
      let shade;
      if (signed) {
        x = view.getInt16(sourceOffset, true);
        y = view.getInt16(sourceOffset + 2, true);
        shade = raw[sourceOffset + 4];
        if (x < -world.originX || x >= world.size - world.originX ||
            y < -world.originY || y >= world.size - world.originY) {
          throw new Error(`Position hors scène : frame ${frameIndex}, particule ${particleIndex}.`);
        }
      } else {
        x = raw[sourceOffset];
        y = raw[sourceOffset + 1];
        shade = raw[sourceOffset + 2];
        if (x >= animation.width || y >= animation.height) {
          throw new Error(`Position ou couleur invalide : frame ${frameIndex}, particule ${particleIndex}.`);
        }
      }
      if (shade > 3 || (!dynamic && shade === 0) || (shade !== 0 && expectedEye !== (shade === 3))) {
        throw new Error(`Position ou couleur invalide : frame ${frameIndex}, particule ${particleIndex}.`);
      }
      const targetOffset = particleIndex * 3;
      frames[frameIndex][targetOffset] = x;
      frames[frameIndex][targetOffset + 1] = y;
      frames[frameIndex][targetOffset + 2] = shade;
      if (shade) counts[frameIndex] += 1;
    }
  }
  if (dynamic) {
    // Pixel uniqueness is checked in the coordinate space of the clip.
    const width = signed ? world.size : animation.width;
    const height = signed ? world.size : animation.height;
    const offsetX = signed ? world.originX : 0;
    const offsetY = signed ? world.originY : 0;
    const occupied = new Uint8Array(width * height);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (counts[frameIndex] !== animation.frameActiveCounts[frameIndex]) {
        throw new Error(`Population incohérente : frame ${frameIndex + 1}.`);
      }
      occupied.fill(0);
      const frame = frames[frameIndex];
      for (let i = 0; i < count; i += 1) {
        if (!frame[i * 3 + 2]) continue;
        const pixel = (frame[i * 3 + 1] + offsetY) * width + frame[i * 3] + offsetX;
        if (occupied[pixel]) throw new Error(`Pixels dupliqués : frame ${frameIndex + 1}.`);
        occupied[pixel] = 1;
      }
    }
    world.enableDynamicPopulation(animation);
  }
  if (world.particles.length === count) return frames;
  // Identities beyond this clip exist in the shared pool but stay inactive (shade 0).
  return frames.map(frame => {
    const pooled = new FrameArray(world.particles.length * 3);
    pooled.set(frame);
    return pooled;
  });
}

const TargetAnimationCodec = Object.freeze({ decodeAnimation, adler32 });
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TargetAnimationCodec;
} else {
  window.TargetAnimationCodec = TargetAnimationCodec;
}
