/**
 * Idle de la mascotte nuage.
 *
 * Chaque couche conserve les coordonnées du PNG d'origine (181 × 205).
 * L'animation est composée de mouvements indépendants et continus : aucun GIF,
 * aucune transition qui remet brusquement le personnage à zéro.
 */
const ORIGINAL = { width: 181, height: 205 };
const CANVAS = { width: 181, height: 235 };
const TAU = Math.PI * 2;
// Nom historique du fichier : le calque « mouth » contient en réalité l’œil unique.
const EYE_ASSET = 'mouth';
const imageNames = [
  'leg-left', 'leg-right', 'body', 'puff-left', 'puff-top', 'puff-right',
  EYE_ASSET, 'droplet-left', 'droplet-right',
  'spark-1', 'spark-2', 'spark-3', 'spark-4',
];

const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d');
const playButton = document.querySelector('#play-toggle');
const layersButton = document.querySelector('#layers-toggle');
const blinkButton = document.querySelector('#blink-trigger');
const intensityInput = document.querySelector('#intensity');
const intensityValue = document.querySelector('#intensity-value');
const status = document.querySelector('#status');
const stage = document.querySelector('#stage');

const motion = {
  playing: true,
  elapsed: 0,
  lastFrame: 0,
  intensity: Number(intensityInput.value) / 100,
  exploded: 0,
  targetExploded: 0,
  pointerX: 0,
  pointerY: 0,
  targetPointerX: 0,
  targetPointerY: 0,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const assets = new Map();
const blinkController = new EyeBlinkController();
const hitController = new HitController();
let wasHitActive = false;

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([name, img]);
    img.onerror = () => reject(new Error(`Impossible de charger assets/${name}.png`));
    img.src = `./assets/${name}.png`;
  });
}

function sine(seconds, period, phase = 0) {
  return Math.sin((seconds / period) * TAU + phase);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function drawImageLayer(name, options = {}) {
  const image = assets.get(name);
  if (!image) return;
  const {
    x = 90, y = 100, dx = 0, dy = 0,
    sx = 1, sy = 1, rotation = 0,
  } = options;
  context.save();
  context.translate(x + dx, y + dy);
  context.rotate(rotation);
  context.scale(sx, sy);
  context.drawImage(image, -x, -y, ORIGINAL.width, ORIGINAL.height);
  context.restore();
}

/**
 * Le visage original possède un seul œil blanc, compressé vers une fine fente.
 * Aucun second œil ou nouveau dessin n'est ajouté.
 */
function drawEye(seconds, split, power, pose) {
  const closure = blinkController.closureAt(seconds) * Math.min(1, power);
  // Le regard suit discrètement le pointeur, sans remplacer les mouvements spontanés.
  const gazeX = sine(seconds, 9.8, 0.4) * 0.48 * power + motion.pointerX * 0.18;
  const gazeY = sine(seconds, 7.3, 1.1) * 0.25 * power + motion.pointerY * 0.12;
  const eyeTwitch = sine(seconds, 5.9) * 0.004 * power;

  // Le calque lui-même se comprime verticalement : l’œil devient une fine fente,
  // sans rectangle ou ellipse ajoutée et sans modifier les autres volumes du nuage.
  context.save();
  context.globalAlpha = (1 - Math.min(1, pose.eyeOpen * 2.7)) *
    (1 - Math.min(1, pose.squash));
  drawImageLayer(EYE_ASSET, {
    x: 102, y: 133,
    dx: gazeX,
    dy: gazeY + 15 * split,
    sx: 1 + eyeTwitch,
    sy: 1 - closure * 0.93,
  });
  context.restore();
  drawSurprisedEye(pose);
}

/** L'œil unique s'étire et s'ouvre, comme dans l'animation HIT de référence. */
function drawSurprisedEye(pose) {
  const alpha = Math.min(1, pose.eyeOpen * 2.7);
  if (!alpha) return;

  const radiusX = 18 + pose.eyeOpen * 9 - pose.stretch * 17;
  const radiusY = 9 + pose.eyeOpen * 19 + pose.stretch * 37;
  const centerX = 101;
  const centerY = 127 - pose.stretch * 19;

  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = '#f8f8f5';
  context.strokeStyle = '#030303';
  context.lineWidth = 4;
  context.beginPath();
  context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU);
  context.fill();
  context.stroke();

  context.fillStyle = '#070707';
  context.beginPath();
  context.ellipse(centerX + 1, centerY - radiusY * 0.09, 1.9, 3.5, 0, 0, TAU);
  context.fill();

  context.fillStyle = '#ffffff';
  context.beginPath();
  context.ellipse(centerX - radiusX * 0.45, centerY - radiusY * 0.4,
    Math.max(1.5, radiusX * 0.11), Math.max(2, radiusY * 0.18),
    -0.12, 0, TAU);
  context.fill();
  context.restore();
}

