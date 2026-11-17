/**
 * Prépare une seule fois les spritesheets complètes depuis le Hit de référence.
 * Le lecteur ne modifiera jamais les pièces du personnage pendant les animations.
 */
function createSpriteCanvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function buildAnimationAtlases(hit, frameWidth = 250, frameHeight = 251) {
  if (hit.width !== frameWidth * 8 || hit.height !== frameHeight) {
    throw new Error('La spritesheet Hit doit contenir 8 images de 250 × 251 pixels.');
  }
  const pose = createSpriteCanvas(frameWidth, frameHeight);
  pose.getContext('2d').drawImage(hit, 7 * frameWidth, 0, frameWidth, frameHeight,
    0, 0, frameWidth, frameHeight);

  const idle = createSpriteCanvas(frameWidth * 24, frameHeight);
  const idleContext = idle.getContext('2d');
  for (let i = 0; i < 24; i += 1) {
    const phase = i * Math.PI * 2 / 24;
    const breathe = Math.sin(phase);
    const bob = Math.sin(phase + 0.15) * 2.4;
    idleContext.save();
    idleContext.translate(i * frameWidth + frameWidth / 2, frameHeight / 2 + bob);
    idleContext.scale(1 + breathe * 0.009, 1 - breathe * 0.01);
    idleContext.drawImage(pose, -frameWidth / 2, -frameHeight / 2);
    idleContext.restore();
  }

  const blink = createSpriteCanvas(frameWidth * 8, frameHeight);
  const blinkContext = blink.getContext('2d');
  // Dupliquer uniquement le découpage de l’œil, sans lire les pixels du Canvas.
  // L'alpha de la forme originale est préservé via la composition source-atop.
  const eyeRegion = { x: 98, y: 149, width: 60, height: 24 };
  const darkEye = createSpriteCanvas(eyeRegion.width, eyeRegion.height);
  const darkEyeContext = darkEye.getContext('2d');
  darkEyeContext.drawImage(pose,
    eyeRegion.x, eyeRegion.y, eyeRegion.width, eyeRegion.height,
    0, 0, eyeRegion.width, eyeRegion.height);
  darkEyeContext.globalCompositeOperation = 'source-atop';
  darkEyeContext.fillStyle = '#050505';
  darkEyeContext.fillRect(0, 0, eyeRegion.width, eyeRegion.height);
  darkEyeContext.globalCompositeOperation = 'source-over';

  const openness = [1, 0.86, 0.47, 0.06, 0, 0.24, 0.75, 1];
  for (let i = 0; i < openness.length; i += 1) {
    const x = i * frameWidth;
    blinkContext.drawImage(pose, x, 0);
    if (openness[i] >= 1) continue;

    blinkContext.drawImage(darkEye, x + eyeRegion.x, eyeRegion.y);
    if (openness[i] === 0) continue;

    const height = Math.max(1, Math.round(eyeRegion.height * openness[i]));
    const y = eyeRegion.y + Math.floor((eyeRegion.height - height) / 2);
    blinkContext.drawImage(pose,
      eyeRegion.x, eyeRegion.y, eyeRegion.width, eyeRegion.height,
      x + eyeRegion.x, y, eyeRegion.width, height);
  }

  return { idle, blink, hit };
}
