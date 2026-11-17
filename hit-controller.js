/**
 * Timeline de la réaction « Hit » reproduite à partir de huit frames de référence.
 * Le temps est exprimé en secondes, sur l'horloge d'animation (mise en pause comprise).
 */
class HitController {
  constructor({ frameCount = 8, frameDuration = 0.12, fadeIn = 0.07, fadeOut = 0.10 } = {}) {
    const duration = frameCount * frameDuration;
    if (!Number.isInteger(frameCount) || frameCount < 2 ||
        !Number.isFinite(frameDuration) || frameDuration <= 0 ||
        !Number.isFinite(fadeIn) || fadeIn < 0 ||
        !Number.isFinite(fadeOut) || fadeOut < 0 ||
        fadeIn + fadeOut > duration) {
      throw new RangeError('Chronologie de la réaction Hit invalide.');
    }

    this.frameCount = frameCount;
    this.frameDuration = frameDuration;
    this.duration = duration;
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
    this.startedAt = null;
  }

  trigger(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || this.isActiveAt(seconds)) return false;
    this.startedAt = seconds;
    return true;
  }

  isActiveAt(seconds) {
    return this.startedAt !== null && Number.isFinite(seconds) &&
      seconds >= this.startedAt && seconds - this.startedAt < this.duration;
  }

  sampleAt(seconds) {
    if (!this.isActiveAt(seconds)) {
      return { active: false, frame: 0, nextFrame: 0, blend: 0, opacity: 0 };
    }

    const elapsed = seconds - this.startedAt;
    const frame = Math.min(this.frameCount - 1, Math.floor((elapsed + 1e-9) / this.frameDuration));
    const localProgress = elapsed / this.frameDuration - frame;
    // Interpolation très courte en fin de frame pour éviter le ghosting prolongé.
    const blend = frame < this.frameCount - 1 ? this.smoothstep((localProgress - 0.72) / 0.28) : 0;
    const enter = this.fadeIn > 0 ? Math.min(1, elapsed / this.fadeIn) : 1;
    const exit = this.fadeOut > 0 ? Math.min(1, (this.duration - elapsed) / this.fadeOut) : 1;

    return {
      active: true,
      frame,
      nextFrame: Math.min(this.frameCount - 1, frame + 1),
      blend,
      opacity: this.smoothstep(Math.min(enter, exit)),
    };
  }

  smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HitController };
} else {
  window.HitController = HitController;
}
