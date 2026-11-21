'use strict';

// Use the validated production-analysis decoder; no second asset format parser.
const { decodeAnimation } = require('../tools/motion_analysis/decoder.cjs');
const { PERSONA_IDLE_TARGETS } = require('../assets/animations/idle-targets.js');
const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');

const data = decodeAnimation(PERSONA_IDLE_TARGETS, PERSONA_PIXEL_MAP, PERSONA_ANATOMY);
const { frames, regionIds, ...metadata } = data;
process.stdout.write(JSON.stringify({
  ...metadata,
  loop: true,
  regionIds: Buffer.from(regionIds).toString('base64'),
  frames: Buffer.concat(frames.map(frame => Buffer.from(frame))).toString('base64'),
}));
