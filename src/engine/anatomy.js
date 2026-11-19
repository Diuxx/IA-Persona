/**
 * The anatomy map only answers "which region contains this pixel?".
 * A region declares capabilities (roles) and a material, but never owns a
 * separate simulation. All particles live in the same ParticleWorld.
 */
const MATERIAL_PRESETS = Object.freeze({
  cloud: Object.freeze({ spring: 1, damping: 1, cohesion: 1, breath: 1, wave: 1, float: 0, impact: 1, tint: 1 }),
  optic: Object.freeze({ spring: 1.5, damping: 1.3, cohesion: 1.5, breath: 0.35, wave: 0.18, float: 0, impact: 0.7, tint: 0.3 }),
  facial: Object.freeze({ spring: 1.3, damping: 1.2, cohesion: 1.3, breath: 0.5, wave: 0.35, float: 0, impact: 0.85, tint: 0.6 }),
  vapor: Object.freeze({ spring: 0.95, damping: 1, cohesion: 1.1, breath: 1.2, wave: 1.2, float: 0.5, impact: 1.08, tint: 1 }),
  droplet: Object.freeze({ spring: 0.75, damping: 0.9, cohesion: 1.1, breath: 0.7, wave: 1.25, float: 1.6, impact: 1.35, tint: 1.3 }),
  limb: Object.freeze({ spring: 1.15, damping: 1.1, cohesion: 1.1, breath: 0.5, wave: 0.35, float: 0.35, impact: 1.1, tint: 0.8 }),
  spark: Object.freeze({ spring: 0.7, damping: 0.85, cohesion: 0.8, breath: 0.2, wave: 1.3, float: 2, impact: 1.5, tint: 1.35 }),
});

const REGION_DEFINITIONS = Object.freeze({
  body: Object.freeze({ material: 'cloud', roles: ['breathe', 'deform', 'express'], debug: [85, 92, 112] }),
  eye: Object.freeze({ material: 'optic', roles: ['gaze', 'blink', 'focus'], debug: [247, 244, 221] }),
  expression: Object.freeze({ material: 'facial', roles: ['express', 'focus'], debug: [221, 129, 171] }),
  'puff-top': Object.freeze({ material: 'vapor', roles: ['breathe', 'deform', 'float'], debug: [138, 129, 215] }),
  'puff-left': Object.freeze({ material: 'vapor', roles: ['breathe', 'deform', 'float'], debug: [105, 161, 218] }),
  'puff-right': Object.freeze({ material: 'vapor', roles: ['breathe', 'deform', 'float'], debug: [95, 197, 186] }),
  'droplet-left': Object.freeze({ material: 'droplet', roles: ['float', 'orbit', 'express'], debug: [226, 164, 105] }),
  'droplet-right': Object.freeze({ material: 'droplet', roles: ['float', 'orbit', 'express'], debug: [232, 133, 105] }),
  'leg-left': Object.freeze({ material: 'limb', roles: ['anchor', 'deform'], debug: [205, 170, 115] }),
  'leg-right': Object.freeze({ material: 'limb', roles: ['anchor', 'deform'], debug: [173, 203, 114] }),
  spark: Object.freeze({ material: 'spark', roles: ['float', 'orbit', 'sparkle'], debug: [185, 142, 225] }),
});

// A compatibility projection for consumers of V2.2's region profiles. Physics
// now reads `particle.material`, never the region profile or its identity.
const ANATOMY_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(REGION_DEFINITIONS).map(([name, definition]) => [name, Object.freeze({
    ...MATERIAL_PRESETS[definition.material], debug: definition.debug,
  })])
));

/** Validates exact pixel coverage and assigns region, material and appearance. */
function assignAnatomy(pixels, anatomy, width, height) {
  if (!anatomy || anatomy.width !== width || anatomy.height !== height ||
      !Array.isArray(anatomy.regions) || typeof anatomy.runs !== 'string') {
    throw new TypeError('La carte anatomique est absente ou incompatible.');
  }
  if (anatomy.regions.length === 0 || anatomy.regions.length > 255 ||
      new Set(anatomy.regions).size !== anatomy.regions.length ||
      anatomy.regions.some((name) => !Object.hasOwn(REGION_DEFINITIONS, name))) {
    throw new Error('La carte contient des zones anatomiques inconnues ou dupliquées.');
  }

  const raw = Uint8Array.from(atob(anatomy.runs), c => c.charCodeAt(0));
  if (raw.length % 4 !== 0) throw new Error('La carte anatomique est tronquée.');
  const regions = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < raw.length; i += 4) {
    const [y, x, count, region] = raw.subarray(i, i + 4);
    if (y >= height || x + count > width || count === 0 || region >= anatomy.regions.length) {
      throw new Error('Segment anatomique invalide.');
    }
    for (let column = x; column < x + count; column += 1) {
      const offset = y * width + column;
      if (regions[offset] !== 255) throw new Error('Chevauchement entre zones anatomiques.');
      regions[offset] = region;
    }
  }

  const counts = new Uint32Array(anatomy.regions.length);
  const materials = anatomy.regions.map(name => MATERIAL_PRESETS[REGION_DEFINITIONS[name].material]);
  const roles = anatomy.regions.map(name => [...REGION_DEFINITIONS[name].roles]);
  const profiles = anatomy.regions.map(name => ANATOMY_PROFILES[name]);
  const debugColors = anatomy.regions.map(name => REGION_DEFINITIONS[name].debug);
  const occupied = new Uint8Array(width * height);
  for (const pixel of pixels) {
    const index = pixel.y * width + pixel.x;
    if (regions[index] === 255 || occupied[index]) {
      throw new Error('La carte anatomique ne correspond pas aux pixels du personnage.');
    }
    const region = regions[index];
    pixel.region = region;
    pixel.material = materials[region];
    pixel.profile = profiles[region]; // V2.2 compatibility, not used by the physics.
    pixel.debugColor = debugColors[region];
    occupied[index] = 1;
    counts[region] += 1;
  }
  for (let index = 0; index < regions.length; index += 1) {
    if (regions[index] !== 255 && !occupied[index]) {
      throw new Error('La carte anatomique désigne des pixels invisibles.');
    }
  }
  if (pixels.length !== anatomy.count) {
    throw new Error('Le nombre de pixels de la carte anatomique ne correspond pas.');
  }
  return { names: anatomy.regions, counts, materials, roles, profiles, debugColors };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { assignAnatomy, MATERIAL_PRESETS, REGION_DEFINITIONS, ANATOMY_PROFILES };
} else {
  window.assignAnatomy = assignAnatomy;
  window.MATERIAL_PRESETS = MATERIAL_PRESETS;
  window.REGION_DEFINITIONS = REGION_DEFINITIONS;
  window.ANATOMY_PROFILES = ANATOMY_PROFILES;
}
