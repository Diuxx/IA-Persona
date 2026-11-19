/**
 * Particle animation driven by reference silhouettes, not sprite rendering.
 * Each pose contains one target (x, y, shade) per existing particle.
 * Correspondence is computed OFFLINE, so particle IDs and roles never change.
 */
const MAX_ANIMATION_FRAMES = 160;
const MAX_COMPRESSED_BYTES = 5_000_000;

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
        : animation.particleCount < world.sourceParticleCount || animation.particleCount > 40000) ||
      !Number.isFinite(animation.durationMs) || animation.durationMs <= 0 || animation.durationMs > 60000 ||
      !['gzip-particle-major-rgb3', 'gzip-particle-major-rgb3-dynamic'].includes(animation.encoding)) {
    throw new TypeError('Animation cible incompatible avec la simulation.');
  }
  if (animation.encoding === 'gzip-particle-major-rgb3-dynamic') {
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

async function decodeAnimation(animation, world) {
  validateAnimation(animation, world);
  const count = animation.particleCount;
  const expectedLength = count * animation.frameCount * 3;
  if (expectedLength > 20_000_000) throw new RangeError('Animation trop volumineuse.');
  const raw = await inflateGzip(animation.payload, expectedLength);
  if (raw.length !== expectedLength) throw new Error('Nombre de cibles incohérent.');
  const frames = Array.from({ length: animation.frameCount }, () => new Uint8Array(count * 3));
  const dynamic = animation.encoding === 'gzip-particle-major-rgb3-dynamic';
  const counts = new Uint32Array(frames.length);
  for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      const sourceOffset = (particleIndex * frames.length + frameIndex) * 3;
      const x = raw[sourceOffset];
      const y = raw[sourceOffset + 1];
      const shade = raw[sourceOffset + 2];
      const expectedEye = particleIndex < world.sourceParticleCount && world.particles[particleIndex].eye;
      if (x >= animation.width || y >= animation.height || shade > 3 ||
          (!dynamic && shade === 0) || (shade !== 0 && Boolean(expectedEye) !== (shade === 3))) {
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
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
      if (counts[frameIndex] !== animation.frameActiveCounts[frameIndex]) {
        throw new Error(`Population incohérente : frame ${frameIndex + 1}.`);
      }
      const occupied = new Uint8Array(animation.width * animation.height);
      const frame = frames[frameIndex];
      for (let i = 0; i < count; i += 1) {
        if (!frame[i * 3 + 2]) continue;
        const pixel = frame[i * 3 + 1] * animation.width + frame[i * 3];
        if (occupied[pixel]) throw new Error(`Pixels dupliqués : frame ${frameIndex + 1}.`);
        occupied[pixel] = 1;
      }
    }
    world.enableDynamicPopulation(animation);
  }
  return frames;
}

class TargetAnimationPlayer {
  constructor(world, animation, frames) {
    this.world = world;
    this.animation = animation;
    this.fullFrames = frames;
    this.frames = frames;
    // A fixed subset avoids quality-cap flicker: identities never swap during playback.
    this.qualityOrder = null;
    if (world.dynamicPopulation) {
      const occurrence = new Uint8Array(world.particles.length);
      for (const frame of frames) {
        for (let index = 0; index < occurrence.length; index += 1) {
          if (frame[index * 3 + 2] !== 0) occurrence[index] += 1;
        }
      }
      const ranked = world.particleRank.map(item => item.index)
        .sort((a, b) => occurrence[b] - occurrence[a] || a - b);
      this.qualityOrder = {
        eye: ranked.filter(index => world.particles[index].eye),
        body: ranked.filter(index => !world.particles[index].eye),
      };
    }
    this.elapsed = 0;
    this.frame = 0;
    this.loopEndFrame = frames.length - 1;
    this.speed = 1;
    this.loop = true;
    this.playing = false;
    this.inspecting = false;
  }

  static async create(world, animation) {
    if (!world || !Array.isArray(world.particles)) {
      throw new TypeError('Une simulation de particules est requise.');
    }
    const frames = await decodeAnimation(animation, world);
    return new TargetAnimationPlayer(world, animation, frames);
  }

  get frameDurationMs() {
    return this.animation.durationMs / this.frames.length;
  }

  get sourcePlaybackDurationMs() {
    return (this.loopEndFrame + 1) * this.frameDurationMs;
  }

  get playbackDurationMs() {
    return this.sourcePlaybackDurationMs / this.speed;
  }