function drawShadow(bob, split) {
  const baseAlpha = Math.max(0.08, 0.19 - Math.abs(bob) * 0.012);
  context.save();
  context.globalAlpha = baseAlpha * (1 - split * 0.4);
  context.fillStyle = '#070709';
  context.beginPath();
  context.ellipse(93, 216, 37 + Math.abs(bob) * 1.2, 4.7, 0, 0, TAU);
  context.fill();
  context.restore();
}

function drawCharacter(seconds) {
  const s = seconds;
  const pose = hitController.poseAt(seconds);
  const power = motion.reducedMotion ? 0 : motion.intensity;
  const split = motion.exploded;
  const bob = sine(s, 3.8) * 4.1 * power;
  const breathe = sine(s, 3.15, 0.45) * 0.015 * power;
  const sway = sine(s, 7.2) * 0.013 * power;
  const microTwitch = Math.exp(-Math.pow(((s + 0.12) % 11.7 - 0.17) / 0.10, 2)) * 0.007 * power;

  context.clearRect(0, 0, CANVAS.width, CANVAS.height);
  drawShadow(bob, split);

  context.save();
  // Le mouvement général est commun à toutes les pièces : pas de rupture de raccord.
  context.translate(91 + motion.pointerX,
    106 + bob + motion.pointerY + 9 * pose.squash + 6 * pose.stretch);
  context.rotate(sway);
  context.scale(
    (1 + breathe + microTwitch) * (1 + 0.25 * pose.squash - 0.24 * pose.stretch),
    (1 - breathe * 0.75 - microTwitch) * (1 - 0.33 * pose.squash + 0.16 * pose.stretch),
  );
  context.translate(-91, -106);

  // Les pattes passent sous le corps, qui dissimule leurs points d'attache.
  drawImageLayer('leg-left', {
    x: 68, y: 164, dx: -15 * split - 7 * pose.squash,
    dy: 20 * split + sine(s, 4.8, 1) * 0.7 * power,
    rotation: sine(s, 4.7, 0.4) * 0.018 * power,
  });
  drawImageLayer('leg-right', {
    x: 125, y: 164, dx: 15 * split + 7 * pose.squash,
    dy: 20 * split + sine(s, 5.1, 2.2) * 0.7 * power,
    rotation: sine(s, 4.8, 1.7) * -0.018 * power,
  });

  drawImageLayer('body', { x: 96, y: 110 });
  drawImageLayer('puff-left', {
    x: 51, y: 89, dx: -23 * split - 13 * pose.scatter + sine(s, 3.55, 1.1) * 0.52 * power,
    dy: -3 * split + sine(s, 3.8, 1.5) * 0.40 * power,
    sx: 1 + sine(s, 3.15, -0.6) * 0.006 * power,
  });
  drawImageLayer('puff-top', {
    x: 98, y: 61, dy: -22 * split - 6 * pose.scatter + sine(s, 3.15, 0.5) * 0.68 * power,
    sx: 1 + sine(s, 3.1, 0.7) * 0.008 * power,
    sy: 1 + sine(s, 3.2, -0.5) * 0.009 * power,
  });
  drawImageLayer('puff-right', {
    x: 132, y: 86, dx: 24 * split + 13 * pose.scatter + sine(s, 4.0, 2.5) * 0.55 * power,
    dy: -2 * split + sine(s, 3.5, 0.7) * 0.34 * power,
  });
  drawEye(s, split, power, pose);

  // Les gouttelettes flottent à une fréquence différente de celle du corps.
  drawImageLayer('droplet-left', {
    x: 34, y: 38, dx: -10 * split - 11 * pose.scatter + sine(s, 4.6, 0.3) * 1.9 * power,
    dy: -13 * split + sine(s, 3.35, 0.8) * 1.65 * power,
    rotation: sine(s, 5.8, 2) * 0.065 * power,
  });
  drawImageLayer('droplet-right', {
    x: 146, y: 38, dx: 11 * split + 11 * pose.scatter + sine(s, 5.1, 1.5) * 1.6 * power,
    dy: -12 * split + sine(s, 3.9, 2) * 1.7 * power,
    rotation: sine(s, 5.5, 1) * -0.07 * power,
  });

  const specks = [
    ['spark-1', 48, 7, 0.3],
    ['spark-2', 50, 45, 1.4],
    ['spark-3', 136, 43, 2.5],
    ['spark-4', 143, 48, 3.1],
  ];
  for (const [name, x, y, phase] of specks) {
    drawImageLayer(name, {
      x, y,
      dx: (x < 90 ? -17 : 17) * split + (x < 90 ? -15 : 15) * pose.scatter + sine(s, 6.1, phase) * 2.3 * power,
      dy: -18 * split - 8 * pose.scatter + sine(s, 4.5, phase) * 2.1 * power,
    });
  }
  context.restore();
}

