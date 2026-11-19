/**
 * Semantic capabilities, independent of the physics/material graph.
 * Role assignments are indexed by anatomical region, not copied per particle.
 * O(1) membership checks and no allocations in the frame loop.
 */
const ROLE_NAMES = Object.freeze([
  'gaze', 'blink', 'focus', 'breathe', 'deform', 'express',
  'float', 'orbit', 'anchor', 'sparkle',
]);
const ROLE_BITS = Object.freeze(Object.fromEntries(
  ROLE_NAMES.map((name, index) => [name, 1 << index])
));

function validateRoleList(roles) {
  if (!Array.isArray(roles) || roles.length > 6 ||
      new Set(roles).size !== roles.length ||
      roles.some(role => typeof role !== 'string' || !Object.hasOwn(ROLE_BITS, role))) {
    throw new RangeError('Les rôles doivent être uniques, connus et limités à six par zone.');
  }
  return roles.reduce((mask, role) => mask | ROLE_BITS[role], 0);
}

class RoleRegistry {
  constructor(anatomy) {
    this.names = anatomy?.names ?? [];
    this.masks = new Uint32Array(this.names.length);
    if (anatomy) {
      for (let index = 0; index < this.names.length; index += 1) {
        this.masks[index] = validateRoleList(anatomy.roles[index]);
      }
    }
    this.initialMasks = new Uint32Array(this.masks);
  }

  validateRole(role) {
    if (typeof role !== 'string' || !Object.hasOwn(ROLE_BITS, role)) {
      throw new RangeError(`Rôle inconnu : ${String(role)}`);
    }
    if (!this.names.length) throw new RangeError('Aucune anatomie chargée.');
  }

  has(particle, role) {
    return particle.region !== undefined &&
      (this.masks[particle.region] & ROLE_BITS[role]) !== 0;
  }

  hasRegionRole(region, role) {
    this.validateRole(role);
    const index = this.names.indexOf(region);
    if (index < 0) throw new RangeError(`Zone inconnue : ${String(region)}`);
    return (this.masks[index] & ROLE_BITS[role]) !== 0;
  }

  setRegionRoles(region, roles) {
    const index = this.names.indexOf(region);
    if (index < 0) throw new RangeError(`Zone inconnue : ${String(region)}`);
    this.masks[index] = validateRoleList(roles);
  }

  getRoles(region) {
    const index = this.names.indexOf(region);
    if (index < 0) throw new RangeError(`Zone inconnue : ${String(region)}`);
    return ROLE_NAMES.filter(role => (this.masks[index] & ROLE_BITS[role]) !== 0);
  }

  reset() {
    this.masks.set(this.initialMasks);
  }

  getAssignments() {
    return Object.freeze(Object.fromEntries(this.names.map(name => [
      name, Object.freeze(this.getRoles(name)),
    ])));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RoleRegistry, ROLE_NAMES, ROLE_BITS };
} else {
  window.RoleRegistry = RoleRegistry;
  window.ROLE_NAMES = ROLE_NAMES;
}
