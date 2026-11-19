/**
 * Translates intentions into bounded physical controls. The controller never
 * draws pixels and does not depend on a DOM, a network or a language model.
 * Future adapters can send the same validated commands as the demo UI.
 */
const BEHAVIOR_PRESETS = Object.freeze({
  idle: Object.freeze({ wave: 1, breath: 1, sway: 1, cohesion: 1, agitation: 0, pulse: 0, tint: 0, accent: [165, 138, 252] }),
  listening: Object.freeze({ wave: 0.58, breath: 0.86, sway: 0.45, cohesion: 1.13, agitation: 0.04, pulse: 0.35, tint: 0.28, accent: [86, 171, 247] }),
  thinking: Object.freeze({ wave: 1.3, breath: 1.05, sway: 0.6, cohesion: 1.06, agitation: 0.78, pulse: 0.22, tint: 0.48, accent: [171, 125, 253] }),
  speaking: Object.freeze({ wave: 1.03, breath: 1.1, sway: 0.55, cohesion: 1.02, agitation: 0.22, pulse: 1, tint: 0.34, accent: [105, 218, 232] }),
});

const DRIVE_FIELDS = Object.freeze(['wave', 'breath', 'sway', 'cohesion', 'agitation', 'pulse', 'tint']);
const TRANSITION_DURATION = 0.42;
const INITIAL_ENERGY = 0.45;

function interpolate(a, b, progress) {
  return a + (b - a) * progress;
}

function smoothstep(value) {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}

function buildDrive(preset, energy, voiceLevel) {
  const drive = {
    wave: preset.wave * (0.72 + energy * 0.62),
    breath: preset.breath * (0.8 + energy * 0.45),
    sway: preset.sway,
    cohesion: preset.cohesion,
    agitation: preset.agitation * energy,
    pulse: preset.pulse * (0.25 + energy * 0.3 + voiceLevel * 0.75),
    tint: preset.tint * (0.7 + energy * 0.3),
    accent: [...preset.accent],
  };
  return drive;
}

function blendDrives(previous, next, fraction) {
  const amount = smoothstep(fraction);
  const result = { accent: previous.accent.map((v, index) => interpolate(v, next.accent[index], amount)) };
  for (const key of DRIVE_FIELDS) result[key] = interpolate(previous[key], next[key], amount);
  return result;
}

class BehaviorController {
  constructor(world, { transitionDuration = TRANSITION_DURATION } = {}) {
    if (!world || typeof world.setBehaviorDrive !== 'function' || typeof world.applyField !== 'function') {
      throw new TypeError('Le contrôleur nécessite un moteur de particules compatible.');
    }
    if (!Number.isFinite(transitionDuration) || transitionDuration <= 0 || transitionDuration > 5) {
      throw new RangeError('Durée de transition invalide.');
    }
    this.world = world;
    this.state = 'idle';
    this.energy = INITIAL_ENERGY;
    this.voiceLevel = 0;
    this.transitionDuration = transitionDuration;
    this.transitionElapsed = transitionDuration;
    this.previousDrive = buildDrive(BEHAVIOR_PRESETS.idle, this.energy, this.voiceLevel);
    this.drive = buildDrive(BEHAVIOR_PRESETS.idle, this.energy, this.voiceLevel);
    this.world.setBehaviorDrive(this.drive);
  }

  setState(state) {
    if (typeof state !== 'string' || !Object.hasOwn(BEHAVIOR_PRESETS, state)) {
      throw new RangeError(`Comportement inconnu : ${String(state)}`);
    }
    if (state === this.state) return false;
    this.previousDrive = this.drive;
    this.state = state;
    this.transitionElapsed = 0;
    return true;
  }

  setEnergy(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Énergie hors limites (0–1).');
    this.energy = value;
  }

  setVoiceLevel(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Niveau vocal hors limites (0–1).');
    this.voiceLevel = value;
  }

  advance(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Durée invalide.');
    if (this.world.paused || deltaSeconds === 0) return;
    this.transitionElapsed = Math.min(this.transitionDuration, this.transitionElapsed + deltaSeconds);
    const target = buildDrive(BEHAVIOR_PRESETS[this.state], this.energy,
      this.state === 'speaking' ? this.voiceLevel : 0);
    this.drive = this.transitionElapsed < this.transitionDuration
      ? blendDrives(this.previousDrive, target, this.transitionElapsed / this.transitionDuration)
      : target;
    this.world.setBehaviorDrive(this.drive);
  }

  trigger(effect, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Options de réaction invalides.');
    }
    switch (effect) {
      case 'hit':
        return this.world.explode(options.x, options.y);
      case 'reveal':
        return this.world.reveal();
      case 'blink':
        return this.world.blink();
      case 'field':
        return this.world.applyField(options);
      default:
        throw new RangeError(`Réaction inconnue : ${String(effect)}`);
    }
  }

  /** Explicit allowlist: never execute arbitrary JavaScript from an external adapter. */
  dispatch(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new TypeError('Commande invalide.');
    }
    switch (command.type) {
      case 'state': return this.setState(command.value);
      case 'energy': this.setEnergy(command.value); return true;
      case 'voice': this.setVoiceLevel(command.value); return true;
      case 'effect': return this.trigger(command.name, command.options);
      default: throw new RangeError(`Commande non prise en charge : ${String(command.type)}`);
    }
  }

  reset() {
    this.world.reset();
    this.state = 'idle';
    this.energy = INITIAL_ENERGY;
    this.voiceLevel = 0;
    this.previousDrive = buildDrive(BEHAVIOR_PRESETS.idle, this.energy, this.voiceLevel);
    this.drive = this.previousDrive;
    this.transitionElapsed = this.transitionDuration;
    this.world.setBehaviorDrive(this.drive);
  }

  getSnapshot() {
    return Object.freeze({
      state: this.state,
      energy: this.energy,
      voiceLevel: this.voiceLevel,
      effect: this.world.mode,
      paused: this.world.paused,
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BehaviorController, BEHAVIOR_PRESETS, buildDrive, blendDrives };
} else {
  window.BehaviorController = BehaviorController;
}
