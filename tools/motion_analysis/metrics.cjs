'use strict';

function rounded(value) {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(3));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const low = Math.floor(position);
  const mix = position - low;
  return ordered[low] + (ordered[Math.min(low + 1, ordered.length - 1)] - ordered[low]) * mix;
}

function distance(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function createAccumulator() {
  return { count: 0, x: 0, y: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function addPoint(accumulator, x, y) {
  accumulator.count += 1;
  accumulator.x += x;
  accumulator.y += y;
  accumulator.minX = Math.min(accumulator.minX, x);
  accumulator.minY = Math.min(accumulator.minY, y);
  accumulator.maxX = Math.max(accumulator.maxX, x);
  accumulator.maxY = Math.max(accumulator.maxY, y);
}

function finalizeAccumulator(accumulator) {
  if (!accumulator.count) return { visibleCount: 0, centroid: null, bounds: null };
  return {
    visibleCount: accumulator.count,
    centroid: {
      x: rounded(accumulator.x / accumulator.count),
      y: rounded(accumulator.y / accumulator.count),
    },
    bounds: {
      x: accumulator.minX,
      y: accumulator.minY,
      width: accumulator.maxX - accumulator.minX + 1,
      height: accumulator.maxY - accumulator.minY + 1,
    },
  };
}

function measureFrame(pose, regionIds, names, width, height, index, frameDurationMs) {
  const global = createAccumulator();
  const regionAccumulators = names.map(() => createAccumulator());
  const raster = new Uint8Array(width * height);
  for (let particle = 0; particle < regionIds.length; particle += 1) {
    const offset = particle * 3;
    if (!pose[offset + 2]) continue;
    const x = pose[offset];
    const y = pose[offset + 1];
    addPoint(global, x, y);
    addPoint(regionAccumulators[regionIds[particle]], x, y);
    raster[y * width + x] = 1;
  }
  const globalGeometry = finalizeAccumulator(global);
  const regions = Object.fromEntries(names.map((name, i) => [name,
    finalizeAccumulator(regionAccumulators[i])]));
  const body = regions.body?.centroid;
  for (const region of Object.values(regions)) {
    region.relativeToBody = region.centroid && body ? {
      x: rounded(region.centroid.x - body.x),
      y: rounded(region.centroid.y - body.y),
    } : null;
  }
  return {
    index: index + 1,
    timeMs: rounded(index * frameDurationMs),
    ...globalGeometry,
    occupiedRatio: rounded(globalGeometry.visibleCount / (width * height)),
    regions,
    raster,
  };
}

function compareSilhouettes(previous, next, width, height) {
  const previousRaster = previous.raster;
  const nextRaster = next.raster;
  let samePixels = 0;
  for (let pixel = 0; pixel < previousRaster.length; pixel += 1) {
    if (previousRaster[pixel] && nextRaster[pixel]) samePixels += 1;
  }
  const intersectionOverUnion = samePixels /
    (previous.visibleCount + next.visibleCount - samePixels);

  // Compensate whole-body translation before measuring change of actual shape.
  const shiftX = Math.round(next.centroid.x - previous.centroid.x);
  const shiftY = Math.round(next.centroid.y - previous.centroid.y);
  let alignedIntersection = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!previousRaster[y * width + x]) continue;
      const movedX = x + shiftX;
      const movedY = y + shiftY;
      if (movedX < 0 || movedX >= width || movedY < 0 || movedY >= height) continue;
      if (nextRaster[movedY * width + movedX]) alignedIntersection += 1;
    }
  }
  return {
    silhouetteIoU: rounded(intersectionOverUnion),
    alignedSilhouetteIoU: rounded(alignedIntersection /
      (previous.visibleCount + next.visibleCount - alignedIntersection)),
  };
}

