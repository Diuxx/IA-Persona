'use strict';

(() => {
  const data = window.reconstructionData;
  const status = document.getElementById('status');
  if (!data) {
    status.textContent = 'Données absentes : exécuter research/estimate.py et ouvrir output/estimation/<clip>/index.html.';
    return;
  }
  const methods = ['linear', 'cubic', 'field', 'guided_linear', 'guided_flow'];
  document.getElementById('clip-name').textContent = 'Clip : '+data.name+' — poses rasterisées, hors moteur.';
  const stride = document.getElementById('stride');
  const frame = document.getElementById('frame');
  const play = document.getElementById('play');
  const labels = {linear: 'Linéaire', cubic: 'Cubique', field: 'Champ', guided_linear: 'Appariement guidé', guided_flow: 'Flux bidirectionnel'};
  const palette = [220, 25, 125, 255];
  const surfaces = {};
  for (const name of ['reference', ...methods]) {
    const canvas = document.getElementById(name);
    canvas.width = data.width;
    canvas.height = data.height;
    const context = canvas.getContext('2d');
    surfaces[name] = {context, image: context.createImageData(data.width, data.height)};
  }
  frame.max = data.reference.length;

  function draw(name, encoded) {
    const {context, image} = surfaces[name];
    const pixels = atob(encoded);
    for (let i = 0; i < pixels.length; i++) {
      const shade = pixels.charCodeAt(i);
      const value = palette[shade];
      const j = i*4;
      image.data[j] = image.data[j+1] = image.data[j+2] = value;
      image.data[j+3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  const percent = value => (value*100).toFixed(1) + ' %';
  function render() {
    const experiment = data.experiments[stride.value];
    const number = Number(frame.value);
    const index = number-1;
    const known = experiment.scores.known.includes(number);
    status.textContent = number + '/' + data.reference.length + (known ? ' — connue' : ' — reconstruite');
    draw('reference', data.reference[index]);
    for (const name of methods) {
      draw(name, experiment.predicted[name][index]);
      const score = experiment.scores.methods[name].frames[String(number)];
      document.getElementById(name+'-score').textContent = known ? 'Pose fournie'
        : 'IoU : '+percent(score.silhouetteIoU)+' · œil : '+percent(score.eyeIoU)
          +' · écart population : '+score.populationError;
    }
    document.getElementById('summary').textContent =
      'IoU moyen, '+experiment.scores.hidden.length+' poses masquées : '
      + methods.map(name => labels[name]+' '+percent(experiment.scores.methods[name].mean.silhouetteIoU)).join(' / ');
  }

  let start = null;
  let animation = null;
  function tick(now) {
    if (start === null) start = now - (Number(frame.value)-1)*data.frameDurationMs;
    const next = 1 + Math.floor((now-start)/data.frameDurationMs)%data.reference.length;
    if (next !== Number(frame.value)) {
      frame.value = next;
      render();
    }
    animation = requestAnimationFrame(tick);
  }
  function pause() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    start = null;
    play.textContent = 'Lire';
  }
  play.addEventListener('click', () => {
    if (animation !== null) return pause();
    play.textContent = 'Pause';
    animation = requestAnimationFrame(tick);
  });
  frame.addEventListener('input', () => { pause(); render(); });
  stride.addEventListener('change', () => { pause(); render(); });
  render();
})();
