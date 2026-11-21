'use strict';

(() => {
  const data = window.extrapolationData;
  const status = document.getElementById('status');
  if (!data) {
    status.textContent = 'Données absentes : lancer research/extrapolate.py puis ouvrir output/extrapolation/<clip>/index.html.';
    return;
  }
  const labels = {
    reference: 'Original', hold: 'Dernière pose figée', centroid: 'Translation globale',
    particle_velocity: 'Vitesse des points', transport_velocity: 'Vitesse par transport',
    damped_field: 'Champ local amorti', shape_trend: 'Évolution de forme',
  };
  const methods = Object.keys(data.methods);
  const origin = document.getElementById('origin');
  const step = document.getElementById('step');
  const play = document.getElementById('play');
  const reveal = document.getElementById('reveal');
  const surfaces = {};
  const palette = [220, 25, 125, 255];
  const percent = number => (number*100).toFixed(1)+' %';
  const distance = number => number === null ? '—' : number.toFixed(2)+' px';
  document.getElementById('clip').textContent = 'Clip : '+data.name+' · '+data.frameDurationMs+' ms/pose';
  step.min = 1-data.historyFrames;
  step.max = data.horizonFrames;
  data.windows.forEach((window, index) => origin.add(new Option('Frame '+window.origin, index)));

  for (const name of ['reference', ...methods]) {
    const panel = document.createElement('section');
    const title = document.createElement('h2');
    title.textContent = labels[name];
    const canvas = document.createElement('canvas');
    canvas.width = data.width;
    canvas.height = data.height;
    const score = document.createElement('p');
    panel.append(title, canvas, score);
    document.getElementById('views').append(panel);
    const context = canvas.getContext('2d');
    surfaces[name] = {context, image: context.createImageData(data.width, data.height), score};
  }

  function draw(name, encoded) {
    const {context, image} = surfaces[name];
    if (encoded === null) {
      context.clearRect(0, 0, data.width, data.height);
      return;
    }
    const packed = atob(encoded);
    for (let i = 0; i < data.width*data.height; i++) {
      const shade = (packed.charCodeAt(i >> 2) >> ((i & 3)*2)) & 3;
      const value = palette[shade];
      const j = i*4;
      image.data[j] = image.data[j+1] = image.data[j+2] = value;
      image.data[j+3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  function render() {
    const window = data.windows[Number(origin.value)];
    const relative = Number(step.value);
    const index = window.origin-1+relative;
    const future = relative > 0;
    status.textContent = 'Frame '+(index+1)+' · '+(future
      ? 'prévision +'+relative*data.frameDurationMs+' ms' : 'observation fournie');
    document.getElementById('context').textContent = 'Seules les frames '
      +(window.origin-data.historyFrames+1)+' à '+window.origin+' sont utilisées pour la prévision.';
    draw('reference', future && !reveal.checked ? null : data.reference[index]);
    surfaces.reference.score.textContent = future ? (reveal.checked ? 'Vérité réservée à l’évaluation' : 'Futur masqué') : 'Pose observée';
    for (const method of methods) {
      draw(method, future ? window.predicted[method][relative-1] : data.reference[index]);
      const score = future ? window.scores[method][relative-1] : null;
      surfaces[method].score.textContent = score
        ? 'IoU '+percent(score.silhouetteIoU)+' · œil '+percent(score.eyeIoU)
          +' · centre '+distance(score.centroidErrorPx)+' · population '+score.populationError
        : 'Pose fournie';
    }
  }

  function summary() {
    const table = document.getElementById('summary');
    const header = table.createTHead().insertRow();
    const horizons = [...new Set([1, 2, 4, data.horizonFrames])].filter(n => n <= data.horizonFrames);
    const titles = ['Méthode', ...horizons.map(n => '+'+n*data.frameDurationMs+' ms'), 'IoU moyen', 'Gain vs figé'];
    for (const title of titles) {
      const th = document.createElement('th');
      th.scope = 'col'; th.textContent = title; header.append(th);
    }
    const body = table.createTBody();
    for (const method of methods) {
      const row = body.insertRow();
      const name = document.createElement('th');
      name.scope = 'row'; name.textContent = labels[method]; row.append(name);
      const result = data.methods[method];
      const gain = result.mean.iouGainVsHold*100;
      for (const value of [...horizons.map(n => percent(result.byHorizon[String(n)].silhouetteIoU)),
                           percent(result.mean.silhouetteIoU), (gain >= 0 ? '+' : '')+gain.toFixed(2)+' pts']) {
        row.insertCell().textContent = value;
      }
    }
  }

  let animation = null;
  let started = null;
  let initial = 0;
  function pause() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null; started = null; play.textContent = 'Lire';
  }
  function tick(now) {
    if (started === null) { started = now; initial = Number(step.value); }
    const length = data.historyFrames+data.horizonFrames;
    const minimum = 1-data.historyFrames;
    const next = minimum+(initial-minimum+Math.floor((now-started)/data.frameDurationMs))%length;
    if (next !== Number(step.value)) { step.value = next; render(); }
    animation = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (animation !== null) return pause();
    play.textContent = 'Pause'; animation = requestAnimationFrame(tick);
  });
  origin.addEventListener('change', () => { pause(); step.value = 1; render(); });
  step.addEventListener('input', () => { pause(); render(); });
  reveal.addEventListener('change', render);
  summary(); render();
})();