function measureTransition(previousPose, nextPose, previous, next, regionIds, names, width, height, dtMs) {
  const matchedByRegion = names.map(() => []);
  const matchedDistances = [];
  let appearances = 0;
  let disappearances = 0;
  for (let particle = 0; particle < regionIds.length; particle += 1) {
    const offset = particle * 3;
    const visibleBefore = previousPose[offset + 2] > 0;
    const visibleAfter = nextPose[offset + 2] > 0;
    if (!visibleBefore && visibleAfter) appearances += 1;
    else if (visibleBefore && !visibleAfter) disappearances += 1;
    else if (visibleBefore && visibleAfter) {
      const distancePx = Math.hypot(nextPose[offset] - previousPose[offset],
        nextPose[offset + 1] - previousPose[offset + 1]);
      matchedDistances.push(distancePx);
      matchedByRegion[regionIds[particle]].push(distancePx);
    }
  }
  const dtSeconds = dtMs / 1000;
  const perSecond = distances => {
    const meanDistance = average(distances);
    return meanDistance === null ? null : rounded(meanDistance / dtSeconds);
  };
  const regions = Object.fromEntries(names.map((name, index) => {
    const before = previous.regions[name];
    const after = next.regions[name];
    return [name, {
      matchedCount: matchedByRegion[index].length,
      meanMatchedSpeedPxPerSec: perSecond(matchedByRegion[index]),
      centroidSpeedPxPerSec: before.centroid && after.centroid ?
        rounded(distance(before.centroid, after.centroid) / dtSeconds) : null,
    }];
  }));
  return {
    fromFrame: previous.index,
    toFrame: next.index,
    timeMs: previous.timeMs,
    appearances,
    disappearances,
    matchedCount: matchedDistances.length,
    meanMatchedSpeedPxPerSec: perSecond(matchedDistances),
    p95MatchedSpeedPxPerSec: rounded(percentile(matchedDistances, 0.95) / dtSeconds),
    centroidSpeedPxPerSec: rounded(distance(previous.centroid, next.centroid) / dtSeconds),
    centroidVelocityPxPerSec: {
      x: rounded((next.centroid.x - previous.centroid.x) / dtSeconds),
      y: rounded((next.centroid.y - previous.centroid.y) / dtSeconds),
    },
    ...compareSilhouettes(previous, next, width, height),
    regions,
  };
}

function amplitude(points) {
  if (!points.length) return null;
  const center = { x: average(points.map(point => point.x)), y: average(points.map(point => point.y)) };
  return Math.max(...points.map(point => distance(point, center)));
}

function numericRange(values) {
  return values.length ? Math.max(...values) - Math.min(...values) : null;
}

function phaseOffset(reference, target, frameDurationMs) {
  const pairs = reference.map((value, index) => [value, target[index]]);
  if (pairs.some(pair => pair.some(value => value === null))) return null;
  const baseline = average(reference);
  const meanTarget = average(target);
  const a = reference.map(value => value - baseline);
  const b = target.map(value => value - meanTarget);
  const energy = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) *
    b.reduce((sum, value) => sum + value * value, 0));
  if (energy < 1e-9) return null;
  let bestCorrelation = -Infinity;
  let bestLag = 0;
  const radius = Math.floor(reference.length / 4);
  for (let lag = -radius; lag <= radius; lag += 1) {
    let correlation = 0;
    for (let index = 0; index < a.length; index += 1) {
      correlation += a[index] * b[(index + lag + a.length) % a.length];
    }
    correlation /= energy;
    if (correlation > bestCorrelation + 1e-10 ||
        (Math.abs(correlation - bestCorrelation) < 1e-10 && Math.abs(lag) < Math.abs(bestLag))) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  if (bestCorrelation < 0.25) return null;
  return { offsetMs: rounded(bestLag * frameDurationMs), correlation: rounded(bestCorrelation) };
}

