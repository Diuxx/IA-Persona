/**
 * Playback clock, inspection, quality and pose transitions for particle clips.
 * All decoding and asset validation live in target-animation-codec.js.
 */
const { decodeAnimation, adler32 } = typeof module !== 'undefined' && module.exports
  ? require('./target-animation-codec.js')
  : window.TargetAnimationCodec;

/** Ease-in-out timing for one-shot clips: zero speed at both ends, no abrupt stop. */
function smoothstep(value) {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}

/** Exact inverse of smoothstep, so an inspected frame resumes at the same pose. */
function inverseSmoothstep(value) {
  const progress = Math.max(0, Math.min(1, value));
  return 0.5 - Math.sin(Math.asin(1 - 2 * progress) / 3);
}

class TargetAnimationPlayer {
  constructor(world, animation, frames) {
    this.world = world;
    this.animation = animation;
    this.kind = animation.kind ?? 'loop';
    this.fullFrames = frames;
    this.frames = frames;
    // Density cap currently applied to this.frames; re-applied lazily when the shared cap changes.
    this.qualityLimit = null;
    // A fixed subset avoids quality-cap flicker: identities never swap during playback.
    this.qualityOrder = null;
    if (world.dynamicPopulation) {
      // Quality works on this clip's own identities, not on the larger shared pool.
      const identityCount = animation.particleCount;
      const occurrence = new Uint8Array(world.particles.length);
      for (const frame of frames) {
        for (let index = 0; index < identityCount; index += 1) {
          if (frame[index * 3 + 2] !== 0) occurrence[index] += 1;
        }
      }
      const ranked = world.particleRank.map(item => item.index)
        .filter(index => index < identityCount)
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
    this.loop = this.kind === 'loop';
    this.playing = false;
    this.inspecting = false;
    // A completed one-shot briefly holds its pose until the controller handles its successor.
    this.held = false;
    this.completed = false;
  }

  static async create(world, animation) {
    if (!world || !Array.isArray(world.particles)) {
      throw new TypeError('Une simulation de particules est requise.');
    }
    const frames = await decodeAnimation(animation, world);
    return new TargetAnimationPlayer(world, animation, frames);
  }

  /**
   * Decode several clips into one shared pool. The largest clip goes first so the pool
   * grows once; smaller clips are prefixes and pad to it. Returns players in input order.
   */
  static async createClips(world, animations) {
    const names = new Set(animations.map(animation => animation.name));
    if (names.size !== animations.length) throw new RangeError('Noms d’animation en double.');
    const byName = new Map();
    const largestFirst = [...animations].sort((a, b) => b.particleCount - a.particleCount);
    for (const animation of largestFirst) {
      byName.set(animation.name, await TargetAnimationPlayer.create(world, animation));
    }
    return animations.map(animation => byName.get(animation.name));
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

  play({ loop } = {}) {
    if (loop !== undefined && typeof loop !== 'boolean') throw new TypeError('La boucle doit être un booléen.');
    const shouldLoop = loop ?? this.kind === 'loop';
    if (this.kind === 'one-shot' && shouldLoop) {
      throw new RangeError('Cette animation ne se répète pas : elle se termine sur sa pose finale.');
    }
    this.loop = shouldLoop;
    this.elapsed = 0;
    this.inspecting = false;
    this.playing = true;
    this.held = false;
    this.completed = false;
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
    this.elapsed = this.timeForFrame(index);
    this.playing = true;
    this.held = false;
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

  /** Change the density cap without changing the persistent pool or the reference poses. */
  setParticleCount(count) {
    if (!this.world.dynamicPopulation) return this.setLegacyParticleCount(count);
    const changed = this.world.setParticleCount(count);
    if (!changed) return false;
    this.ensureQuality();
    if (this.inspecting) {
      this.applyPose();
      this.world.snapToTargetPose();
    } else if (this.playing || this.held) {
      this.applyPose();
    }
    return true;
  }

  setLegacyParticleCount(count) {
    const changed = this.world.setParticleCount(count);
    if (!changed) return false;
    this.frames = this.fullFrames.map(sourceFrame => {
      const compact = new Uint8Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        const sourceOffset = this.world.particles[index].sourceIndex * 3;
        compact.set(sourceFrame.subarray(sourceOffset, sourceOffset + 3), index * 3);
      }
      return compact;
    });
    if (this.playing) {
      this.applyPose();
      if (this.inspecting) this.world.snapToTargetPose();
    }
    return true;
  }

  /** Apply the shared cap to this clip's own identities, keeping the same selected IDs in every frame. */
  applyQuality(limit) {
    if (limit === null) {
      this.frames = this.fullFrames;
      return;
    }
    const identityCount = this.animation.particleCount;
    const count = Math.min(limit, identityCount);
    const selected = new Uint8Array(this.world.particles.length);
    // Keep an eye silhouette even on the smallest quality setting.
    const eyeBudget = Math.max(1, Math.min(this.qualityOrder.eye.length,
      Math.round(count * this.qualityOrder.eye.length / identityCount)));
    for (let i = 0; i < eyeBudget; i += 1) selected[this.qualityOrder.eye[i]] = 1;
    for (let i = 0; i < count - eyeBudget; i += 1) selected[this.qualityOrder.body[i]] = 1;
    this.frames = this.fullFrames.map(sourceFrame => {
      const filtered = sourceFrame.slice();
      for (let index = 0; index < selected.length; index += 1) {
        if (!selected[index]) filtered[index * 3 + 2] = 0;
      }
      return filtered;
    });
  }

  /** Non-destructive loop trimming: all reference frames remain available. */
  setLoopEndFrame(index) {
    if (this.kind === 'one-shot') {
      throw new RangeError('La fin de boucle ne s’applique pas à une animation non bouclée.');
    }
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

  /** Stop releases the pose: the particles return to the physics of the resting body. */
  stop() {
    if (!this.playing && !this.held) return false;
    this.playing = false;
    this.held = false;
    this.inspecting = false;
    this.world.setTargetPose(null);
    return true;
  }

  /**
   * Leave this clip without touching the shared world pose: another clip is about to
   * set its own pose, so releasing here would make the particles fall back to rest.
   */
  detach() {
    this.playing = false;
    this.held = false;
    this.inspecting = false;
  }

  advance(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Durée d’animation invalide.');
    }
    if (!this.playing || this.inspecting || this.world.paused || deltaSeconds === 0) return;
    const duration = this.sourcePlaybackDurationMs / 1000;
    this.elapsed += deltaSeconds * this.speed;
    if (this.kind === 'one-shot') {
      if (this.elapsed >= duration) {
        this.elapsed = duration;
        this.finish();
      } else {
        this.applyPose();
      }
      return;
    }
    if (this.elapsed >= duration && !this.loop) {
      this.stop();
      return;
    }
    this.elapsed %= duration;
    this.applyPose();
  }

  /** End of a one-shot clip: the final reference pose is kept until a new command. */
  finish() {
    this.playing = false;
    this.held = true;
    this.completed = true;
    this.applyPose();
  }

  /** Time (seconds) at which a reference frame is shown; inverse of positionAt. */
  timeForFrame(index) {
    if (this.kind !== 'one-shot') return index * this.frameDurationMs / 1000;
    const last = this.frames.length - 1;
    return inverseSmoothstep(index / last) * this.sourcePlaybackDurationMs / 1000;
  }

  /** Fractional frame position for an elapsed time. */
  positionAt(elapsedSeconds) {
    if (this.kind !== 'one-shot') return elapsedSeconds * 1000 / this.frameDurationMs;
    const progress = elapsedSeconds / (this.sourcePlaybackDurationMs / 1000);
    return (this.frames.length - 1) * smoothstep(progress);
  }

  applyPose() {
    this.ensureQuality();
    // Inspection shows exactly one reference frame; playback derives it from time.
    const position = this.inspecting ? this.frame : this.positionAt(this.elapsed);
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

  ensureQuality() {
    if (!this.world.dynamicPopulation) return;
    const limit = this.world.densityLimit;
    if (limit === this.qualityLimit) return;
    this.applyQuality(limit);
    this.qualityLimit = limit;
  }

  getSnapshot() {
    return Object.freeze({
      name: this.animation.name,
      kind: this.kind,
      playing: this.playing,
      inspecting: this.inspecting,
      held: this.held,
      completed: this.completed,
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
