/**
 * Simulation physique d'un nuage composé de pixels indépendants.
 * Sans Canvas, sans image chargée et sans dépendance externe : testable dans Node.js.
 */
const PARTICLE_STAGE_SIZE = 400;
const localAssignAnatomy = typeof module !== 'undefined' && module.exports
  ? require('./anatomy.js').assignAnatomy
  : window.assignAnatomy;
const LocalCohesionField = typeof module !== 'undefined' && module.exports
  ? require('./cohesion-field.js').CohesionField
  : window.CohesionField;

/** Progression douce de 0 à 1, pour reformer la matière sans rupture. */
function smoothstep(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Source aléatoire reproductible pour les tests et les captures de référence. */
function createSeededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('La graine doit être un entier non signé sur 32 bits.');
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
  constructor(map, { size = PARTICLE_STAGE_SIZE, random, seed, anatomy } = {}) {
    if (!map || !Number.isInteger(size) || size < Math.max(map.width, map.height)) {
      throw new RangeError('Zone de simulation trop petite.');
    }
    if (random !== undefined && seed !== undefined) {
      throw new TypeError('Choisir soit une source aléatoire, soit une graine.');
    }
    if (random !== undefined && typeof random !== 'function') {
      throw new TypeError('La source aléatoire doit être une fonction.');
    }

    const decoded = decodePixelMap(map);
    this.anatomy = anatomy ? localAssignAnatomy(decoded.pixels, anatomy, map.width, map.height) : null;
    this.size = size;
    this.map = map;
    this.random = seed === undefined ? (random ?? Math.random) : createSeededRandom(seed);
    this.occupancy = decoded.occupancy;
    // Utilisé uniquement au rendu : réutilisé à chaque frame, sans allocation supplémentaire.
    this.pixelWeights = new Float32Array(size * size);
    this.lastCollisionCount = 0;
    this.originX = Math.floor((size - map.width) / 2);
    this.originY = Math.floor((size - map.height) / 2);
    this.clock = 0;
    this.mode = 'idle';
    this.modeTime = 0;
    this.paused = false;
    this.stiffness = 30;
    this.damping = 8;
    this.dispersion = 1;
    this.cohesion = 55;
    this.organicMotion = 1;
    this.accent = [165, 138, 252];
    this.colorMix = 0;
    this.blinkStartedAt = -1;
    this.nextBlinkAt = 3.8 + this.random() * 3.7;
    this.particles = decoded.pixels.map(({ x, y, color, eye, region, profile }) => {
      const homeX = x + this.originX;
      const homeY = y + this.originY;
      return {
        homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0,
        color, eye, region, profile, phase: this.random() * Math.PI * 2,
      };
    });
    this.cohesionField = new LocalCohesionField(
      this.particles, map.width, map.height, this.originX, this.originY
    );
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

  setCohesion(value) {
    if (!Number.isFinite(value) || value < 0 || value > 120) {
      throw new RangeError('Cohésion hors limites (0–120).');
    }
    this.cohesion = value;
  }

  setOrganicMotion(value) {
    if (!Number.isFinite(value) || value < 0 || value > 2) {
      throw new RangeError('Mouvement organique hors limites (0–2).');
    }
    this.organicMotion = value;
  }

  getRecoveryFactor() {
    if (this.mode === 'idle') return 1;
    // Les liens se relâchent à l'impact puis reviennent avant la fin de l'animation.
    return smoothstep((this.modeTime - 0.18) / 1.35);
  }

  /** Recherche les particules à leur position ACTUELLE, pas dans la carte de repos. */
  hitTest(x, y, radius = 3) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0 ||
        x < 0 || y < 0 || x >= this.size || y >= this.size) return false;

    const radiusSquared = radius * radius;
    // Recherche O(n) uniquement lors d'un clic ; aucun index spatial à entretenir par frame.
    return this.particles.some((particle) => {
      const dx = particle.x - x;
      const dy = particle.y - y;
      return dx * dx + dy * dy <= radiusSquared;
    });
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
      const force = (140 + this.random() * 160) * intensity * (particle.profile?.impact ?? 1);
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
      const radius = (55 + this.random() * 130) * this.dispersion * (particle.profile?.impact ?? 1);
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
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Le pas de simulation doit être positif et fini.');
    }
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
    const organic = this.organicMotion;
    const breathe = Math.sin(this.clock * 1.35) * 0.014 * organic;
    const centerX = this.originX + this.map.width / 2;
    const centerY = this.originY + this.map.height / 2;
    const baseFriction = Math.exp(-this.damping * dt);

    this.cohesionField.apply(this.particles, this.cohesion * this.getRecoveryFactor(), dt);
    for (const particle of this.particles) {
      const profile = particle.profile;
      const wave = profile?.wave ?? 1;
      const breath = profile?.breath ?? 1;
      const regionFloat = profile?.float ?? 0;
      // Tous les pixels d'une zone partagent le même mouvement : l'anatomie
      // garde une silhouette cohérente, même quand sa matière reste déformable.
      const groupPhase = particle.region ?? 0;
      const floatX = Math.sin(this.clock * 1.37 + groupPhase * 0.67) * regionFloat * organic * 0.55;
      const floatY = Math.sin(this.clock * 1.83 + groupPhase * 0.45) * regionFloat * organic * 0.8;
      const waveX = Math.sin(this.clock * 1.12 + particle.homeY * 0.028) * 1.25 * organic * wave;
      const waveY = Math.sin(this.clock * 0.95 + particle.homeX * 0.035) * 0.70 * organic * wave;
      const blinkY = particle.eye ? (this.originY + 131 - particle.homeY) * blink : 0;
      const targetX = particle.homeX + sway + waveX + floatX + (particle.homeX - centerX) * breathe * breath;
      const targetY = particle.homeY + levitation + waveY + floatY + blinkY + (particle.homeY - centerY) * breathe * breath;
      const spring = this.stiffness * (profile?.spring ?? 1);
      const friction = profile ? Math.exp(-this.damping * profile.damping * dt) : baseFriction;
      particle.vx += (targetX - particle.x) * spring * dt;
      particle.vy += (targetY - particle.y) * spring * dt;
      particle.vx *= friction;
      particle.vy *= friction;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  /**
   * Écrit dans le même tampon RGBA à chaque image.
   * Les particules superposées mélangent leur couleur au lieu de s'écraser.
   * L'œil reçoit un poids supérieur pour rester lisible lors des déformations.
   */
  writePixels(buffer, { showAnatomy = false } = {}) {
    if (!(buffer instanceof Uint8ClampedArray) || buffer.length !== this.size * this.size * 4) {
      throw new RangeError('Tampon RGBA incompatible.');
    }
    buffer.fill(0);
    this.pixelWeights.fill(0);
    this.lastCollisionCount = 0;
    const mix = this.colorMix;
    const [accentR, accentG, accentB] = this.accent;
    const blink = this.mode === 'idle' ? this.getBlinkAmount() : 0;

    for (const particle of this.particles) {
      const x = Math.round(particle.x);
      const y = Math.round(particle.y);
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;

      const [r, g, b, a] = particle.color;
      const opacity = (a / 255) * (particle.eye ? 1 - blink * 0.98 : 1);
      if (opacity <= 0) continue;

      const pixelIndex = y * this.size + x;
      const offset = pixelIndex * 4;
      const previousWeight = this.pixelWeights[pixelIndex];
      const weight = opacity * (particle.eye ? 6 : 1);
      const totalWeight = previousWeight + weight;
      const variation = 0.72 + 0.28 * Math.sin(particle.phase + this.clock * 2.4) ** 2;
      const tint = Math.min(1, mix * variation * (particle.profile?.tint ?? 1));
      let red = r + (accentR - r) * tint;
      let green = g + (accentG - g) * tint;
      let blue = b + (accentB - b) * tint;
      if (showAnatomy && particle.profile) {
        [red, green, blue] = particle.profile.debug;
      }

      if (previousWeight > 0) this.lastCollisionCount += 1;
      buffer[offset] = (buffer[offset] * previousWeight + red * weight) / totalWeight;
      buffer[offset + 1] = (buffer[offset + 1] * previousWeight + green * weight) / totalWeight;
      buffer[offset + 2] = (buffer[offset + 2] * previousWeight + blue * weight) / totalWeight;
      const previousOpacity = buffer[offset + 3] / 255;
      buffer[offset + 3] = 255 * (previousOpacity + opacity * (1 - previousOpacity));
      this.pixelWeights[pixelIndex] = totalWeight;
    }
  }

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ParticleWorld, decodePixelMap, createSeededRandom, PARTICLE_STAGE_SIZE };
}
