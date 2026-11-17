/** IA-Persona : un seul rendu Canvas pour trois animations image par image. */
const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d');
const playButton = document.querySelector('#play-toggle');
const blinkButton = document.querySelector('#blink-trigger');
const hitButton = document.querySelector('#hit-trigger');
const speedInput = document.querySelector('#speed');
const speedOutput = document.querySelector('#speed-value');
const status = document.querySelector('#status');
const errorMessage = document.querySelector('#error-message');

const player = new AnimationPlayer();
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const sprites = new Map();
let ready = false;
let lastTimestamp = null;
let lastStatus = '';

player.setReducedMotion(motionQuery.matches);
canvas.width = FRAME_SIZE.width * 3;
canvas.height = FRAME_SIZE.height * 3;
context.setTransform(3, 0, 0, 3, 0, 0);
context.imageSmoothingEnabled = true;
context.imageSmoothingQuality = 'high';

function loadSprite(name, clip) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.width !== FRAME_SIZE.width * clip.frames || image.height !== FRAME_SIZE.height) {
        reject(new Error(`Spritesheet incorrecte pour ${name} : ${image.width} × ${image.height}.`));
        return;
      }
      resolve([name, image]);
    };
    image.onerror = () => reject(new Error(`Impossible de charger ${clip.src}.`));
    image.src = clip.src;
  });
}

function renderFrame(name, frame, alpha = 1) {
  if (alpha <= 0) return;
  const sprite = sprites.get(name);
  if (!sprite) return;
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(sprite, frame * FRAME_SIZE.width, 0,
    FRAME_SIZE.width, FRAME_SIZE.height,
    0, 0, FRAME_SIZE.width, FRAME_SIZE.height);
  context.restore();
}

function render() {
  const current = player.getPresentation();
  context.clearRect(0, 0, FRAME_SIZE.width, FRAME_SIZE.height);
  const previousOpacity = current.previous?.alpha ?? 0;
  if (current.previous) renderFrame(current.previous.state, current.previous.frame, previousOpacity);
  renderFrame(current.state, current.frame, 1 - previousOpacity);
}

function updateControls() {
  playButton.disabled = !ready || player.reducedMotion;
  blinkButton.disabled = !ready || player.paused || player.reducedMotion || player.state !== 'idle';
  hitButton.disabled = !ready || player.paused || player.reducedMotion || player.state === 'hit';
  const nextStatus = !ready ? 'Chargement…'
    : player.reducedMotion ? 'Idle · animations réduites'
      : player.paused ? 'Animation en pause'
        : player.state === 'hit' ? 'Hit · explosion'
          : player.state === 'blink' ? 'Blink · clignement' : 'Idle · animé';
  if (lastStatus !== nextStatus) {
    status.textContent = nextStatus;
    lastStatus = nextStatus;
  }
}

function frame(timestamp) {
  const delta = lastTimestamp == null ? 0 : (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  player.advance(delta);
  render();
  updateControls();
  window.requestAnimationFrame(frame);
}

function triggerHit() {
  if (!ready) return;
  if (player.triggerHit()) {
    render();
    updateControls();
  }
}

/** Approximation de la silhouette, sans lecture des pixels du Canvas. */
function isInsideMascot(x, y) {
  const ellipse = (cx, cy, rx, ry) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  return ellipse(130, 145, 69, 78) ||
    ellipse(81, 84, 23, 25) ||
    ellipse(180, 84, 23, 25);
}

function handleCanvasClick(event) {
  if (!ready || player.paused || player.reducedMotion) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * canvas.width;
  const y = (event.clientY - rect.top) / rect.height * canvas.height;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  if (isInsideMascot(x * FRAME_SIZE.width / canvas.width,
    y * FRAME_SIZE.height / canvas.height)) triggerHit();
}

playButton.addEventListener('click', () => {
  player.paused = !player.paused;
  playButton.textContent = player.paused ? 'Reprendre' : 'Mettre en pause';
  playButton.setAttribute('aria-pressed', String(player.paused));
  updateControls();
});
blinkButton.addEventListener('click', () => {
  if (ready && player.triggerBlink()) updateControls();
});
hitButton.addEventListener('click', triggerHit);
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  triggerHit();
});
speedInput.addEventListener('input', () => {
  player.setSpeed(Number(speedInput.value));
  speedOutput.textContent = `${speedInput.value} %`;
});
if (typeof motionQuery.addEventListener === 'function') {
  motionQuery.addEventListener('change', (event) => {
    player.setReducedMotion(event.matches);
    render();
    updateControls();
  });
}

loadSprite('hit', ANIMATION_CLIPS.hit)
  .then(([, hitImage]) => {
    const atlases = buildAnimationAtlases(hitImage, FRAME_SIZE.width, FRAME_SIZE.height);
    for (const [name, image] of Object.entries(atlases)) sprites.set(name, image);
    ready = true;
    render();
    updateControls();
    window.requestAnimationFrame(frame);
  })
  .catch((error) => {
    errorMessage.textContent = error.message;
    status.textContent = 'Erreur de chargement';
  });
