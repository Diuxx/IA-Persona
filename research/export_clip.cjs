'use strict';

// Reuse the runtime codec for signed coordinates, then discard all identities.
const { ParticleWorld } = require('../src/engine/particle-world.js');
const { decodeAnimation } = require('../src/animation/target-animation-codec.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
const { PERSONA_LEFT_TARGETS } = require('../assets/animations/left-targets.js');
const { PERSONA_RIGHT_TARGETS } = require('../assets/animations/right-targets.js');

async function main() {
  const clips = { left: PERSONA_LEFT_TARGETS, right: PERSONA_RIGHT_TARGETS };
  const name = process.argv[2];
  if (!Object.hasOwn(clips, name)) throw new Error('Expected left or right');
  const animation = clips[name];
  const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY, seed: 2026 });
  const frames = await decodeAnimation(animation, world);
  const rasters = frames.map(frame => {
    const raster = Buffer.alloc(world.size * world.size);
    for (let i = 0; i < frame.length; i += 3) {
      const shade = frame[i + 2];
      if (!shade) continue;
      const x = frame[i] + world.originX;
      const y = frame[i + 1] + world.originY;
      raster[y * world.size + x] = shade;
    }
    return raster;
  });
  process.stdout.write(JSON.stringify({
    name, width: world.size, height: world.size, frameCount: frames.length,
    frameDurationMs: animation.durationMs / frames.length,
    loop: false, frameActiveCounts: animation.frameActiveCounts,
    frames: Buffer.concat(rasters).toString('base64'),
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
