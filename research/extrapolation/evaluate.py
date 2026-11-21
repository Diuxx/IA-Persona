"""Rolling-origin evaluation. The future is accessed only after forecasting."""
from time import perf_counter

import numpy as np

from extrapolation.forecast import HISTORY, METHODS, center, forecast
from reconstruction.evaluate import score_frame

HORIZON = 8
ORIGIN_STRIDE = 4


def origins(length, horizon=HORIZON, stride=ORIGIN_STRIDE):
    if horizon < 1 or stride < 1 or length < HISTORY+horizon:
        raise ValueError("Clip too short or invalid evaluation window")
    final = length-horizon-1
    return sorted(set(range(HISTORY-1, final+1, stride)) | {final})


def forecast_score(reference, prediction, diagnostics):
    result = score_frame(reference, prediction, diagnostics)
    expected, actual = center(reference), center(prediction)
    result["centroidErrorPx"] = (float(np.linalg.norm(actual-expected))
                                 if expected is not None and actual is not None else None)
    result["signedPopulationError"] = result["predictedPopulation"]-result["referencePopulation"]
    return result


def summarize(samples):
    keys = ("silhouetteIoU", "eyeIoU", "symmetricDistancePx", "populationError",
            "signedPopulationError", "centroidErrorPx", "collisions", "outside")
    result = {}
    for key in keys:
        values = [sample[key] for sample in samples if sample[key] is not None]
        result[key] = float(np.mean(values)) if values else None
    result["samples"] = len(samples)
    return result


def evaluate_origin(reference, origin, horizon, radius=12., neighbours=12, cell=4):
    if origin < HISTORY-1 or origin+horizon >= len(reference):
        raise ValueError("Invalid forecast origin")
    # Only the observed window crosses the prediction boundary.
    history = reference[origin-HISTORY+1:origin+1].copy()
    start = perf_counter()
    predicted, diagnostics, source = forecast(history, horizon, radius, neighbours, cell)
    seconds = perf_counter()-start
    future = reference[origin+1:origin+horizon+1]
    scores = {method: [forecast_score(a, b, stats)
                      for a, b, stats in zip(future, predicted[method], diagnostics[method])]
              for method in METHODS}
    return {"origin": origin+1, "observed": list(range(origin-HISTORY+2, origin+2)),
            "future": list(range(origin+2, origin+horizon+2)), "forecastSeconds": seconds,
            "estimatedMotion": source, "scores": scores}, predicted


def aggregate(windows, horizon):
    by_method = {}
    for method in METHODS:
        by_step = {str(step): summarize([window["scores"][method][step-1] for window in windows])
                   for step in range(1, horizon+1)}
        overall = summarize([score for window in windows for score in window["scores"][method]])
        by_method[method] = {"mean": overall, "byHorizon": by_step}
    baseline = by_method["hold"]
    for method in METHODS:
        result = by_method[method]
        result["mean"]["iouGainVsHold"] = (result["mean"]["silhouetteIoU"]
                                         - baseline["mean"]["silhouetteIoU"])
        for step, score in result["byHorizon"].items():
            score["iouGainVsHold"] = (score["silhouetteIoU"]
                                     - baseline["byHorizon"][step]["silhouetteIoU"])
    return by_method
