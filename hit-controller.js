/**
 * Représente la réaction "Hit" sous forme de poses interpolées.
 * Une même horloge pilote l'animation idle et cette réaction : aucune minuterie
 * ne continue pendant que l'animation principale est en pause.
 */
const HIT_KEYFRAMES = [
  { at: 0.00, squash: 0, stretch: 0, scatter: 0, eyeOpen: 0 },
  { at: 0.10, squash: 1, stretch: 0, scatter: 0.18, eyeOpen: 0 },
  { at: 0.20, squash: 0.9, stretch: 0, scatter: 0.25, eyeOpen: 0 },
  { at: 0.34, squash: 0, stretch: 1, scatter: 1, eyeOpen: 1 },
  { at: 0.52, squash: 0, stretch: 0.25, scatter: 0.87, eyeOpen: 1 },
  { at: 0.72, squash: 0, stretch: 0, scatter: 0.40, eyeOpen: 0.68 },
  { at: 0.88, squash: 0.12, stretch: 0, scatter: 0.18, eyeOpen: 0.28 },
  { at: 1.00, squash: 0, stretch: 0, scatter: 0, eyeOpen: 0 },
];

class HitController {
  constructor({ duration = 1.15 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError('La durée de la réaction doit être positive.');
    }
    this.duration = duration;
    this.startedAt = null;
  }

  /** Ignore un second clic tant que la réaction précédente est active. */
  trigger(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || this.isActiveAt(seconds)) {
      return false;
    }
    this.startedAt = seconds;
    return true;
  }

  isActiveAt(seconds) {
    return this.startedAt !== null && seconds >= this.startedAt &&
      seconds - this.startedAt < this.duration;
  }

  poseAt(seconds) {
    const rest = { active: false, squash: 0, stretch: 0, scatter: 0, eyeOpen: 0 };
    if (!this.isActiveAt(seconds)) return rest;

    const progress = (seconds - this.startedAt) / this.duration;
    const nextIndex = HIT_KEYFRAMES.findIndex((frame) => frame.at >= progress);
    if (nextIndex <= 0) return { ...rest, ...HIT_KEYFRAMES[0], active: true };

    const from = HIT_KEYFRAMES[nextIndex - 1];
    const to = HIT_KEYFRAMES[nextIndex];
    const fraction = (progress - from.at) / (to.at - from.at);
    const eased = fraction * fraction * (3 - 2 * fraction);

    return {
      active: true,
      squash: this.interpolate(from.squash, to.squash, eased),
      stretch: this.interpolate(from.stretch, to.stretch, eased),
      scatter: this.interpolate(from.scatter, to.scatter, eased),
      eyeOpen: this.interpolate(from.eyeOpen, to.eyeOpen, eased),
    };
  }

  interpolate(start, end, fraction) {
    return start + (end - start) * fraction;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HitController };
} else {
  window.HitController = HitController;
}
