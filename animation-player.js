/**
 * Lecteur d'animations 2D fondées exclusivement sur des frames complètes.
 * Aucun sprite n'est assemblé ou déformé au moment du rendu.
 */
const ANIMATION_CLIPS = Object.freeze({
  idle: Object.freeze({ src: null, frames: 24, fps: 12, loop: true }),
  blink: Object.freeze({ src: null, frames: 8, fps: 30, loop: false }),
  hit: Object.freeze({ src: './assets/hit-explosion-sprite.png', frames: 8, fps: 1 / 0.12, loop: false }),
});

const FRAME_SIZE = Object.freeze({ width: 250, height: 251 });

class AnimationPlayer {
  constructor({ random = Math.random, blinkMin = 3.8, blinkMax = 7.5, doubleBlinkChance = 0.18 } = {}) {
    if (typeof random !== 'function' || !Number.isFinite(blinkMin) || blinkMin <= 0 ||
        !Number.isFinite(blinkMax) || blinkMax < blinkMin ||
        !Number.isFinite(doubleBlinkChance) || doubleBlinkChance < 0 || doubleBlinkChance > 1) {
      throw new RangeError('Paramètres de l’animation invalides.');
    }

    this.random = random;
    this.blinkMin = blinkMin;
    this.blinkMax = blinkMax;
    this.doubleBlinkChance = doubleBlinkChance;
    this.state = 'idle';
    this.stateElapsed = 0;
    this.elapsed = 0;
    this.speed = 1;
    this.paused = false;
    this.reducedMotion = false;
    this.nextBlinkAt = this.randomBlinkInterval();
    this.pendingDoubleBlink = false;
    this.nextBlinkIsContinuation = false;
    this.transition = null;
  }

  randomBlinkInterval() {
    return this.blinkMin + this.random() * (this.blinkMax - this.blinkMin);
  }

  setSpeed(percent) {
    if (!Number.isFinite(percent) || percent < 50 || percent > 150) {
      throw new RangeError('La vitesse doit être comprise entre 50 et 150 %.');
    }
    this.speed = percent / 100;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    if (this.reducedMotion) {
      this.state = 'idle';
      this.stateElapsed = 0;
      this.transition = null;
      this.pendingDoubleBlink = false;
      this.nextBlinkIsContinuation = false;
    } else {
      this.nextBlinkAt = this.elapsed + this.randomBlinkInterval();
    }
  }

  getFrameIndex() {
    const clip = ANIMATION_CLIPS[this.state];
    const frame = Math.floor(this.stateElapsed * clip.fps + 1e-8);
    return clip.loop ? frame % clip.frames : Math.min(clip.frames - 1, frame);
  }

  start(nextState) {
    if (!ANIMATION_CLIPS[nextState]) throw new Error(`Animation inconnue : ${nextState}`);
    this.transition = {
      state: this.state,
      frame: this.getFrameIndex(),
      elapsed: 0,
      duration: 0.075,
    };
    this.state = nextState;
    this.stateElapsed = 0;
  }

  triggerHit() {
    if (this.paused || this.reducedMotion || this.state === 'hit') return false;
    this.pendingDoubleBlink = false;
    this.nextBlinkIsContinuation = false;
    this.start('hit');
    return true;
  }

  triggerBlink() {
    if (this.paused || this.reducedMotion || this.state !== 'idle') return false;
    this.pendingDoubleBlink = false;
    this.nextBlinkIsContinuation = false;
    this.start('blink');
    return true;
  }

  completeAnimation() {
    if (this.state === 'blink' && this.pendingDoubleBlink) {
      this.pendingDoubleBlink = false;
      this.nextBlinkIsContinuation = true;
      this.start('idle');
      this.nextBlinkAt = this.elapsed + 0.11;
      return;
    }

    this.start('idle');
    this.nextBlinkAt = this.elapsed + this.randomBlinkInterval();
  }

  advance(deltaSeconds) {
    if (this.paused || this.reducedMotion) return;
    const delta = Math.min(0.05, Math.max(0, deltaSeconds)) * this.speed;
    if (delta === 0) return;
    this.elapsed += delta;
    this.stateElapsed += delta;
    if (this.transition) {
      this.transition.elapsed += delta;
      if (this.transition.elapsed >= this.transition.duration) this.transition = null;
    }

    if (this.state === 'idle' && this.elapsed >= this.nextBlinkAt) {
      const continuation = this.nextBlinkIsContinuation;
      this.nextBlinkIsContinuation = false;
      this.pendingDoubleBlink = !continuation && this.random() < this.doubleBlinkChance;
      this.start('blink');
      return;
    }

    const clip = ANIMATION_CLIPS[this.state];
    if (!clip.loop && this.stateElapsed >= clip.frames / clip.fps) {
      this.completeAnimation();
    }
  }

  getPresentation() {
    const transition = this.transition;
    return {
      state: this.state,
      frame: this.getFrameIndex(),
      previous: transition && {
        state: transition.state,
        frame: transition.frame,
        alpha: 1 - Math.min(1, transition.elapsed / transition.duration),
      },
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnimationPlayer, ANIMATION_CLIPS, FRAME_SIZE };
}