function findTimingExtrema(transitions, frameDurationMs) {
  const speeds = transitions.map(transition => transition.meanMatchedSpeedPxPerSec);
  const smoothed = speeds.map((_, index) => average([
    speeds[(index + speeds.length - 1) % speeds.length],
    speeds[index],
    speeds[(index + 1) % speeds.length],
  ]));
  if (numericRange(smoothed) < 1e-6) return { motionPeaksMs: [], restMomentsMs: [] };
  const upper = percentile(smoothed, 0.75);
  const lower = percentile(smoothed, 0.25);
  const motionPeaksMs = [];
  const restMomentsMs = [];
  for (let index = 0; index < smoothed.length; index += 1) {
    const prev = smoothed[(index + smoothed.length - 1) % smoothed.length];
    const next = smoothed[(index + 1) % smoothed.length];
    if (smoothed[index] >= upper && smoothed[index] > prev && smoothed[index] > next) {
      motionPeaksMs.push(rounded(index * frameDurationMs));
    }
    if (smoothed[index] <= lower && smoothed[index] < prev && smoothed[index] < next) {
      restMomentsMs.push(rounded(index * frameDurationMs));
    }
  }
  return { motionPeaksMs, restMomentsMs };
}

function summarize(data, frames, transitions) {
  const centers = frames.map(frame => frame.centroid);
  const summaries = {};
  for (const name of data.regionNames) {
    const regionFrames = frames.map(frame => frame.regions[name]);
    const regionTransitions = transitions.map(transition => transition.regions[name]);
    const centers = regionFrames.map(frame => frame.centroid).filter(Boolean);
    const relatives = regionFrames.map(frame => frame.relativeToBody).filter(Boolean);
    const speeds = regionTransitions.map(item => item.meanMatchedSpeedPxPerSec).filter(value => value !== null);
    const centroidSpeeds = regionTransitions.map(item => item.centroidSpeedPxPerSec).filter(value => value !== null);
    const lag = phaseOffset(
      transitions.map(item => item.regions.body?.centroidSpeedPxPerSec ?? null),
      regionTransitions.map(item => item.centroidSpeedPxPerSec), data.frameDurationMs);
    summaries[name] = {
      meanVisibleCount: rounded(average(regionFrames.map(frame => frame.visibleCount))),
      minVisibleCount: Math.min(...regionFrames.map(frame => frame.visibleCount)),
      maxVisibleCount: Math.max(...regionFrames.map(frame => frame.visibleCount)),
      centerAmplitudePx: rounded(amplitude(centers)),
      relativeToBodyAmplitudePx: rounded(amplitude(relatives)),
      widthVariationPx: rounded(numericRange(regionFrames.filter(frame => frame.bounds).map(frame => frame.bounds.width))),
      heightVariationPx: rounded(numericRange(regionFrames.filter(frame => frame.bounds).map(frame => frame.bounds.height))),
      meanMatchedSpeedPxPerSec: rounded(average(speeds)),
      meanCentroidSpeedPxPerSec: rounded(average(centroidSpeeds)),
      phaseOffsetFromBody: name === 'body' ? { offsetMs: 0, correlation: 1 } : lag,
    };
  }
  const speedValues = transitions.map(item => item.meanMatchedSpeedPxPerSec).filter(value => value !== null);
  const centroidValues = transitions.map(item => item.centroidSpeedPxPerSec);
  const timing = findTimingExtrema(transitions, data.frameDurationMs);
  const seam = transitions[transitions.length - 1];
  return {
    globalMotion: {
      centerAmplitudePx: rounded(amplitude(centers)),
      widthVariationPx: rounded(numericRange(frames.map(frame => frame.bounds.width))),
      heightVariationPx: rounded(numericRange(frames.map(frame => frame.bounds.height))),
      populationVariation: numericRange(frames.map(frame => frame.visibleCount)),
      meanMatchedSpeedPxPerSec: rounded(average(speedValues)),
      meanCentroidSpeedPxPerSec: rounded(average(centroidValues)),
      maxCentroidSpeedPxPerSec: rounded(Math.max(...centroidValues)),
      maxCentroidAccelerationPxPerSec2: rounded(Math.max(...transitions.map(
        item => item.centroidAccelerationPxPerSec2))),
    },
    regionSummaries: summaries,
    timing: {
      ...timing,
      seam: {
        fromFrame: seam.fromFrame,
        toFrame: seam.toFrame,
        silhouetteIoU: seam.silhouetteIoU,
        alignedSilhouetteIoU: seam.alignedSilhouetteIoU,
        centroidSpeedPxPerSec: seam.centroidSpeedPxPerSec,
        appearances: seam.appearances,
        disappearances: seam.disappearances,
      },
    },
  };
}

