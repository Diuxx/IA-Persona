/** The UI only handles input and rendering; physics lives in ParticleWorld. */
const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d', { alpha: true });
const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
let targetPlayer;
let controller;
async function initializePersona() {
  targetPlayer = await TargetAnimationPlayer.create(world, PERSONA_IDLE_TARGETS);
  const roleMotionPlayer = new RoleMotionPlayer(world);
  controller = new BehaviorController(world, { animationPlayer: targetPlayer, roleMotionPlayer });
const frame = context.createImageData(world.size, world.size);
const pixelStabilizer = new PixelStabilizer(frame.data.length, world.size);
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
const animationStatus = document.querySelector('#animation-status');
const roleMotionControl = document.querySelector('#role-motion');
const roleMotionPlay = document.querySelector('#role-motion-play');
const roleMotionStop = document.querySelector('#role-motion-stop');
const roleMotionStatus = document.querySelector('#role-motion-status');
const controlViewport = document.querySelector('#controls-viewport');
const tabButtons = [...document.querySelectorAll('[data-panel-target]')];
const playIdleButton = document.querySelector('#play-idle');
const stopIdleButton = document.querySelector('#stop-idle');
const idleFrameControl = document.querySelector('#idle-frame');
const idleSpeedControl = document.querySelector('#idle-speed');
const idleSpeedValue = document.querySelector('#idle-speed-value');
const particleDensityControl = document.querySelector('#particle-density');
const idleFrameValue = document.querySelector('#idle-frame-value');
const idleLoopEndControl = document.querySelector('#idle-loop-end');
const idleLoopEndValue = document.querySelector('#idle-loop-end-value');
const idleLoopDuration = document.querySelector('#idle-loop-duration');
const idleFreezeButton = document.querySelector('#idle-freeze');
const idleResumeButton = document.querySelector('#idle-resume');
// The inspector follows the loaded asset, not a hardcoded frame count.
const idleFrameCount = targetPlayer.frames.length;
idleFrameControl.max = String(idleFrameCount);
idleLoopEndControl.max = String(idleFrameCount);

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
  frameDirty = true;
});

const FIXED_STEP = 1 / 60;
let lastTimestamp = null;
let accumulator = 0;
let frameCounter = 0;
let fpsStart = 0;
let simulationTimeTotal = 0;
let renderingTimeTotal = 0;
// A paused or inspected pose needs no new pixel buffer until a control changes it.
let frameDirty = true;

const BEHAVIOR_LABELS = Object.freeze({
  idle: 'Idle · matière vivante',
  listening: 'Listening · à l’écoute',
  thinking: 'Thinking · activité interne',
  speaking: 'Speaking · pulsation vocale',
});

function updateStatus() {
  status.textContent = targetPlayer.inspecting ? 'Idle · frame figée pour contrôle' :
    world.paused ? 'En pause' :
    world.mode === 'reveal' ? 'Révélation · couleurs en mouvement' :
    world.mode === 'explode' ? 'Explosion · retour élastique' :
    targetPlayer.playing ? 'Idle · animation reconstruite par les pixels' :
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
  syncAnimationControls();
  count.textContent = world.particles.length.toLocaleString('fr-FR');
  linkCount.textContent = world.cohesionField.linkCount.toLocaleString('fr-FR');
  updateRoleMotionStatus();
  updateStatus();
}

function syncAnimationControls() {
  const animation = targetPlayer.getSnapshot();
  idleFrameControl.value = String(animation.frame + 1);
  idleSpeedControl.value = String(animation.speed);
  idleSpeedValue.textContent = `${animation.speed.toFixed(2).replace(/\.?0+$/, '')}×`;
  idleFrameValue.textContent = `${animation.frame + 1} / ${animation.frameCount}`;
  idleLoopEndControl.value = String(animation.loopEndFrame + 1);
  idleLoopEndValue.textContent = `${animation.loopEndFrame + 1} / ${animation.frameCount}`;
  idleLoopDuration.textContent = `Boucle de ${(animation.playbackDurationMs / 1000).toFixed(2).replace('.', ',')} s · ${(animation.frameDurationMs / animation.speed).toFixed(1).replace('.', ',')} ms/frame`;
  animationStatus.textContent = animation.inspecting
    ? `Frame ${animation.frame + 1} figée · prête pour inspection`
    : animation.playing
      ? `Lecture : frame ${animation.frame + 1}/${animation.loopEndFrame + 1}`
      : 'Animation arrêtée · physique libre';
  stopIdleButton.disabled = !animation.playing;
  idleFreezeButton.disabled = !animation.playing || animation.inspecting;
  idleResumeButton.disabled = !animation.inspecting;
}

function inspectFrame(index) {
  controller.dispatch({ type: 'animation', action: 'seek', frame: index });
  accumulator = 0;
  lastTimestamp = null;
  syncBehaviorControls();
  pixelStabilizer.reset();
  render();
}

function activatePanel(target, focus = false) {
  for (const tab of tabButtons) {
    const active = tab.dataset.panelTarget === target;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.dataset.panelTarget).hidden = !active;
    if (active && focus) tab.focus();
  }
  controlViewport.scrollTop = 0;
}

