/**
 * Limits single-frame pixel disappearance during target morphing.
 * This is a presentation filter: it never changes particle positions, colors,
 * roles or the reference frames. It is bypassed when inspecting exact poses.
 */
class PixelStabilizer {
  constructor(byteLength, width) {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength % 4 !== 0) {
      throw new RangeError('Dimensions RGBA invalides.');
    }
    if (!Number.isSafeInteger(width) || width <= 0 || byteLength % (width * 4) !== 0) {
      throw new RangeError('Largeur du tampon RGBA invalide.');
    }
    this.width = width;
    this.height = byteLength / (4 * width);
    this.currentAlpha = new Uint8Array(byteLength / 4);
    this.previous = new Uint8ClampedArray(byteLength);
    this.initialized = false;
  }

  reset() {
    this.initialized = false;
  }

  /** Mutates only the supplied render buffer; the last displayed frame is cached. */
  apply(pixels, elapsedSeconds, enabled = true) {
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== this.previous.length ||
        !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new RangeError('Image ou intervalle de stabilisation invalide.');
    }
    if (!enabled || !this.initialized) {
      this.previous.set(pixels);
      this.initialized = enabled;
      return;
    }

    // Snapshot raw coverage first: newly faded pixels must not influence their
    // neighbors or leave ghosts when the silhouette moves far away.
    for (let index = 0; index < this.currentAlpha.length; index += 1) {
      this.currentAlpha[index] = pixels[index * 4 + 3];
    }
    const persistence = Math.exp(-Math.min(elapsedSeconds, 0.1) / 0.035);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3];
      const formerAlpha = this.previous[offset + 3] * persistence;
      if (alpha === 0 && formerAlpha >= 5) {
        const index = offset / 4;
        const x = index % this.width;
        const y = Math.floor(index / this.width);
        // Only soften one-pixel holes next to the current outline. Old shapes
        // farther away must disappear immediately, not become visible trails.
        let hasNeighbor = false;
        for (let dy = -1; dy <= 1 && !hasNeighbor; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < this.width && yy >= 0 && yy < this.height &&
                this.currentAlpha[yy * this.width + xx] > 0) {
              hasNeighbor = true;
              break;
            }
          }
        }
        if (hasNeighbor) {
          pixels[offset] = this.previous[offset];
          pixels[offset + 1] = this.previous[offset + 1];
          pixels[offset + 2] = this.previous[offset + 2];
          pixels[offset + 3] = Math.min(130, formerAlpha);
        }
      } else if (alpha > 0 && formerAlpha > 0) {
        // Dampen abrupt gray/black swaps when particles cross between pixels.
        const oldShare = Math.min(0.25, formerAlpha / (alpha + formerAlpha) * 0.4);
        pixels[offset] = pixels[offset] * (1 - oldShare) + this.previous[offset] * oldShare;
        pixels[offset + 1] = pixels[offset + 1] * (1 - oldShare) + this.previous[offset + 1] * oldShare;
        pixels[offset + 2] = pixels[offset + 2] * (1 - oldShare) + this.previous[offset + 2] * oldShare;
      }
    }
    this.previous.set(pixels);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PixelStabilizer };
} else {
  window.PixelStabilizer = PixelStabilizer;
}
