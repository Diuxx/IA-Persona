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
const imageNames = [
  'leg-left', 'leg-right', 'body', 'puff-left', 'puff-top', 'puff-right',
  'mouth', 'droplet-left', 'droplet-right',
  'spark-1', 'spark-2', 'spark-3', 'spark-4',
];

const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d');
const playButton = document.querySelector('#play-toggle');
const layersButton = document.querySelector('#layers-toggle');
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
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const assets = new Map();

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
  context.translate(91 + motion.pointerX, 106 + bob + motion.pointerY);
  context.rotate(sway);
  context.scale(1 + breathe + microTwitch, 1 - breathe * 0.75 - microTwitch);
  context.translate(-91, -106);

  // Les pattes passent sous le corps, qui dissimule leurs points d'attache.
  drawImageLayer('leg-left', {
    x: 68, y: 164, dx: -15 * split,
    dy: 20 * split + sine(s, 4.8, 1) * 0.7 * power,
    rotation: sine(s, 4.7, 0.4) * 0.018 * power,
  });
  drawImageLayer('leg-right', {
    x: 125, y: 164, dx: 15 * split,
    dy: 20 * split + sine(s, 5.1, 2.2) * 0.7 * power,
    rotation: sine(s, 4.8, 1.7) * -0.018 * power,
  });

  drawImageLayer('body', { x: 96, y: 110 });
  drawImageLayer('puff-left', {
    x: 51, y: 89, dx: -23 * split + sine(s, 3.55, 1.1) * 0.52 * power,
    dy: -3 * split + sine(s, 3.8, 1.5) * 0.40 * power,
    sx: 1 + sine(s, 3.15, -0.6) * 0.006 * power,
  });
  drawImageLayer('puff-top', {
    x: 98, y: 61, dy: -22 * split + sine(s, 3.15, 0.5) * 0.68 * power,
    sx: 1 + sine(s, 3.1, 0.7) * 0.008 * power,
    sy: 1 + sine(s, 3.2, -0.5) * 0.009 * power,
  });
  drawImageLayer('puff-right', {
    x: 132, y: 86, dx: 24 * split + sine(s, 4.0, 2.5) * 0.55 * power,
    dy: -2 * split + sine(s, 3.5, 0.7) * 0.34 * power,
  });
  drawImageLayer('mouth', {
    x: 102, y: 136, dy: 15 * split + sine(s, 4.8, 1.2) * 0.45 * power,
    sx: 1 + sine(s, 5.9) * 0.005 * power,
  });

  // Les gouttelettes flottent à une fréquence différente de celle du corps.
  drawImageLayer('droplet-left', {
    x: 34, y: 38, dx: -10 * split + sine(s, 4.6, 0.3) * 1.9 * power,
    dy: -13 * split + sine(s, 3.35, 0.8) * 1.65 * power,
    rotation: sine(s, 5.8, 2) * 0.065 * power,
  });
  drawImageLayer('droplet-right', {
    x: 146, y: 38, dx: 11 * split + sine(s, 5.1, 1.5) * 1.6 * power,
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
      dx: (x < 90 ? -17 : 17) * split + sine(s, 6.1, phase) * 2.3 * power,
      dy: -18 * split + sine(s, 4.5, phase) * 2.1 * power,
    });
  }
  context.restore();
}

function frame(timestamp) {
  const seconds = timestamp / 1000;
  const delta = motion.lastFrame === 0 ? 0 : Math.min(seconds - motion.lastFrame, 0.05);
  motion.lastFrame = seconds;
  if (motion.playing && !motion.reducedMotion) motion.elapsed += delta;
  const smoothing = 1 - Math.exp(-delta * 8);
  motion.exploded = lerp(motion.exploded, motion.targetExploded, smoothing);
  drawCharacter(motion.elapsed);
  requestAnimationFrame(frame);
}

function handlePointer(event) {
  if (!motion.playing || motion.reducedMotion) return;
  const rect = stage.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  // La légère orientation vers le pointeur reste facultative et discrète.
  motion.pointerX = Math.max(-2, Math.min(2, x * 3.5));
  motion.pointerY = Math.max(-1, Math.min(1, y * 1.5));
}

playButton.addEventListener('click', () => {
  motion.playing = !motion.playing;
  playButton.textContent = motion.playing ? 'Mettre en pause' : 'Reprendre';
  playButton.setAttribute('aria-pressed', String(!motion.playing));
  status.textContent = motion.playing ? 'Idle · animé' : 'Idle · en pause';
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
  motion.pointerX = 0;
  motion.pointerY = 0;
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
