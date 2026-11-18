/**
 * Simulation physique d'un nuage composé de pixels indépendants.
 * Sans Canvas, sans image chargée et sans dépendance externe : testable dans Node.js.
 */
const PARTICLE_STAGE_SIZE = 400;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function decodePixelMap(map) {
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) ||
      !Array.isArray(map.palette) || typeof map.runs !== 'string') {
    throw new TypeError('Carte de pixels invalide.');
  }

  const bytes = Uint8Array.from(atob(map.runs), (character) => character.charCodeAt(0));
  if (bytes.length % 4 !== 0) throw new Error('Données RLE tronquées.');

  const pixels = [];
  const occupancy = new Uint8Array(map.width * map.height);
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const [y, start, length, paletteIndex] = bytes.subarray(offset, offset + 4);
    const color = map.palette[paletteIndex];
    if (!color || color.length !== 4 || length === 0 || start + length > map.width || y >= map.height) {
      throw new Error('La carte contient une ligne ou une couleur invalide.');
    }
    for (let x = start; x < start + length; x += 1) {
      const index = y * map.width + x;
      if (occupancy[index]) throw new Error('Des pixels se chevauchent dans la source.');
      occupancy[index] = 1;
      pixels.push({ x, y, color, eye: paletteIndex === 3 });
    }
  }
  if (Number.isInteger(map.count) && pixels.length !== map.count) {
    throw new Error('Le nombre de pixels ne correspond pas à la carte.');
  }
  return { pixels, occupancy };
}

class ParticleWorld {
  constructor(map, { size = PARTICLE_STAGE_SIZE, random = Math.random } = {}) {
    if (!Number.isInteger(size) || size < Math.max(map.width, map.height)) {
      throw new RangeError('Zone de simulation trop petite.');
    }
    if (typeof random !== 'function') throw new TypeError('La source aléatoire doit être une fonction.');

    const decoded = decodePixelMap(map);
    this.size = size;
    this.map = map;
    this.random = random;
    this.occupancy = decoded.occupancy;
    this.originX = Math.floor((size - map.width) / 2);
    this.originY = Math.floor((size - map.height) / 2);
    this.clock = 0;
    this.mode = 'idle';
    this.modeTime = 0;
    this.paused = false;
    this.stiffness = 30;
    this.damping = 8;
    this.dispersion = 1;
    this.accent = [165, 138, 252];
    this.colorMix = 0;
    this.blinkStartedAt = -1;
    this.nextBlinkAt = 3.8 + random() * 3.7;
    this.particles = decoded.pixels.map(({ x, y, color, eye }) => {
      const homeX = x + this.originX;
      const homeY = y + this.originY;
      return {
        homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0,
        color, eye, phase: random() * Math.PI * 2,
      };
    });
  }

  setAccent(color) {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new RangeError('Couleur hexadécimale invalide.');
    this.accent = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  }

  setElasticity(value) {
    if (!Number.isFinite(value) || value < 5 || value > 70) {
      throw new RangeError('Élasticité hors limites (5–70).');
    }
    this.stiffness = value;
    this.damping = 4 + Math.sqrt(value) * 0.85;
  }

  setDispersion(value) {
    if (!Number.isFinite(value) || value < 0.3 || value > 2) {
      throw new RangeError('Dispersion hors limites (0.3–2).');
    }
    this.dispersion = value;
  }

  hitTest(x, y) {
    const gridX = Math.round(x - this.originX);
    const gridY = Math.round(y - this.originY);
    if (gridX < 0 || gridY < 0 || gridX >= this.map.width || gridY >= this.map.height) return false;
    for (let row = Math.max(0, gridY - 2); row <= Math.min(this.map.height - 1, gridY + 2); row += 1) {
      for (let col = Math.max(0, gridX - 2); col <= Math.min(this.map.width - 1, gridX + 2); col += 1) {
        if (this.occupancy[row * this.map.width + col]) return true;
      }
    }
    return false;
  }

  explode(originX = this.size / 2, originY = this.size / 2) {
    if (this.paused) return false;
    this.mode = 'explode';
    this.modeTime = 0;
    this.colorMix = 1;
    const intensity = this.dispersion;

    for (const particle of this.particles) {
      const dx = particle.x - originX;
      const dy = particle.y - originY;
      const angle = Math.atan2(dy, dx) + (this.random() - 0.5) * 0.9;
      const force = (140 + this.random() * 160) * intensity;
      particle.vx += Math.cos(angle) * force;
      particle.vy += Math.sin(angle) * force;
    }
    return true;
  }

