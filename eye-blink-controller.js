/**
 * Contrôle l'unique œil de la mascotte, indépendamment de sa lévitation.
 * Les échéances utilisent le temps d'animation (secondes), pas Date.now().
 */
class EyeBlinkController {
  constructor({ random = Math.random, minInterval = 3.8, maxInterval = 7.5, doubleBlinkChance = 0.2 } = {}) {
    if (typeof random !== 'function' || minInterval <= 0 || maxInterval < minInterval ||
        doubleBlinkChance < 0 || doubleBlinkChance > 1) {
      throw new RangeError('Configuration de clignement invalide.');
    }

    this.random = random;
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.doubleBlinkChance = doubleBlinkChance;
    this.nextStart = this.randomInterval();
    this.doubleBlink = this.random() < this.doubleBlinkChance;
  }

  randomInterval() {
    return this.minInterval + this.random() * (this.maxInterval - this.minInterval);
  }

  /** Permet de prévisualiser un clignement sans modifier les animations du corps. */
  blinkNow(seconds) {
    this.nextStart = seconds;
    this.doubleBlink = false;
  }

  /** Retourne une fermeture de 0 (ouvert) à 1 (fermé). */
  closureAt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 0;
    if (seconds < this.nextStart) return 0;

    const age = seconds - this.nextStart;
    const end = this.doubleBlink ? 0.52 : 0.23;
    if (age >= end) {
      this.nextStart = seconds + this.randomInterval();
      this.doubleBlink = this.random() < this.doubleBlinkChance;
      return 0;
    }

    return Math.max(this.singleBlink(age), this.doubleBlink ? this.singleBlink(age - 0.29) : 0);
  }

  singleBlink(age) {
    if (age < 0 || age >= 0.23) return 0;
    if (age < 0.075) return this.smoothstep(age / 0.075);
    if (age < 0.11) return 1;
    return 1 - this.smoothstep((age - 0.11) / 0.12);
  }

  smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EyeBlinkController };
} else {
  window.EyeBlinkController = EyeBlinkController;
}
