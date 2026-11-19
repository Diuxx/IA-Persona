/**
 * Simulation physique d'un nuage composé de pixels indépendants.
 * Sans Canvas, sans image chargée et sans dépendance externe : testable dans Node.js.
 */
const PARTICLE_STAGE_SIZE = 400;
const TARGET_COLOR_PALETTE = [null, [6, 6, 8], [51, 51, 54], [224, 224, 222]];
const localAssignAnatomy = typeof module !== 'undefined' && module.exports
  ? require('./anatomy.js').assignAnatomy
  : window.assignAnatomy;
const LocalCohesionField = typeof module !== 'undefined' && module.exports
  ? require('./cohesion-field.js').CohesionField
  : window.CohesionField;
const LocalRoleRegistry = typeof module !== 'undefined' && module.exports
  ? require('./role-registry.js').RoleRegistry
  : window.RoleRegistry;

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
    this.targetPose = null;
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
    // Neutral physics drive, used when ParticleWorld is instantiated without a controller.
    this.behaviorDrive = {
      wave: 1, breath: 1, sway: 1, cohesion: 1,
      agitation: 0, pulse: 0,
    };
    this.accent = [165, 138, 252];
    this.colorMix = 0;
    this.blinkStartedAt = -1;
    this.nextBlinkAt = 3.8 + this.random() * 3.7;
    this.particles = decoded.pixels.map(({ x, y, color, eye, region, material, profile, debugColor }) => {
      const homeX = x + this.originX;
      const homeY = y + this.originY;
      return {
        homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0,
        color, eye, region, material, profile, debugColor, phase: this.random() * Math.PI * 2,
      };
    });
    this.roles = new LocalRoleRegistry(this.anatomy);
    this.cohesionField = new LocalCohesionField(
      this.particles, map.width, map.height, this.originX, this.originY
    );
  }

  /** A pose only changes the targets; it never replaces or recreates particles. */
  setTargetPose(pose) {
    if (pose !== null) {
      const length = this.particles.length * 3;
      if (!(pose.from instanceof Uint8Array) || !(pose.to instanceof Uint8Array) ||
          pose.from.length !== length || pose.to.length !== length ||
          !Number.isFinite(pose.blend) || pose.blend < 0 || pose.blend > 1) {
        throw new TypeError('Disposition cible incompatible avec les particules.');
      }
    }
    this.targetPose = pose;
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

  setBehaviorDrive(drive) {
    if (!drive || typeof drive !== 'object' || Array.isArray(drive)) {
      throw new TypeError('Paramètres de comportement invalides.');
    }
    for (const name of ['wave', 'breath', 'sway', 'cohesion', 'agitation', 'pulse']) {
      const value = drive[name];
      if (!Number.isFinite(value) || value < 0 || value > 4) {
        throw new RangeError(`Comportement invalide : ${name}`);
      }
    }
    this.behaviorDrive = Object.fromEntries(
      ['wave', 'breath', 'sway', 'cohesion', 'agitation', 'pulse'].map(name => [name, drive[name]])
    );
  }

  /** Semantic role assignments change selection, not physical links or materials. */
  setRegionRoles(region, roles) {
    this.roles.setRegionRoles(region, roles);
    return true;
  }

  getRoleAssignments() {
    return this.roles.getAssignments();
  }

  /** One-shot local influence. Can later be driven by a constrained AI command. */
  applyField({ x, y, radius = 65, strength = 90, region, role } = {}) {
    if (!Number.isFinite(x) || x < 0 || x >= this.size ||
        !Number.isFinite(y) || y < 0 || y >= this.size ||
        !Number.isFinite(radius) || radius < 4 || radius > 250 ||
        !Number.isFinite(strength) || Math.abs(strength) > 280) {
      throw new RangeError('Champ de force hors limites.');
    }
    let regionIndex = null;
    if (region !== undefined) {
      regionIndex = this.anatomy?.names.indexOf(region) ?? -1;
      if (regionIndex < 0) throw new RangeError(`Zone anatomique inconnue : ${String(region)}`);
    }
    if (role !== undefined) this.roles.validateRole(role);
    if (this.paused) return false;
    const radiusSquared = radius * radius;
    for (const particle of this.particles) {
      if (regionIndex !== null && particle.region !== regionIndex) continue;
      if (role !== undefined && !this.roles.has(particle, role)) continue;
      const dx = particle.x - x;
      const dy = particle.y - y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= radiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const angle = distance > 0.0001 ? Math.atan2(dy, dx) : particle.phase;
      const impulse = strength * (1 - distance / radius);
      particle.vx += Math.cos(angle) * impulse;
      particle.vy += Math.sin(angle) * impulse;
    }
    return true;
  }

  blink() {
    if (this.paused || this.mode !== 'idle') return false;
    this.blinkStartedAt = this.clock;
    this.nextBlinkAt = this.clock + 3.8 + this.random() * 3.7;
    return true;
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
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
      throw new RangeError('Origine de l’impact invalide.');
    }
    if (this.paused) return false;
    this.mode = 'explode';
    this.modeTime = 0;
    this.colorMix = 1;
    const intensity = this.dispersion;

    for (const particle of this.particles) {
      const dx = particle.x - originX;
      const dy = particle.y - originY;
      const angle = Math.atan2(dy, dx) + (this.random() - 0.5) * 0.9;
      const force = (140 + this.random() * 160) * intensity * (particle.material?.impact ?? 1);
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
      const radius = (55 + this.random() * 130) * this.dispersion * (particle.material?.impact ?? 1);
      particle.x = center + Math.cos(angle) * radius;
      particle.y = center + Math.sin(angle) * radius;
      particle.vx = Math.cos(angle + Math.PI / 2) * 18;
      particle.vy = Math.sin(angle + Math.PI / 2) * 18;
    }
    return true;
  }

  reset() {
    this.targetPose = null;
    this.mode = 'idle';
    this.modeTime = 0;
    this.colorMix = 0;
    this.blinkStartedAt = -1;
    this.nextBlinkAt = this.clock + 3.8 + this.random() * 3.7;
    this.roles.reset();
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
    const drive = this.behaviorDrive;
    const levitation = Math.sin(this.clock * 1.7) * 2.3;
    const sway = Math.sin(this.clock * 0.85) * 1.3 * drive.sway;
    const organic = this.organicMotion * drive.wave;
    const breathe = Math.sin(this.clock * 1.35) * 0.014 * this.organicMotion * drive.breath +
      Math.sin(this.clock * 11.5) * 0.004 * drive.pulse;
    const centerX = this.originX + this.map.width / 2;
    const centerY = this.originY + this.map.height / 2;
    const baseFriction = Math.exp(-this.damping * dt);

    const pose = this.targetPose;
    // The reference pose directs the movement; cohesion is still present but
    // must not pull the animated silhouette back toward the static source.
    const cohesionScale = pose ? 0.25 : 1;
    this.cohesionField.apply(this.particles,
      this.cohesion * drive.cohesion * this.getRecoveryFactor() * cohesionScale, dt);
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const material = particle.material;
      const wave = material?.wave ?? 1;
      const breath = material?.breath ?? 1;
      const regionFloat = material?.float ?? 0;
      // Le léger flottement collectif n'isole pas physiquement les régions.
      const groupPhase = particle.region ?? 0;
      const floatX = Math.sin(this.clock * 1.37 + groupPhase * 0.67) * regionFloat * organic * 0.55;
      const floatY = Math.sin(this.clock * 1.83 + groupPhase * 0.45) * regionFloat * organic * 0.8;
      const waveX = Math.sin(this.clock * 1.12 + particle.homeY * 0.028) * 1.25 * organic * wave;
      const waveY = Math.sin(this.clock * 0.95 + particle.homeX * 0.035) * 0.70 * organic * wave;
      const blinkY = (this.anatomy ? this.roles.has(particle, 'blink') : particle.eye) ? (this.originY + 131 - particle.homeY) * blink : 0;
      // Thinking and speech add a subtle internal vibration without relocating the eye.
      const agitation = drive.agitation * ((this.anatomy ? this.roles.has(particle, 'gaze') : particle.eye) ? 0.08 : 1) *
        Math.sin(this.clock * 8 + particle.homeX * 0.14 + particle.homeY * 0.08);
      let targetX = particle.homeX + sway + waveX + floatX + agitation + (particle.homeX - centerX) * breathe * breath;
      let targetY = particle.homeY + levitation + waveY + floatY + blinkY - agitation * 0.5 +
        (particle.homeY - centerY) * breathe * breath;
      if (pose) {
        const offset = index * 3;
        const blend = pose.blend;
        const x = pose.from[offset] + (pose.to[offset] - pose.from[offset]) * blend;
        const y = pose.from[offset + 1] + (pose.to[offset + 1] - pose.from[offset + 1]) * blend;
        targetX = this.originX + x + (targetX - particle.homeX) * 0.10;
        targetY = this.originY + y + blinkY + (targetY - particle.homeY - blinkY) * 0.10;
      }
      const spring = pose ? Math.max(90, this.stiffness * 3) * (material?.spring ?? 1) :
        this.stiffness * (material?.spring ?? 1);
      const friction = pose ? Math.exp(-Math.max(13, this.damping * 1.5) * (material?.damping ?? 1) * dt) :
        (material ? Math.exp(-this.damping * material.damping * dt) : baseFriction);
      particle.vx += (targetX - particle.x) * spring * dt;
      particle.vy += (targetY - particle.y) * spring * dt;
      particle.vx *= friction;
      particle.vy *= friction;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (pose) {
        // Short visual feedback time keeps the silhouette readable even when
        // two reference poses differ sharply. Hit/reveal temporarily release it.
        const follow = (1 - Math.exp(-48 * dt)) * this.getRecoveryFactor();
        particle.x += (targetX - particle.x) * follow;
        particle.y += (targetY - particle.y) * follow;
        particle.vx *= 1 - follow;
        particle.vy *= 1 - follow;
      }
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

    const pose = this.targetPose;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const x = Math.round(particle.x);
      const y = Math.round(particle.y);
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;

      const [originalRed, originalGreen, originalBlue, a] = particle.color;
      let r = originalRed;
      let g = originalGreen;
      let b = originalBlue;
      if (pose) {
        const offset = index * 3 + 2;
        const sourceColor = TARGET_COLOR_PALETTE[pose.from[offset]];
        const nextColor = TARGET_COLOR_PALETTE[pose.to[offset]];
        // The reference's gray/black shading moves WITH its target pixels.
        r = sourceColor[0] + (nextColor[0] - sourceColor[0]) * pose.blend;
        g = sourceColor[1] + (nextColor[1] - sourceColor[1]) * pose.blend;
        b = sourceColor[2] + (nextColor[2] - sourceColor[2]) * pose.blend;
      }
      const opacity = (a / 255) * ((this.anatomy ? this.roles.has(particle, 'blink') : particle.eye) ? 1 - blink * 0.98 : 1);
      if (opacity <= 0) continue;

      const pixelIndex = y * this.size + x;
      const offset = pixelIndex * 4;
      const previousWeight = this.pixelWeights[pixelIndex];
      const weight = opacity * (particle.eye ? 6 : 1);
      const totalWeight = previousWeight + weight;
      const variation = 0.72 + 0.28 * Math.sin(particle.phase + this.clock * 2.4) ** 2;
      const tint = Math.min(1, mix * variation * (particle.material?.tint ?? 1));
      // The behavior state never changes the colors of the original art.
      // Only explicit reveal/explosion effects and anatomy inspection may recolor pixels.
      let red = r + (accentR - r) * tint;
      let green = g + (accentG - g) * tint;
      let blue = b + (accentB - b) * tint;
      if (showAnatomy && particle.debugColor) {
        [red, green, blue] = particle.debugColor;
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
