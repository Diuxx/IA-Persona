/** The UI only handles input and rendering; physics lives in ParticleWorld. */
const canvas = document.querySelector('#mascot');
const context = canvas.getContext('2d', { alpha: true });
const world = new ParticleWorld(PERSONA_PIXEL_MAP, { anatomy: PERSONA_ANATOMY });
let controller;
// The clip currently selected by the controller (idle, left or right) drives the inspector.
const activeClip = () => controller.animationPlayer;
async function initializePersona() {
  const [idlePlayer, leftPlayer, rightPlayer] = await TargetAnimationPlayer.createClips(
    world, [PERSONA_IDLE_TARGETS, PERSONA_LEFT_TARGETS, PERSONA_RIGHT_TARGETS]);
  controller = new BehaviorController(world, { animationPlayer: idlePlayer, animationPlayers: [leftPlayer, rightPlayer] });
const frame = context.createImageData(world.size, world.size);
const pixelStabilizer = new PixelStabilizer(frame.data.length, world.size);
const status = document.querySelector('#status');
const metrics = new PersonaMetrics(document);
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
const animationStatus = document.querySelector('#animation-status');
const playIdleButton = document.querySelector('#play-idle');
const stopIdleButton = document.querySelector('#stop-idle');
const idleFrameControl = document.querySelector('#idle-frame');
const idleSpeedControl = document.querySelector('#idle-speed');
const idleSpeedValue = document.querySelector('#idle-speed-value');
const particleDensityControl = document.querySelector('#particle-density');
const antiFlickerControl = document.querySelector('#anti-flicker');
const trackingControl = document.querySelector('#animation-tracking');
const idleFrameValue = document.querySelector('#idle-frame-value');
const idleLoopEndControl = document.querySelector('#idle-loop-end');
const idleLoopEndValue = document.querySelector('#idle-loop-end-value');
const idleLoopDuration = document.querySelector('#idle-loop-duration');
const idleFreezeButton = document.querySelector('#idle-freeze');
const idleResumeButton = document.querySelector('#idle-resume');
const playLeftButton = document.querySelector('#play-left');

canvas.width = world.size;
canvas.height = world.size;
context.imageSmoothingEnabled = false;
metrics.updateParticleCount(world.visibleParticleCount);
linkCount.textContent = world.cohesionField.linkCount.toLocaleString('fr-FR');
document.querySelector('#anatomy-count').textContent = world.anatomy.names.length;

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
// A paused or inspected pose needs no new pixel buffer until a control changes it.
let frameDirty = true;

const BEHAVIOR_LABELS = Object.freeze({
  idle: 'Idle · matière vivante',
  listening: 'Listening · à l’écoute',
  thinking: 'Thinking · activité interne',
  speaking: 'Speaking · pulsation vocale',
});

const CLIP_LABELS = Object.freeze({
  idle: 'Idle',
  left: 'Left',
  right: 'Right',
});

function updateStatus() {
  const clip = CLIP_LABELS[activeClip().animation.name] ?? activeClip().animation.name;
  status.textContent = activeClip().inspecting ? `${clip} · frame figée pour contrôle` :
    world.paused ? 'En pause' :
    world.mode === 'reveal' ? 'Révélation · couleurs en mouvement' :
    world.mode === 'explode' ? 'Explosion · retour élastique' :
    activeClip().held ? `${clip} · pose finale maintenue` :
    activeClip().playing ? `${clip} · animation reconstruite par les pixels` :
    BEHAVIOR_LABELS[controller.state];
}

function syncApplicationControls() {
  refreshRoleLegend();
  trackingControl.value = world.animationTracking;
  syncAnimationControls();
  linkCount.textContent = world.cohesionField.linkCount.toLocaleString('fr-FR');
  updateStatus();
}

function syncAnimationControls() {
  const animation = activeClip().getSnapshot();
  metrics.updateParticleCount(animation.visibleCount);
  particleDensityControl.value = animation.densityLimit === null ? 'auto' : String(animation.densityLimit);
  const oneShot = animation.kind === 'one-shot';
  // The inspector follows the active clip: 43 frames for idle, 36 for left/right.
  idleFrameControl.max = String(animation.frameCount);
  idleLoopEndControl.max = String(animation.frameCount);
  idleFrameControl.value = String(animation.frame + 1);
  idleSpeedControl.value = String(animation.speed);
  idleSpeedValue.textContent = `${animation.speed.toFixed(2).replace(/\.?0+$/, '')}×`;
  idleFrameValue.textContent = `${animation.frame + 1} / ${animation.frameCount}`;
  idleLoopEndControl.value = String(animation.loopEndFrame + 1);
  idleLoopEndValue.textContent = `${animation.loopEndFrame + 1} / ${animation.frameCount}`;
  idleLoopEndControl.disabled = oneShot;
  idleLoopDuration.textContent = oneShot
    ? `Lecture unique de ${(animation.playbackDurationMs / 1000).toFixed(2).replace('.', ',')} s, puis retour à l’idle`
    : `Boucle de ${(animation.playbackDurationMs / 1000).toFixed(2).replace('.', ',')} s · ${(animation.frameDurationMs / animation.speed).toFixed(1).replace('.', ',')} ms/frame`;
  animationStatus.textContent = animation.inspecting
    ? `Frame ${animation.frame + 1} figée · prête pour inspection`
    : animation.held
      ? `Pose finale ${animation.frame + 1}/${animation.frameCount} maintenue`
      : animation.playing
        ? `Lecture : frame ${animation.frame + 1}/${animation.frameCount}`
        : 'Animation arrêtée · physique libre';
  stopIdleButton.disabled = !animation.playing && !animation.held;
  idleFreezeButton.disabled = !animation.playing || animation.inspecting;
  idleResumeButton.disabled = !animation.inspecting;
}

function inspectFrame(index) {
  controller.dispatch({ type: 'animation', action: 'seek', frame: index });
  accumulator = 0;
  lastTimestamp = null;
  syncApplicationControls();
  pixelStabilizer.reset();
  render();
}

initializePersonaTabs();

function render(elapsedSeconds = FIXED_STEP) {
  world.writePixels(frame.data, frameOptions);
  pixelStabilizer.apply(frame.data, elapsedSeconds,
    antiFlickerControl.checked && activeClip().playing && !activeClip().inspecting && !world.paused &&
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
  if (world.paused || activeClip().inspecting) {
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
  if (metrics.recordFrame(timestamp, renderStart - simulationStart,
    renderEnd - renderStart, world.lastCollisionCount)) {
    metrics.updateTracking(world.getTrackingDiagnostics());
  }
  updateStatus();
  syncAnimationControls();

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
  syncApplicationControls();
});

playIdleButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', name: 'idle' });
  frameDirty = true;
  syncApplicationControls();
});
playLeftButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', name: 'left' });
  frameDirty = true;
  syncApplicationControls();
});
document.querySelector('#play-right').addEventListener('click', () => {
  controller.dispatch({ type: 'animation', name: 'right' });
  frameDirty = true;
  syncApplicationControls();
});
stopIdleButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'stop' });
  frameDirty = true;
  syncApplicationControls();
});

