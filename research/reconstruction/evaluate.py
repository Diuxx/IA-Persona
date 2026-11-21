"""Evaluation only: reference frames never enter the reconstruction algorithms."""
import numpy as np
from scipy.ndimage import distance_transform_edt


def iou(a, b):
    union = np.count_nonzero(a | b)
    return float(np.count_nonzero(a & b) / union) if union else 1.0


def symmetric_distance(a, b):
    if not a.any() or not b.any():
        return None if a.any() or b.any() else 0.0
    return float((distance_transform_edt(~b)[a].mean()
                  + distance_transform_edt(~a)[b].mean()) / 2)


def score_frame(reference, prediction, diagnostics):
    a, b = reference > 0, prediction > 0
    return {
        "silhouetteIoU": iou(a, b),
        "eyeIoU": iou(reference == 3, prediction == 3),
        "symmetricDistancePx": symmetric_distance(a, b),
        "populationError": int(abs(int(a.sum()) - int(b.sum()))),
        "referencePopulation": int(a.sum()),
        "predictedPopulation": int(b.sum()),
        **diagnostics,
    }


def centroid_jerk(frames, dt):
    centers = []
    for frame in frames:
        y, x = np.nonzero(frame)
        centers.append([x.mean(), y.mean()] if len(x) else [np.nan, np.nan])
    # Non-circular evaluation: do not count an artificial seam extrapolation.
    return np.linalg.norm(np.diff(centers, n=3, axis=0), axis=1) / dt**3


def evaluate(reference, prediction, hidden, diagnostics, dt):
    metrics = {index: score_frame(reference[index], prediction[index], diagnostics[index])
               for index in hidden}
    summary = {}
    for key in ("silhouetteIoU", "eyeIoU", "symmetricDistancePx", "populationError",
                "collisions", "outside"):
        samples = [values[key] for values in metrics.values() if values[key] is not None]
        summary[key] = float(np.mean(samples)) if samples else None
    # Centroid jerk is a raster-level proxy, not individual-particle jerk.
    expected = centroid_jerk(reference, dt)
    actual = centroid_jerk(prediction, dt)
    affected = np.array([any(i in hidden for i in range(j, j+4))
                         for j in range(len(expected))], bool)
    valid = affected & np.isfinite(expected) & np.isfinite(actual)
    summary["centroidJerkErrorPxPerS3"] = (
        float(np.abs(expected[valid]-actual[valid]).mean()) if valid.any() else None)
    return {"mean": summary, "frames": {str(i+1): v for i, v in metrics.items()}}
