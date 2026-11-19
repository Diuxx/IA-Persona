/**
 * A single physical fabric over the entire silhouette. Anatomical regions and
 * semantic roles do not cut the graph: all directly touching pixels can link.
 * Material coefficients determine how each pixel responds to that influence.
 */
class CohesionField {
  constructor(particles, width, height, originX, originY) {
    this.neighbors = new Int32Array(particles.length * 4).fill(-1);
    this.counts = new Uint8Array(particles.length);
    this.linkCount = 0;

    const sourceIndex = new Int32Array(width * height).fill(-1);
    for (let i = 0; i < particles.length; i += 1) {
      const x = Math.round(particles[i].homeX - originX);
      const y = Math.round(particles[i].homeY - originY);
      sourceIndex[y * width + x] = i;
    }

    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const x = Math.round(particle.homeX - originX);
      const y = Math.round(particle.homeY - originY);
      const candidates = [
        x > 0 ? y * width + x - 1 : -1,
        x + 1 < width ? y * width + x + 1 : -1,
        y > 0 ? (y - 1) * width + x : -1,
        y + 1 < height ? (y + 1) * width + x : -1,
      ];
      for (const cell of candidates) {
        if (cell < 0) continue;
        const neighbor = sourceIndex[cell];
        if (neighbor < 0) continue;
        this.neighbors[i * 4 + this.counts[i]] = neighbor;
        this.counts[i] += 1;
        if (neighbor > i) this.linkCount += 1;
      }
    }
  }

  /** Compute forces against the pre-integration positions, no allocation. */
  apply(particles, strength, dt) {
    if (strength <= 0 || dt <= 0) return;
    const factor = strength * dt;
    for (let i = 0; i < particles.length; i += 1) {
      const count = this.counts[i];
      if (!count) continue;
      const particle = particles[i];
      let neighborDx = 0;
      let neighborDy = 0;
      const offset = i * 4;
      for (let j = 0; j < count; j += 1) {
        const neighbor = particles[this.neighbors[offset + j]];
        neighborDx += neighbor.x - neighbor.homeX;
        neighborDy += neighbor.y - neighbor.homeY;
      }
      const dx = particle.x - particle.homeX;
      const dy = particle.y - particle.homeY;
      const localFactor = factor * (particle.material?.cohesion ?? 1);
      particle.vx += ((neighborDx / count) - dx) * localFactor;
      particle.vy += ((neighborDy / count) - dy) * localFactor;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CohesionField };
} else {
  window.CohesionField = CohesionField;
}
