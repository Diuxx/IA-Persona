/**
 * Anatomical regions of the reference drawing.
 * Region IDs are compiled off-line in persona-anatomy.js. Each particle has
 * exactly one region, with physical coefficients shared by its neighbors.
 */
const ANATOMY_PROFILES = Object.freeze({
  body: Object.freeze({ spring: 1, damping: 1, cohesion: 1, breath: 1, wave: 1, float: 0, impact: 1, tint: 1, debug: [85, 92, 112] }),
  eye: Object.freeze({ spring: 1.5, damping: 1.3, cohesion: 1.5, breath: 0.35, wave: 0.18, float: 0, impact: 0.7, tint: 0.30, debug: [247, 244, 221] }),
  expression: Object.freeze({ spring: 1.3, damping: 1.2, cohesion: 1.3, breath: 0.5, wave: 0.35, float: 0, impact: 0.85, tint: 0.6, debug: [221, 129, 171] }),
  'puff-top': Object.freeze({ spring: 0.95, damping: 1, cohesion: 1.15, breath: 1.25, wave: 1.2, float: 0.4, impact: 1.05, tint: 1, debug: [138, 129, 215] }),
  'puff-left': Object.freeze({ spring: 0.95, damping: 1, cohesion: 1.1, breath: 1.15, wave: 1.15, float: 0.5, impact: 1.08, tint: 1, debug: [105, 161, 218] }),
  'puff-right': Object.freeze({ spring: 0.95, damping: 1, cohesion: 1.1, breath: 1.15, wave: 1.15, float: 0.6, impact: 1.08, tint: 1, debug: [95, 197, 186] }),
  'droplet-left': Object.freeze({ spring: 0.75, damping: 0.9, cohesion: 1.1, breath: 0.7, wave: 1.25, float: 1.6, impact: 1.35, tint: 1.3, debug: [226, 164, 105] }),
  'droplet-right': Object.freeze({ spring: 0.75, damping: 0.9, cohesion: 1.1, breath: 0.7, wave: 1.25, float: 1.6, impact: 1.35, tint: 1.3, debug: [232, 133, 105] }),
  'leg-left': Object.freeze({ spring: 1.15, damping: 1.1, cohesion: 1.1, breath: 0.5, wave: 0.35, float: 0.35, impact: 1.1, tint: 0.8, debug: [205, 170, 115] }),
  'leg-right': Object.freeze({ spring: 1.15, damping: 1.1, cohesion: 1.1, breath: 0.5, wave: 0.35, float: 0.35, impact: 1.1, tint: 0.8, debug: [173, 203, 114] }),
  spark: Object.freeze({ spring: 0.7, damping: 0.85, cohesion: 0.8, breath: 0.2, wave: 1.3, float: 2, impact: 1.5, tint: 1.35, debug: [185, 142, 225] }),
});

/** Decodes the anatomy map and validates exact pixel-for-pixel coverage. */
function assignAnatomy(pixels, anatomy, width, height) {
  if (!anatomy || anatomy.width !== width || anatomy.height !== height ||
      !Array.isArray(anatomy.regions) || typeof anatomy.runs !== 'string') {
    throw new TypeError('La carte anatomique est absente ou incompatible.');
  }
  if (anatomy.regions.length === 0 || anatomy.regions.length > 255 ||
      new Set(anatomy.regions).size !== anatomy.regions.length ||
      anatomy.regions.some((name) => !Object.hasOwn(ANATOMY_PROFILES, name))) {
    throw new Error('La carte contient des zones anatomiques inconnues ou dupliquées.');
  }

  const raw = Uint8Array.from(atob(anatomy.runs), (c) => c.charCodeAt(0));
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
  const profiles = anatomy.regions.map((name) => ANATOMY_PROFILES[name]);
  // Validate both directions. No zone may contain an invisible pixel, and no
  // particle may be left unclassified when loading regenerated assets.
  const occupied = new Uint8Array(width * height);
  for (const pixel of pixels) {
    const index = pixel.y * width + pixel.x;
    if (regions[index] === 255 || occupied[index]) {
      throw new Error('La carte anatomique ne correspond pas aux pixels du personnage.');
    }
    const region = regions[index];
    pixel.region = region;
    pixel.profile = profiles[region];
    occupied[index] = 1;
    counts[region] += 1;
  }
  for (let index = 0; index < regions.length; index += 1) {
    if (regions[index] !== 255 && !occupied[index]) {
      throw new Error('La carte anatomique désigne des pixels invisibles.');
    }
  }
  if (pixels.length !== anatomy.count) throw new Error('Le nombre de pixels de la carte anatomique ne correspond pas.');
  return { names: anatomy.regions, counts, profiles };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { assignAnatomy, ANATOMY_PROFILES };
} else {
  window.assignAnatomy = assignAnatomy;
  window.ANATOMY_PROFILES = ANATOMY_PROFILES;
}