for (const [index, tab] of tabButtons.entries()) {
  tab.addEventListener('click', () => activatePanel(tab.dataset.panelTarget));
  tab.addEventListener('keydown', event => {
    const offsets = { ArrowRight: 1, ArrowLeft: -1 };
    const offset = offsets[event.key];
    if (offset === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 :
      (index + offset + tabButtons.length) % tabButtons.length;
    activatePanel(tabButtons[next].dataset.panelTarget, true);
  });
}

function updateRoleMotionStatus() {
  const motion = controller.getSnapshot().roleMotion;
  roleMotionStop.disabled = !motion.playing;
  roleMotionStatus.textContent = motion.playing
    ? `${motion.name} · ${motion.role ?? 'toutes les particules'} · ${Math.round(motion.progress * 100)} %`
    : 'Aucun mouvement de rôle en cours.';
}

function render(elapsedSeconds = FIXED_STEP) {
  world.writePixels(frame.data, frameOptions);
  pixelStabilizer.apply(frame.data, elapsedSeconds,
    targetPlayer.playing && !targetPlayer.inspecting && !world.paused &&
    world.mode === 'idle' && !frameOptions.showAnatomy);
  context.putImageData(frame, 0, 0);
  frameDirty = false;
}

function animate(timestamp) {
  // Browser visibility must not consume CPU on a hidden tab or replay elapsed time.
  if (document.hidden) {
    lastTimestamp = null;
    accumulator = 0;
    requestAnimationFrame(animate);
    return;
  }

  const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  const simulationStart = performance.now();
  let iterations = 0;
  if (world.paused || targetPlayer.inspecting) {
    accumulator = 0;
  } else {
    accumulator += dt;
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
  if (iterations > 0 || frameDirty) render(dt || FIXED_STEP);
  const renderEnd = performance.now();
  simulationTimeTotal += renderStart - simulationStart;
  renderingTimeTotal += renderEnd - renderStart;
  updateStatus();
  syncAnimationControls();
  updateRoleMotionStatus();

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
  controller.dispatch({ type: 'animation', name: 'idle' });
  frameDirty = true;
  pixelStabilizer.reset();
  syncBehaviorControls();
});

playIdleButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', name: 'idle' });
  frameDirty = true;
  syncBehaviorControls();
});
stopIdleButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'stop' });
  frameDirty = true;
  syncBehaviorControls();
});

idleFrameControl.addEventListener('input', () => inspectFrame(Number(idleFrameControl.value) - 1));
document.querySelector('#idle-prev').addEventListener('click', () => {
  inspectFrame(Math.max(0, targetPlayer.frame - 1));
});
document.querySelector('#idle-next').addEventListener('click', () => {
  inspectFrame(Math.min(targetPlayer.frames.length - 1, targetPlayer.frame + 1));
});
idleFreezeButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'pause' });
  accumulator = 0;
  lastTimestamp = null;
  syncBehaviorControls();
});
idleResumeButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'resume' });
  accumulator = 0;
  lastTimestamp = null;
  syncBehaviorControls();
});
idleSpeedControl.addEventListener('input', () => {
  controller.dispatch({ type: 'animation', action: 'speed', value: Number(idleSpeedControl.value) });
  syncAnimationControls();
});
particleDensityControl.addEventListener('change', () => {
  controller.dispatch({ type: 'animation', action: 'particle-count', count: Number(particleDensityControl.value) });
  pixelStabilizer.reset();
  frameDirty = true;
  syncBehaviorControls();
  if (targetPlayer.inspecting || world.paused) render();
});
idleLoopEndControl.addEventListener('input', () => {
  controller.dispatch({ type: 'animation', action: 'loop-end', frame: Number(idleLoopEndControl.value) - 1 });
  frameDirty = true;
  syncAnimationControls();
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

roleMotionPlay.addEventListener('click', () => {
  controller.dispatch({ type: 'role-motion', name: roleMotionControl.value,
    role: roleTargetControl.value || null });
  updateRoleMotionStatus();
});
roleMotionStop.addEventListener('click', () => {
  controller.dispatch({ type: 'role-motion', action: 'stop' });
  updateRoleMotionStatus();
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

accentControl.addEventListener('input', () => {
  world.setAccent(accentControl.value);
  frameDirty = true;
});

document.addEventListener('visibilitychange', () => {
  // La prochaine frame repart sans rattraper la durée passée en arrière-plan.
  accumulator = 0;
  lastTimestamp = null;
  if (!document.hidden) frameDirty = true;
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
    if (accepted) {
      frameDirty = true;
      pixelStabilizer.reset();
      particleDensityControl.value = String(world.particles.length);
    }
    syncBehaviorControls();
    return accepted;
  },
  getSnapshot() { return controller.getSnapshot(); },
  getRoleAssignments() { return world.getRoleAssignments(); },
});

if (!world.paused) {
  controller.dispatch({ type: 'animation', name: 'idle' });
  // The first visible image must be the actual reference pose, not the
  // previous static drawing while its particles are still converging.
  world.snapToTargetPose();
}
syncBehaviorControls();
render();
requestAnimationFrame(animate);

}
initializePersona().catch(error => {
  document.querySelector('#status').textContent = 'Échec du chargement de l’animation';
  console.error('IA-Persona initialization failed:', error);
});