idleFrameControl.addEventListener('input', () => inspectFrame(Number(idleFrameControl.value) - 1));
document.querySelector('#idle-prev').addEventListener('click', () => {
  inspectFrame(Math.max(0, activeClip().frame - 1));
});
document.querySelector('#idle-next').addEventListener('click', () => {
  inspectFrame(Math.min(activeClip().frames.length - 1, activeClip().frame + 1));
});
idleFreezeButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'pause' });
  accumulator = 0;
  lastTimestamp = null;
  syncApplicationControls();
});
idleResumeButton.addEventListener('click', () => {
  controller.dispatch({ type: 'animation', action: 'resume' });
  accumulator = 0;
  lastTimestamp = null;
  syncApplicationControls();
});
idleSpeedControl.addEventListener('input', () => {
  controller.dispatch({ type: 'animation', action: 'speed', value: Number(idleSpeedControl.value) });
  syncAnimationControls();
});
trackingControl.addEventListener('change', () => {
  window.persona.dispatch({ type: 'animation', action: 'tracking', value: trackingControl.value });
});
antiFlickerControl.addEventListener('change', () => {
  pixelStabilizer.reset();
  frameDirty = true;
  if (activeClip().inspecting || world.paused) render();
});

particleDensityControl.addEventListener('change', () => {
  controller.dispatch({ type: 'animation', action: 'particle-count', count: particleDensityControl.value === 'auto' ? 'auto' : Number(particleDensityControl.value) });
  pixelStabilizer.reset();
  frameDirty = true;
  syncApplicationControls();
  if (activeClip().inspecting || world.paused) render();
});
idleLoopEndControl.addEventListener('input', () => {
  controller.dispatch({ type: 'animation', action: 'loop-end', frame: Number(idleLoopEndControl.value) - 1 });
  frameDirty = true;
  syncAnimationControls();
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
      if (command.type === 'animation' && command.action === 'tracking') metrics.resetSampling();
      particleDensityControl.value = world.densityLimit === null ? 'auto' : String(world.densityLimit);
    }
    syncApplicationControls();
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
syncApplicationControls();
render();
requestAnimationFrame(animate);

}
initializePersona().catch(error => {
  document.querySelector('#status').textContent = 'Échec du chargement de l’animation';
  console.error('IA-Persona initialization failed:', error);
});
