/**
 * Translates intentions into bounded physical controls. The controller never
 * draws pixels and does not depend on a DOM, a network or a language model.
 * Future adapters can send the same validated commands as the demo UI.
 */
const BEHAVIOR_PRESETS = Object.freeze({
  idle: Object.freeze({ wave: 1, breath: 1, sway: 1, cohesion: 1, agitation: 0, pulse: 0 }),
  listening: Object.freeze({ wave: 0.58, breath: 0.86, sway: 0.45, cohesion: 1.13, agitation: 0.04, pulse: 0.35 }),
  thinking: Object.freeze({ wave: 1.3, breath: 1.05, sway: 0.6, cohesion: 1.06, agitation: 0.78, pulse: 0.22 }),
  speaking: Object.freeze({ wave: 1.03, breath: 1.1, sway: 0.55, cohesion: 1.02, agitation: 0.22, pulse: 1 }),
});

const DRIVE_FIELDS = Object.freeze(['wave', 'breath', 'sway', 'cohesion', 'agitation', 'pulse']);
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
  };
  return drive;
}

function blendDrives(previous, next, fraction) {
  const amount = smoothstep(fraction);
  const result = {};
  for (const key of DRIVE_FIELDS) result[key] = interpolate(previous[key], next[key], amount);
  return result;
}

class BehaviorController {
  constructor(world, { transitionDuration = TRANSITION_DURATION, animationPlayer = null, roleMotionPlayer = null } = {}) {
    if (!world || typeof world.setBehaviorDrive !== 'function' || typeof world.applyField !== 'function') {
      throw new TypeError('Le contrôleur nécessite un moteur de particules compatible.');
    }
    if (!Number.isFinite(transitionDuration) || transitionDuration <= 0 || transitionDuration > 5) {
      throw new RangeError('Durée de transition invalide.');
    }
    this.world = world;
    this.animationPlayer = animationPlayer;
    this.roleMotionPlayer = roleMotionPlayer;
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
    if (state !== 'idle') this.animationPlayer?.stop();
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
    this.animationPlayer?.advance(deltaSeconds);
    this.roleMotionPlayer?.advance(deltaSeconds);
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

  /** A role-based action delegates physical effects to the same bounded engine. */
  runRoleAction({ role, action, options = {} }) {
    this.world.roles.validateRole(role);
    if (action !== 'attract' && action !== 'repel') {
      throw new RangeError(`Action non prise en charge : ${String(action)}`);
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Options d’action invalides.');
    }
    const strength = options.strength ?? 90;
    if (!Number.isFinite(strength) || strength < 0 || strength > 280) {
      throw new RangeError('Intensité d’action hors limites (0–280).');
    }
    return this.world.applyField({
      ...options, role, strength: action === 'attract' ? -strength : strength,
    });
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
      case 'roles': return this.world.setRegionRoles(command.region, command.roles);
      case 'action': return this.runRoleAction(command);
      case 'animation': return this.controlAnimation(command);
      case 'role-motion': return this.controlRoleMotion(command);
      default: throw new RangeError(`Commande non prise en charge : ${String(command.type)}`);
    }
  }

  /** Explicit animation allowlist; external actors cannot load arbitrary assets. */
  controlAnimation(command) {
    if (!this.animationPlayer) throw new RangeError('Aucune animation cible disponible.');
    if (command.action === 'stop') return this.animationPlayer.stop();
    if (command.action === 'speed') return this.animationPlayer.setSpeed(command.value);
    if (command.action === 'particle-count') return this.animationPlayer.setParticleCount(command.count);
    if (command.action === 'pause') return this.animationPlayer.pauseForInspection();
    if (command.action === 'resume') return this.animationPlayer.resume();
    if (command.action === 'loop-end') return this.animationPlayer.setLoopEndFrame(command.frame);
    if (command.action === 'seek') {
      if (this.state !== 'idle') this.setState('idle');
      return this.animationPlayer.inspectFrame(command.frame);
    }
    if (command.action !== undefined && command.action !== 'play') {
      throw new RangeError('Action d’animation inconnue.');
    }
    if (command.name !== this.animationPlayer.animation.name) {
      throw new RangeError('Animation cible inconnue.');
    }
    if (this.state !== 'idle') this.setState('idle');
    return this.animationPlayer.play({ loop: command.loop ?? true });
  }

  /** The same validated route serves manual controls and a future AI adapter. */
  controlRoleMotion(command) {
    if (!this.roleMotionPlayer) throw new RangeError('Aucun lecteur de mouvement de rôle disponible.');
    if (command.action === 'stop') return this.roleMotionPlayer.stop();
    if (command.action !== undefined && command.action !== 'play') {
      throw new RangeError('Commande de mouvement de rôle inconnue.');
    }
    return this.roleMotionPlayer.play({ name: command.name, role: command.role ?? null });
  }

  reset() {
    this.roleMotionPlayer?.stop();
    this.animationPlayer?.stop();
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
      particleCount: this.world.dynamicPopulation ? this.world.visibleParticleCount : this.world.particles.length,
      ...(this.world.dynamicPopulation ? { particleCapacity: this.world.particles.length } : {}),
      ...(this.animationPlayer ? { animation: this.animationPlayer.getSnapshot() } : {}),
      ...(this.roleMotionPlayer ? { roleMotion: this.roleMotionPlayer.getSnapshot() } : {}),
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BehaviorController, BEHAVIOR_PRESETS, buildDrive, blendDrives };
} else {
  window.BehaviorController = BehaviorController;
}
