/** The UI only handles input and rendering; physics lives in ParticleWorld. */
const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d', { alpha: true });
const world = new ParticleWorld(PERSONA_PIXEL_MAP);
const frame = context.createImageData(world.size, world.size);
const status = document.querySelector('#status');
const count = document.querySelector('#particle-count');
const fps = document.querySelector('#fps');
const simulationMs = document.querySelector('#simulation-ms');
const renderingMs = document.querySelector('#rendering-ms');
const collisions = document.querySelector('#collision-count');
const pauseButton = document.querySelector('#pause-button');
const elasticityControl = document.querySelector('#elasticity');
const elasticityValue = document.querySelector('#elasticity-value');
const dispersionControl = document.querySelector('#dispersion');
const dispersionValue = document.querySelector('#dispersion-value');
const accentControl = document.querySelector('#accent');
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

canvas.width = world.size;
canvas.height = world.size;
context.imageSmoothingEnabled = false;
count.textContent = world.particles.length.toLocaleString('fr-FR');

const FIXED_STEP = 1 / 60;
let lastTimestamp = null;
let accumulator = 0;
let frameCounter = 0;
let fpsStart = 0;
let simulationTimeTotal = 0;
let renderingTimeTotal = 0;

function updateStatus() {
  status.textContent = world.paused ? 'En pause' :
    world.mode === 'reveal' ? 'Révélation · couleurs en mouvement' :
    world.mode === 'explode' ? 'Explosion · retour élastique' :
    'Idle · matière vivante';
}

function render() {
  world.writePixels(frame.data);
  context.putImageData(frame, 0, 0);
}

function animate(timestamp) {
  const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  const simulationStart = performance.now();
  if (world.paused) {
    accumulator = 0;
  } else {
    accumulator += dt;
    let iterations = 0;
    while (accumulator >= FIXED_STEP && iterations < 3) {
      world.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      iterations++;
    }
    // Ne pas accumuler une dette infinie après une longue suspension de l'onglet.
    if (iterations === 3) accumulator = 0;
  }
  const renderStart = performance.now();
  render();
  const renderEnd = performance.now();
  simulationTimeTotal += renderStart - simulationStart;
  renderingTimeTotal += renderEnd - renderStart;
  updateStatus();

  frameCounter++;
  if (!fpsStart) fpsStart = timestamp;
  if (timestamp - fpsStart >= 1000) {
    const samples = frameCounter;
    fps.textContent = String(Math.round(samples * 1000 / (timestamp - fpsStart)));
    simulationMs.textContent = (simulationTimeTotal / samples).toFixed(2);
    renderingMs.textContent = (renderingTimeTotal / samples).toFixed(2);
    collisions.textContent = world.lastCollisionCount.toLocaleString('fr-FR');
    simulationTimeTotal = 0;
    renderingTimeTotal = 0;
    frameCounter = 0;
    fpsStart = timestamp;
  }
  requestAnimationFrame(animate);
}

function triggerExplosion() {
  world.explode();
  updateStatus();
}

function triggerReveal() {
  world.reveal();
  updateStatus();
}

document.querySelector('#explode-trigger').addEventListener('click', triggerExplosion);
document.querySelector('#reveal-trigger').addEventListener('click', triggerReveal);
document.querySelector('#reset-trigger').addEventListener('click', () => world.reset());

pauseButton.addEventListener('click', () => {
  world.paused = !world.paused;
  pauseButton.textContent = world.paused ? 'Reprendre' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(world.paused));
  accumulator = 0;
  lastTimestamp = null;
  updateStatus();
});

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  if (world.hitTest(x, y)) world.explode(x, y);
});

canvas.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  triggerExplosion();
});

elasticityControl.addEventListener('input', () => {
  world.setElasticity(Number(elasticityControl.value));
  elasticityValue.textContent = elasticityControl.value;
});

dispersionControl.addEventListener('input', () => {
  world.setDispersion(Number(dispersionControl.value) / 100);
  dispersionValue.textContent = `${dispersionControl.value} %`;
});

accentControl.addEventListener('input', () => world.setAccent(accentControl.value));

document.addEventListener('visibilitychange', () => {
  // La prochaine frame repart sans rattraper la durée passée en arrière-plan.
  accumulator = 0;
  lastTimestamp = null;
});

if (motionQuery.matches) {
  // Avoid a surprise animation when the OS requests reduced motion.
  world.paused = true;
  pauseButton.textContent = 'Reprendre';
}

updateStatus();
render();
if (!world.paused) world.reveal();
requestAnimationFrame(animate);
