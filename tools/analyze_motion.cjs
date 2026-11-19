#!/usr/bin/env node
'use strict';

// Offline analysis of existing compiled pose assets. Never touches the browser loop.
const fs = require('node:fs');
const path = require('node:path');
const { decodeAnimation } = require('./motion_analysis/decoder.cjs');
const { analyzeMotion } = require('./motion_analysis/metrics.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ANIMATION = path.join(ROOT, 'assets/animations/idle-targets.js');
const DEFAULT_OUTPUT = path.join(ROOT, 'assets/animations/analysis/idle.motion.json');

function parseArguments(args) {
  const options = { animation: DEFAULT_ANIMATION, output: DEFAULT_OUTPUT, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--check') {
      options.check = true;
    } else if (option === '--animation' || option === '--output') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Valeur requise après ${option}.`);
      options[option.slice(2)] = path.resolve(value);
    } else {
      throw new Error(`Option inconnue : ${option}`);
    }
  }
  return options;
}

function loadAnimation(filename) {
  const exported = require(filename);
  const available = Object.values(exported).filter(value => value &&
    typeof value === 'object' && value.encoding === 'gzip-particle-major-rgb3-dynamic');
  if (available.length !== 1) throw new Error('Le fichier doit exporter une seule animation dynamique.');
  return available[0];
}

function generateProfile(animation) {
  const { PERSONA_PIXEL_MAP } = require('../assets/persona-map.js');
  const { PERSONA_ANATOMY } = require('../assets/persona-anatomy.js');
  return analyzeMotion(decodeAnimation(animation, PERSONA_PIXEL_MAP, PERSONA_ANATOMY));
}

function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const animation = loadAnimation(options.animation);
  const profile = generateProfile(animation);
  const text = `${JSON.stringify(profile, null, 2)}\n`;
  if (options.check) {
    if (!fs.existsSync(options.output) || fs.readFileSync(options.output, 'utf8') !== text) {
      throw new Error(`Profil manquant ou non synchronisé : ${options.output}`);
    }
  } else {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, text, 'utf8');
  }
  process.stdout.write(`${profile.animation.name}: ${profile.animation.frameCount} frames, ` +
    `${profile.population.minVisible}–${profile.population.maxVisible} particules, ` +
    `${options.check ? 'profil vérifié' : `profil écrit dans ${options.output}`}\n`);
  return profile;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Analyse impossible : ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, generateProfile, main };