function analyzeMotion(data) {
  if (!data || !Array.isArray(data.frames) || data.frames.length !== data.frameCount ||
      !Array.isArray(data.regionNames) || data.frames.length < 2 ||
      !Number.isFinite(data.frameDurationMs) || data.frameDurationMs <= 0) {
    throw new TypeError('Jeu de poses incompatible avec l’analyseur.');
  }
  const frames = data.frames.map((frame, index) =>
    measureFrame(frame, data.regionIds, data.regionNames, data.width, data.height,
      index, data.frameDurationMs));
  if (frames.some(frame => frame.visibleCount === 0)) throw new Error('Une frame est entièrement invisible.');
  const transitions = frames.map((frame, index) => {
    const nextIndex = (index + 1) % frames.length;
    return measureTransition(data.frames[index], data.frames[nextIndex], frame,
      frames[nextIndex], data.regionIds, data.regionNames,
      data.width, data.height, data.frameDurationMs);
  });
  // Derive acceleration from successive centroid velocity vectors, including the seam.
  for (let index = 0; index < transitions.length; index += 1) {
    const current = transitions[index].centroidVelocityPxPerSec;
    const previous = transitions[(index + transitions.length - 1) % transitions.length].centroidVelocityPxPerSec;
    transitions[index].centroidAccelerationPxPerSec2 = rounded(Math.hypot(
      current.x - previous.x, current.y - previous.y) / (data.frameDurationMs / 1000));
  }
  const summary = summarize(data, frames, transitions);
  return {
    schemaVersion: 1,
    analysisKind: 'target-poses-not-rendered-physics',
    animation: {
      name: data.name,
      frameCount: data.frameCount,
      frameDurationMs: rounded(data.frameDurationMs),
      durationMs: rounded(data.frameCount * data.frameDurationMs),
      canvasSize: [data.width, data.height],
    },
    population: {
      capacity: data.particleCount,
      originalCapacity: data.sourceParticleCount,
      minVisible: Math.min(...frames.map(frame => frame.visibleCount)),
      maxVisible: Math.max(...frames.map(frame => frame.visibleCount)),
    },
    ...summary,
    frames: frames.map(({ raster, ...frame }) => frame),
    transitions,
    annotations: { movementType: null, styleTags: [], validatedByHuman: false },
    methodology: {
      speedUnits: 'pixels/second; matched IDs active in both adjacent frames',
      amplitudeUnits: 'pixels; maximum distance from the mean centroid',
      phaseOffset: 'positive when region follows the body; maximum circular correlation of centroid speeds; null when unreliable',
      silhouetteIoU: 'overlap of occupied pixels; aligned metric compensates rounded centroid translation',
      transitions: 'last entry measures frame N to frame 1 (loop seam)',
      caveats: [
        'Particle-ID reassignment can inflate matched-particle speed without visible silhouette motion.',
        'Region membership is inherited from source anatomy and is not re-segmented for each pose.',
        'This file measures reference target poses, not the actual spring-driven Canvas trajectory.',
        'One observed loop does not establish a general motion style or subjective intention.',
      ],
    },
  };
}

module.exports = { analyzeMotion, measureFrame, measureTransition, phaseOffset };