function frame(timestamp) {
  const seconds = timestamp / 1000;
  const delta = motion.lastFrame === 0 ? 0 : Math.min(seconds - motion.lastFrame, 0.05);
  motion.lastFrame = seconds;
  if (motion.playing && !motion.reducedMotion) {
    motion.elapsed += delta;
    // Le pointeur ne provoque plus de déplacement brusque à l’entrée ou à la sortie.
    const pointerSmoothing = 1 - Math.exp(-delta * 7);
    motion.pointerX = lerp(motion.pointerX, motion.targetPointerX * motion.intensity, pointerSmoothing);
    motion.pointerY = lerp(motion.pointerY, motion.targetPointerY * motion.intensity, pointerSmoothing);
  }
  const smoothing = 1 - Math.exp(-delta * 8);
  motion.exploded = lerp(motion.exploded, motion.targetExploded, smoothing);
  drawCharacter(motion.elapsed);
  const hitActive = hitController.isActiveAt(motion.elapsed);
  if (wasHitActive && !hitActive && motion.playing) {
    status.textContent = 'Idle · animé';
  }
  wasHitActive = hitActive;
  requestAnimationFrame(frame);
}

function handlePointer(event) {
  if (!motion.playing || motion.reducedMotion) return;
  const rect = stage.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  // La légère orientation vers le pointeur reste facultative et discrète.
  motion.targetPointerX = Math.max(-2, Math.min(2, x * 3.5));
  motion.targetPointerY = Math.max(-1, Math.min(1, y * 1.5));
}

playButton.addEventListener('click', () => {
  motion.playing = !motion.playing;
  playButton.textContent = motion.playing ? 'Mettre en pause' : 'Reprendre';
  playButton.setAttribute('aria-pressed', String(!motion.playing));
  status.textContent = motion.playing ? 'Idle · animé' : 'Idle · en pause';
});

/** Réagit uniquement aux pixels visibles du personnage, pas au fond du Canvas. */
function hitTest(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * CANVAS.width / bounds.width;
  const y = (event.clientY - bounds.top) * CANVAS.height / bounds.height;
  if (x < 16 || x > 169 || y < 27 || y > 201) return false;

  const pixel = context.getImageData(Math.floor(x * 3), Math.floor(y * 3), 1, 1).data;
  return pixel[3] > 65;
}

function triggerHit() {
  if (!motion.playing || motion.reducedMotion) return;
  if (hitController.trigger(motion.elapsed)) {
    status.textContent = 'Hit · surpris';
  }
}

canvas.addEventListener('click', (event) => {
  if (hitTest(event)) triggerHit();
});
canvas.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  triggerHit();
});

blinkButton.addEventListener('click', () => {
  if (motion.playing && !motion.reducedMotion) {
    blinkController.blinkNow(motion.elapsed);
  }
});

layersButton.addEventListener('click', () => {
  motion.targetExploded = motion.targetExploded ? 0 : 1;
  layersButton.textContent = motion.targetExploded ? 'Réassembler' : 'Voir les calques';
  layersButton.setAttribute('aria-pressed', String(Boolean(motion.targetExploded)));
});

intensityInput.addEventListener('input', () => {
  motion.intensity = Number(intensityInput.value) / 100;
  intensityValue.textContent = `${intensityInput.value} %`;
});

stage.addEventListener('pointermove', handlePointer);
stage.addEventListener('pointerleave', () => {
  motion.targetPointerX = 0;
  motion.targetPointerY = 0;
});

Promise.all(imageNames.map(loadImage))
  .then((images) => {
    for (const [name, image] of images) assets.set(name, image);
    canvas.width = CANVAS.width * 3;
    canvas.height = CANVAS.height * 3;
    context.setTransform(3, 0, 0, 3, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    status.textContent = motion.reducedMotion ? 'Idle · animations réduites' : 'Idle · animé';
    requestAnimationFrame(frame);
  })
  .catch((error) => {
    status.textContent = 'Erreur de chargement';
    document.querySelector('#error-message').textContent = error.message;
  });
