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
  const poseContext = pose.getContext('2d');
  const eyeRegion = { x: 98, y: 149, width: 60, height: 24 };
  const eyePixels = poseContext.getImageData(eyeRegion.x, eyeRegion.y, eyeRegion.width, eyeRegion.height);
  const closedPixels = new ImageData(new Uint8ClampedArray(eyePixels.data), eyeRegion.width, eyeRegion.height);
  const whitePixels = new ImageData(new Uint8ClampedArray(eyePixels.data.length), eyeRegion.width, eyeRegion.height);

  for (let i = 0; i < eyePixels.data.length; i += 4) {
    const brightness = Math.max(eyePixels.data[i], eyePixels.data[i + 1], eyePixels.data[i + 2]);
    const bright = brightness >= 75 && eyePixels.data[i + 3] > 64;
    if (bright) {
      closedPixels.data[i] = 5;
      closedPixels.data[i + 1] = 5;
      closedPixels.data[i + 2] = 5;
      whitePixels.data[i] = eyePixels.data[i];
      whitePixels.data[i + 1] = eyePixels.data[i + 1];
      whitePixels.data[i + 2] = eyePixels.data[i + 2];
      whitePixels.data[i + 3] = eyePixels.data[i + 3];
    }
  }

  const whiteEye = createSpriteCanvas(eyeRegion.width, eyeRegion.height);
  whiteEye.getContext('2d').putImageData(whitePixels, 0, 0);
  const openness = [1, 0.86, 0.47, 0.06, 0, 0.24, 0.75, 1];
  for (let i = 0; i < openness.length; i += 1) {
    const x = i * frameWidth;
    blinkContext.drawImage(pose, x, 0);
    blinkContext.putImageData(closedPixels, x + eyeRegion.x, eyeRegion.y);
    if (openness[i] > 0) {
      const height = Math.max(1, Math.round(eyeRegion.height * openness[i]));
      const y = eyeRegion.y + Math.floor((eyeRegion.height - height) / 2);
      blinkContext.drawImage(whiteEye, x + eyeRegion.x, y, eyeRegion.width, height);
    }
  }

  return { idle, blink, hit };
}