  reveal() {
    if (this.paused) return false;
    this.mode = 'reveal';
    this.modeTime = 0;
    this.colorMix = 1;
    const center = this.size / 2;
    for (const particle of this.particles) {
      const angle = this.random() * Math.PI * 2;
      const radius = (55 + this.random() * 130) * this.dispersion;
      particle.x = center + Math.cos(angle) * radius;
      particle.y = center + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle + Math.PI / 2) * 18;
      particle.vy = Math.sin(angle + Math.PI / 2) * 18;
    }
    return true;
  }

  reset() {
    this.mode = 'idle';
    this.modeTime = 0;
    this.colorMix = 0;
    this.blinkStartedAt = -1;
    this.nextBlinkAt = this.clock + 3.8 + this.random() * 3.7;
    for (const particle of this.particles) {
      particle.x = particle.homeX;
      particle.y = particle.homeY;
      particle.vx = 0;
      particle.vy = 0;
    }
  }

  getBlinkAmount() {
    if (this.blinkStartedAt < 0) return 0;
    const progress = (this.clock - this.blinkStartedAt) / 0.22;
    if (progress < 0 || progress >= 1) return 0;
    return Math.sin(progress * Math.PI) ** 2;
  }

  step(deltaSeconds) {
    if (this.paused) return;
    const dt = clamp(deltaSeconds, 0, 1 / 30);
    if (dt === 0) return;
    this.clock += dt;
    this.modeTime += dt;
    if (this.mode === 'idle' && this.clock >= this.nextBlinkAt) {
      this.blinkStartedAt = this.clock;
      this.nextBlinkAt = this.clock + 3.8 + this.random() * 3.7;
    }

    if (this.mode === 'reveal') this.colorMix = clamp(1 - this.modeTime / 2.6, 0, 1);
    if (this.mode === 'explode') this.colorMix = clamp(1 - this.modeTime / 1.8, 0, 1);
    if (this.mode !== 'idle' && this.modeTime > 3.2) {
      this.mode = 'idle';
      this.colorMix = 0;
    }

    const blink = this.mode === 'idle' ? this.getBlinkAmount() : 0;
    const levitation = Math.sin(this.clock * 1.7) * 2.3;
    const sway = Math.sin(this.clock * 0.85) * 1.3;
    const t = this.clock;
    const k = this.stiffness;
    const drag = this.damping;

    for (const particle of this.particles) {
      // Neighboring pixels share a slow wave: preserve a readable silhouette in idle.
      const waveX = Math.sin(t * 1.12 + particle.homeY * 0.028) * 1.25;
      const waveY = Math.sin(t * 0.95 + particle.homeX * 0.035) * 0.70;
      const blinkY = particle.eye ? (this.originY + 131 - particle.homeY) * blink : 0;
      const targetX = particle.homeX + sway + waveX;
      const targetY = particle.homeY + levitation + waveY + blinkY;
      particle.vx += (targetX - particle.x) * k * dt;
      particle.vy += (targetY - particle.y) * k * dt;
      const friction = Math.exp(-drag * dt);
      particle.vx *= friction;
      particle.vy *= friction;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  /** Fill a reusable RGBA buffer; every visible pixel remains individually addressable. */
  writePixels(buffer) {
    if (!(buffer instanceof Uint8ClampedArray) || buffer.length !== this.size * this.size * 4) {
      throw new RangeError('Tampon RGBA incompatible.');
    }
    buffer.fill(0);
    const mix = this.colorMix;
    const [accentR, accentG, accentB] = this.accent;
    const blink = this.mode === 'idle' ? this.getBlinkAmount() : 0;

    for (const particle of this.particles) {
      const x = Math.round(particle.x);
      const y = Math.round(particle.y);
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;

      const offset = (y * this.size + x) * 4;
      const [r, g, b, a] = particle.color;
      const variation = 0.72 + 0.28 * Math.sin(particle.phase + this.clock * 2.4) ** 2;
      const tint = mix * variation;
      buffer[offset] = r + (accentR - r) * tint;
      buffer[offset + 1] = g + (accentG - g) * tint;
      buffer[offset + 2] = b + (accentB - b) * tint;
      buffer[offset + 3] = particle.eye ? a * (1 - blink * 0.98) : a;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ParticleWorld, decodePixelMap, PARTICLE_STAGE_SIZE };
}
