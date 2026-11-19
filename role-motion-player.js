/**
 * Short, bounded physical movements aimed at a semantic role.
 * These are additive forces, not alternatives to imported target-frame clips.
 */
const ROLE_MOTIONS = Object.freeze({ pulse: 1.6, wave: 1.8, orbit: 2.2 });
const MOTION_ACCELERATION = 220; // simulation pixels / second²

class RoleMotionPlayer {
  constructor(world) {
    if (!world || !Array.isArray(world.particles) || !world.roles ||
        typeof world.roles.has !== 'function') {
      throw new TypeError('Un monde de particules avec des rôles est nécessaire.');
    }
    this.world = world;
    this.current = null;
  }

  play({ name, role = null } = {}) {
    if (typeof name !== 'string' || !Object.hasOwn(ROLE_MOTIONS, name)) {
      throw new RangeError(`Mouvement inconnu : ${String(name)}`);
    }
    if (role !== null) this.world.roles.validateRole(role);
    this.current = { name, role, elapsed: 0, duration: ROLE_MOTIONS[name] };
    return true;
  }

  stop() {
    if (!this.current) return false;
    this.current = null;
    return true;
  }

  advance(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Pas de mouvement invalide.');
    }
    if (!this.current || this.world.paused || deltaSeconds === 0) return;

    const motion = this.current;
    motion.elapsed = Math.min(motion.duration, motion.elapsed + deltaSeconds);
    const envelope = Math.sin(Math.PI * motion.elapsed / motion.duration);
    const center = this.world.size / 2;
    const acceleration = MOTION_ACCELERATION * envelope * Math.min(deltaSeconds, 1 / 30);

    for (const particle of this.world.particles) {
      if (motion.role !== null && !this.world.roles.has(particle, motion.role)) continue;

      const dx = particle.homeX - center;
      const dy = particle.homeY - center;
      const distance = Math.max(12, Math.hypot(dx, dy));

      if (motion.name === 'pulse') {
        const oscillation = Math.sin(motion.elapsed * 12);
        particle.vx += dx / distance * acceleration * oscillation;
        particle.vy += dy / distance * acceleration * oscillation;
      } else if (motion.name === 'wave') {
        particle.vy += acceleration * Math.sin(particle.homeX * 0.09 + motion.elapsed * 8);
      } else {
        particle.vx += -dy / distance * acceleration;
        particle.vy += dx / distance * acceleration;
      }
    }

    if (motion.elapsed >= motion.duration) this.stop();
  }

  getSnapshot() {
    if (!this.current) return Object.freeze({ playing: false });
    return Object.freeze({
      playing: true,
      name: this.current.name,
      role: this.current.role,
      progress: this.current.elapsed / this.current.duration,
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RoleMotionPlayer, ROLE_MOTIONS };
} else {
  window.RoleMotionPlayer = RoleMotionPlayer;
}
