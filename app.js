/** The UI only handles input and rendering; physics lives in ParticleWorld. */
const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d', { alpha: true });
const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
const controller = new BehaviorController(world);
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
const cohesionControl = document.querySelector('#cohesion');
const cohesionValue = document.querySelector('#cohesion-value');
const organicControl = document.querySelector('#organic-motion');
const organicValue = document.querySelector('#organic-motion-value');
const linkCount = document.querySelector('#link-count');
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const anatomyPreview = document.querySelector('#anatomy-preview');
const anatomyLegend = document.querySelector('#anatomy-legend');
const frameOptions = { showAnatomy: false };
const stateControl = document.querySelector('#behavior-state');
const energyControl = document.querySelector('#behavior-energy');
const energyValue = document.querySelector('#behavior-energy-value');
const voiceControl = document.querySelector('#voice-level');
const voiceValue = document.querySelector('#voice-level-value');
const roleTargetControl = document.querySelector('#role-target');

canvas.width = world.size;
canvas.height = world.size;
context.imageSmoothingEnabled = false;
count.textContent = world.particles.length.toLocaleString('fr-FR');
linkCount.textContent = world.cohesionField.linkCount.toLocaleString('fr-FR');
document.querySelector('#anatomy-count').textContent = world.anatomy.names.length;
for (const role of ROLE_NAMES) {
  if (!Object.values(world.getRoleAssignments()).some(assigned => assigned.includes(role))) continue;
  const option = document.createElement('option');
  option.value = role;
  option.textContent = role;
  roleTargetControl.append(option);
}


const roleLegendLabels = new Map();
for (let index = 0; index < world.anatomy.names.length; index += 1) {
  const name = world.anatomy.names[index];
  const sample = world.anatomy.profiles[index].debug;
  const item = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.style.backgroundColor = `rgb(${sample.join(',')})`;
  swatch.setAttribute('aria-hidden', 'true');
  const roleLabel = document.createElement('span');
  roleLabel.textContent = `${name} (${world.anatomy.counts[index].toLocaleString('fr-FR')}) · ${world.roles.getRoles(name).join(', ')}`;
  item.append(swatch, roleLabel);
  roleLegendLabels.set(name, roleLabel);
  anatomyLegend.append(item);
}
function refreshRoleLegend() {
  for (let index = 0; index < world.anatomy.names.length; index += 1) {
    const name = world.anatomy.names[index];
    roleLegendLabels.get(name).textContent =
      `${name} (${world.anatomy.counts[index].toLocaleString('fr-FR')}) · ${world.roles.getRoles(name).join(', ')}`;
  }
}

anatomyPreview.addEventListener('change', () => {
  frameOptions.showAnatomy = anatomyPreview.checked;
  anatomyLegend.hidden = !anatomyPreview.checked;
});

const FIXED_STEP = 1 / 60;
let lastTimestamp = null;
let accumulator = 0;
let frameCounter = 0;
let fpsStart = 0;
let simulationTimeTotal = 0;
let renderingTimeTotal = 0;

const BEHAVIOR_LABELS = Object.freeze({
  idle: 'Idle · matière vivante',
  listening: 'Listening · à l’écoute',
  thinking: 'Thinking · activité interne',
  speaking: 'Speaking · pulsation vocale',
});

function updateStatus() {
  status.textContent = world.paused ? 'En pause' :
    world.mode === 'reveal' ? 'Révélation · couleurs en mouvement' :
    world.mode === 'explode' ? 'Explosion · retour élastique' :
    BEHAVIOR_LABELS[controller.state];
}

function syncBehaviorControls() {
  const snapshot = controller.getSnapshot();
  stateControl.value = snapshot.state;
  energyControl.value = Math.round(snapshot.energy * 100);
  energyValue.textContent = `${energyControl.value} %`;
  voiceControl.value = Math.round(snapshot.voiceLevel * 100);
  voiceValue.textContent = `${voiceControl.value} %`;
  voiceControl.disabled = snapshot.state !== 'speaking';
  refreshRoleLegend();
  updateStatus();
}

function render() {
  world.writePixels(frame.data, frameOptions);
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
      controller.advance(FIXED_STEP);
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
  controller.trigger('hit');
  updateStatus();
}

function triggerReveal() {
  controller.trigger('reveal');
  updateStatus();
}

document.querySelector('#explode-trigger').addEventListener('click', triggerExplosion);
document.querySelector('#reveal-trigger').addEventListener('click', triggerReveal);
document.querySelector('#reset-trigger').addEventListener('click', () => {
  controller.reset();
  syncBehaviorControls();
});

stateControl.addEventListener('change', () => {
  controller.setState(stateControl.value);
  syncBehaviorControls();
});

energyControl.addEventListener('input', () => {
  controller.setEnergy(Number(energyControl.value) / 100);
  energyValue.textContent = `${energyControl.value} %`;
});

voiceControl.addEventListener('input', () => {
  controller.setVoiceLevel(Number(voiceControl.value) / 100);
  voiceValue.textContent = `${voiceControl.value} %`;
});

document.querySelector('#attract-trigger').addEventListener('click', () => {
  controller.trigger('field', { x: world.size / 2, y: world.size / 2, radius: 145,
    strength: -100, ...(roleTargetControl.value ? { role: roleTargetControl.value } : {}) });
});

document.querySelector('#repel-trigger').addEventListener('click', () => {
  controller.trigger('field', { x: world.size / 2, y: world.size / 2, radius: 145,
    strength: 100, ...(roleTargetControl.value ? { role: roleTargetControl.value } : {}) });
});

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
  if (world.hitTest(x, y)) controller.trigger('hit', { x, y });
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

cohesionControl.addEventListener('input', () => {
  world.setCohesion(Number(cohesionControl.value));
  cohesionValue.textContent = cohesionControl.value;
});

organicControl.addEventListener('input', () => {
  world.setOrganicMotion(Number(organicControl.value) / 100);
  organicValue.textContent = `${organicControl.value} %`;
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

// Only validated commands are public: an eventual LLM adapter will not access
// raw simulation arrays or inject executable code.
window.persona = Object.freeze({
  dispatch(command) {
    const accepted = controller.dispatch(command);
    syncBehaviorControls();
    return accepted;
  },
  getSnapshot() { return controller.getSnapshot(); },
  getRoleAssignments() { return world.getRoleAssignments(); },
});

syncBehaviorControls();
render();
if (!world.paused) controller.trigger('reveal');
requestAnimationFrame(animate);
