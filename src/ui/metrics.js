/** Browser-only performance display; keeps formatting work out of the particle engine. */
class PersonaMetrics {
  constructor(root = document) {
    this.fps = root.querySelector('#fps');
    this.particles = root.querySelector('#particle-count');
    this.simulation = root.querySelector('#simulation-ms');
    this.rendering = root.querySelector('#rendering-ms');
    this.collisions = root.querySelector('#collision-count');
    this.trackingError = root.querySelector('#tracking-error');
    this.trackingMaximum = root.querySelector('#tracking-max-error');
    this.trackingLimited = root.querySelector('#tracking-limited');
    if ([this.fps, this.particles, this.simulation, this.rendering, this.collisions].some(item => !item)) {
      throw new Error('Indicateurs de performance manquants.');
    }
    this.formatter = new Intl.NumberFormat('fr-FR');
    this.lastCount = null;
    this.resetSampling();
  }

  resetSampling() {
    this.startedAt = null;
    this.samples = 0;
    this.simulationTotal = 0;
    this.renderingTotal = 0;
    for (const item of [this.fps, this.simulation, this.rendering, this.collisions,
      this.trackingError, this.trackingMaximum, this.trackingLimited]) {
      if (item) item.textContent = '—';
    }
  }

  updateTracking({ meanErrorPx, maxErrorPx, limitedCount }) {
    if (this.trackingError) this.trackingError.textContent = meanErrorPx === null ? '—' : meanErrorPx.toFixed(2);
    if (this.trackingMaximum) this.trackingMaximum.textContent = maxErrorPx === null ? '—' : maxErrorPx.toFixed(2);
    if (this.trackingLimited) this.trackingLimited.textContent = this.formatter.format(limitedCount);
  }

  updateParticleCount(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Nombre de particules invalide.');
    if (count === this.lastCount) return;
    this.lastCount = count;
    this.particles.textContent = this.formatter.format(count);
  }

  recordFrame(timestamp, simulationMs, renderingMs, collisionCount) {
    if (this.startedAt === null) this.startedAt = timestamp;
    this.samples += 1;
    this.simulationTotal += simulationMs;
    this.renderingTotal += renderingMs;
    const elapsed = timestamp - this.startedAt;
    if (elapsed < 1000) return false;

    this.fps.textContent = String(Math.round(this.samples * 1000 / elapsed));
    this.simulation.textContent = (this.simulationTotal / this.samples).toFixed(2);
    this.rendering.textContent = (this.renderingTotal / this.samples).toFixed(2);
    this.collisions.textContent = this.formatter.format(collisionCount);
    this.samples = 0;
    this.simulationTotal = 0;
    this.renderingTotal = 0;
    this.startedAt = timestamp;
    return true;
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PersonaMetrics };
} else {
  window.PersonaMetrics = PersonaMetrics;
}