  setSpeed(speed) {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 3) {
      throw new RangeError('Vitesse d’animation hors limites (0,25–3×).');
    }
    this.speed = speed;
    return true;
  }

  play({ loop = true } = {}) {
    if (typeof loop !== 'boolean') throw new TypeError('La boucle doit être un booléen.');
    this.loop = loop;
    this.elapsed = 0;
    this.inspecting = false;
    this.playing = true;
    this.applyPose();
    return true;
  }

  /** Freeze at the nearest complete target frame so its original shape can be inspected. */
  pauseForInspection() {
    if (!this.playing || this.inspecting) return false;
    this.inspectFrame(this.frame);
    return true;
  }

  /** Frame indexes are zero-based in the API and one-based in the interface. */
  inspectFrame(index) {
    this.validateFrame(index);
    this.frame = index;
    this.elapsed = index * this.frameDurationMs / 1000;
    this.playing = true;
    this.inspecting = true;
    this.applyPose();
    // Exact inspection: do not leave the shape a few pixels behind its target.
    this.world.snapToTargetPose();
    return true;
  }

  resume() {
    if (!this.playing || !this.inspecting) return false;
    if (this.frame > this.loopEndFrame) this.elapsed = 0;
    this.inspecting = false;
    this.applyPose();
    return true;
  }

  /** Change the density cap without changing the persistent pool or the 43 reference poses. */
  setParticleCount(count) {
    const changed = this.world.setParticleCount(count);
    if (!changed) return false;
    if (this.world.dynamicPopulation) {
      const selected = new Uint8Array(this.world.particles.length);
      if (count !== 'auto') {
        // Keep an eye silhouette even on the smallest quality setting.
        const eyeBudget = Math.max(1, Math.min(this.qualityOrder.eye.length,
          Math.round(count * this.qualityOrder.eye.length / selected.length)));
        for (let i = 0; i < eyeBudget; i += 1) selected[this.qualityOrder.eye[i]] = 1;
        for (let i = 0; i < count - eyeBudget; i += 1) selected[this.qualityOrder.body[i]] = 1;
      }
      this.frames = this.fullFrames.map(sourceFrame => {
        if (count === 'auto') return sourceFrame;
        const filtered = sourceFrame.slice();
        for (let index = 0; index < selected.length; index += 1) {
          if (!selected[index]) filtered[index * 3 + 2] = 0;
        }
        return filtered;
      });
    } else {
      this.frames = this.fullFrames.map(sourceFrame => {
        const compact = new Uint8Array(count * 3);
        for (let index = 0; index < count; index += 1) {
          const sourceOffset = this.world.particles[index].sourceIndex * 3;
          compact.set(sourceFrame.subarray(sourceOffset, sourceOffset + 3), index * 3);
        }
        return compact;
      });
    }
    if (this.playing) {
      this.applyPose();
      if (this.inspecting) this.world.snapToTargetPose();
    }
    return true;
  }

  /** Non-destructive loop trimming: all 43 original frames remain available. */
  setLoopEndFrame(index) {
    this.validateFrame(index);
    if (index < 1) throw new RangeError('La boucle doit contenir au moins deux frames.');
    this.loopEndFrame = index;
    if (this.playing && !this.inspecting) {
      if (this.elapsed * 1000 >= this.sourcePlaybackDurationMs) this.elapsed = 0;
      this.applyPose();
    }
    return true;
  }

  validateFrame(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      throw new RangeError('Numéro de frame invalide.');
    }
  }

  stop() {
    if (!this.playing) return false;
    this.playing = false;
    this.inspecting = false;
    this.world.setTargetPose(null);
    return true;
  }

  advance(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Durée d’animation invalide.');
    }
    if (!this.playing || this.inspecting || this.world.paused || deltaSeconds === 0) return;
    const duration = this.sourcePlaybackDurationMs / 1000;
    this.elapsed += deltaSeconds * this.speed;
    if (this.elapsed >= duration && !this.loop) {
      this.stop();
      return;
    }
    this.elapsed %= duration;
    this.applyPose();
  }

  applyPose() {
    const position = this.elapsed * 1000 / this.frameDurationMs;
    // Inspection may target a frame outside the selected playback window.
    this.frame = Math.min(this.frames.length - 1, Math.floor(position));
    const next = this.inspecting || (!this.loop && this.frame === this.loopEndFrame)
      ? this.frame
      : this.frame === this.loopEndFrame ? 0 : this.frame + 1;
    this.world.setTargetPose({
      from: this.frames[this.frame],
      to: this.frames[next],
      blend: this.inspecting ? 0 : position - Math.floor(position),
    });
  }

  getSnapshot() {
    return Object.freeze({
      name: this.animation.name,
      playing: this.playing,
      inspecting: this.inspecting,
      frame: this.frame,
      frameCount: this.frames.length,
      visibleCount: this.world.dynamicPopulation ? this.world.visibleParticleCount : this.world.particles.length,
      requestedVisibleCount: this.animation.frameActiveCounts?.[this.frame] ?? this.world.particles.length,
      densityLimit: this.world.dynamicPopulation ? this.world.densityLimit : this.world.particles.length,
      frameDurationMs: this.frameDurationMs,
      speed: this.speed,
      loopEndFrame: this.loopEndFrame,
      playbackDurationMs: this.playbackDurationMs,
      progress: this.elapsed / (this.sourcePlaybackDurationMs / 1000),
      loop: this.loop,
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TargetAnimationPlayer, decodeAnimation, adler32 };
} else {
  window.TargetAnimationPlayer = TargetAnimationPlayer;
}
