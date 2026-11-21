"""Causal forecasts from five past rasters. No future frame or exported ID."""
import numpy as np
from scipy.ndimage import distance_transform_edt

from reconstruction.core import DisplacementField, match_frames, points_from
from transport.reconstruct import match_transport

HISTORY = 5
METHODS = ("hold", "centroid", "particle_velocity", "transport_velocity",
           "damped_field", "shape_trend")


def center(image):
    y, x = np.nonzero(image)
    return np.array([x.mean(), y.mean()]) if len(x) else None


def centroid_velocity(history):
    first, last = center(history[0]), center(history[-1])
    if first is None or last is None:
        return np.zeros(2)
    return (last-first)/(len(history)-1)


def points_and_shades(image):
    groups = [points_from(image, eye) for eye in (False, True)]
    return np.concatenate([p for p, _ in groups]), np.concatenate([s for _, s in groups])


def particle_velocities(pair, points, shape, gap):
    """Unmatched visible points remain stationary in the velocity baseline."""
    grid = np.zeros((*shape, 2))
    x, y = pair.end.astype(int).T
    grid[y, x] = (pair.end-pair.start)/gap
    x, y = points.astype(int).T
    return grid[y, x]


def local_velocities(pair, points, shades, shape, gap, cell, fallback):
    """Smooth the measured displacement at the last observed positions."""
    height, width = shape
    result = np.empty_like(points)
    for eye in (False, True):
        matched = (pair.end_shade == 3) == eye
        visible = (shades == 3) == eye
        if not visible.any():
            continue
        field = DisplacementField(pair.end[matched],
                                  (pair.end[matched]-pair.start[matched])/gap,
                                  width, height, cell)
        initial = np.broadcast_to(fallback, (int(visible.sum()), 2)).copy()
        result[visible] = field.sample(points[visible], initial)
    return result


def damped_steps(step, decay=4.0):
    """Integrated exponentially decreasing velocity, in observed-frame units."""
    return float(np.exp(-np.arange(step)/decay).sum())


def rasterize(points, shades, shape):
    height, width = shape
    xy = np.floor(points+0.5).astype(int)
    inside = ((xy[:, 0] >= 0) & (xy[:, 0] < width)
              & (xy[:, 1] >= 0) & (xy[:, 1] < height))
    image = np.zeros(shape, np.uint8)
    np.maximum.at(image, (xy[inside, 1], xy[inside, 0]), shades[inside])
    return image, {"planned": len(points), "outside": int((~inside).sum()),
                   "collisions": int(inside.sum()-np.count_nonzero(image))}


def signed_distance(mask):
    """Positive inside, negative outside; pad to make the canvas edge explicit."""
    if not mask.any():
        return np.full(mask.shape, -float(max(mask.shape)))
    padded = np.pad(mask, 1, constant_values=False)
    return (distance_transform_edt(padded)-distance_transform_edt(~padded))[1:-1, 1:-1]


def shape_models(history):
    """Independent body / eye distance fields, using only past shape change."""
    models = []
    first, last = history[0], history[-1]
    for eye in (False, True):
        a = first == 3 if eye else (first > 0) & (first < 3)
        b = last == 3 if eye else (last > 0) & (last < 3)
        end = signed_distance(b)
        # Cap exaggerated changes near newly appearing/disappearing components.
        trend = np.clip((end-signed_distance(a))/(len(history)-1), -3., 3.)
        models.append((end, trend))
    return models


def predict_shape(models, last, duration):
    body = models[0][0] + duration*models[0][1] > 0
    eye = models[1][0] + duration*models[1][1] > 0
    image = np.zeros(last.shape, np.uint8)
    image[body] = 1
    image[body & (last == 2)] = 2
    image[eye] = 3
    return image, {"planned": int(np.count_nonzero(image)), "outside": None,
                   "collisions": None}


def forecast(history, horizon, radius=12.0, neighbours=12, cell=4):
    """Forecast all horizons at once from a fixed history, without teacher forcing.

    Positions are propagated from the last observed raster, not fed back from
    the rasterized predictions. Thus collisions do not delete tracking state.
    """
    if (history.ndim != 3 or len(history) != HISTORY or not history.shape[1]
            or not history.shape[2] or not np.isin(history, [0, 1, 2, 3]).all()):
        raise ValueError("Expected five nonempty-shaped raster poses with valid shades")
    if (not isinstance(horizon, int) or horizon < 1 or cell < 1
            or not np.isfinite(radius) or radius <= 0 or neighbours < 1):
        raise ValueError("Invalid forecast parameters")
    last = history[-1]
    points, shades = points_and_shades(last)
    global_velocity = centroid_velocity(history)
    # Two observed frame intervals reduce quantization noise in the estimate.
    gap = 2
    a = history[-1-gap]
    greedy = match_frames(a, last, radius)
    transport, transport_report = match_transport(a, last, radius, neighbours)
    velocities = {
        "hold": np.zeros_like(points),
        "centroid": np.broadcast_to(global_velocity, points.shape),
        "particle_velocity": particle_velocities(greedy, points, last.shape, gap),
        "transport_velocity": particle_velocities(transport, points, last.shape, gap),
        "damped_field": local_velocities(transport, points, shades, last.shape, gap,
                                        cell, global_velocity),
    }
    shape = shape_models(history)
    predicted = {name: np.empty((horizon, *last.shape), np.uint8) for name in METHODS}
    diagnostics = {name: [] for name in METHODS}
    for step in range(1, horizon+1):
        duration = damped_steps(step)
        for method, velocity in velocities.items():
            elapsed = duration if method == "damped_field" else step
            image, stats = rasterize(points + elapsed*velocity, shades, last.shape)
            predicted[method][step-1] = image
            diagnostics[method].append(stats)
        image, stats = predict_shape(shape, last, duration)
        predicted["shape_trend"][step-1] = image
        diagnostics["shape_trend"].append(stats)
    return predicted, diagnostics, {
        "centroidVelocityPxPerFrame": global_velocity.tolist(),
        "greedyMatched": len(greedy.start),
        "transport": transport_report,
        "lastPopulation": len(points),
    }
