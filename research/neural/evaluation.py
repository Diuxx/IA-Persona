"""Evaluate learned rasters against persistence at identical windows and horizons."""
import json
import shutil
from pathlib import Path

import numpy as np
import torch

from dataset.core import HISTORY, HORIZON, sha256
from extrapolation.evaluate import forecast_score, summarize, origins
from extrapolate import encode_frames
from neural.model import INPUT_KEYS, predict

METHODS = ("hold", "neural")


def score_predictions(expected, predicted):
    return [forecast_score(a, b, {"planned": int(np.count_nonzero(b)),
                                  "collisions": None, "outside": None})
            for a, b in zip(expected, predicted)]


def aggregate(windows):
    methods = {}
    for method in METHODS:
        scores = [window["scores"][method] for window in windows]
        methods[method] = {"mean": summarize([s for window in scores for s in window]),
                           "byHorizon": {str(i+1): summarize([window[i] for window in scores])
                                         for i in range(HORIZON)}}
    for method in METHODS:
        result = methods[method]
        result["mean"]["iouGainVsHold"] = (result["mean"]["silhouetteIoU"]
                                         - methods["hold"]["mean"]["silhouetteIoU"])
        for step, score in result["byHorizon"].items():
            score["iouGainVsHold"] = (score["silhouetteIoU"]
                                     - methods["hold"]["byHorizon"][step]["silhouetteIoU"])
    return methods


def load_reference(dataset, clip):
    path = dataset.root/clip["file"]
    if sha256(path) != clip["sha256"]:
        raise ValueError("Reference checksum mismatch")
    with np.load(path, allow_pickle=False) as data:
        return encode_frames(data["rasters"]), data["rasters"].shape[1:]


def export_viewer(output, viewer):
    output.mkdir(parents=True, exist_ok=True)
    template = Path(__file__).resolve().parent/"viewer"
    for name in ("index.html", "viewer.js", "viewer.css"):
        shutil.copyfile(template/name, output/name)
    (output/"data.js").write_text("window.extrapolationData = "+json.dumps(
        viewer, separators=(",", ":"), allow_nan=False)+";\n", encoding="utf-8")


def evaluate_split(model, dataset, split, output, device):
    if not len(dataset):
        return {"windows": 0, "methods": None, "clips": {}}
    reports = {}
    for i in range(len(dataset)):
        sample = dataset[i]
        metadata = sample["metadata"]
        inputs = sample["inputs"]
        observed = {key: torch.from_numpy(inputs[key])[None].to(device) for key in INPUT_KEYS}
        # Nothing from targets enters the model or determines its parameters.
        learned = predict(model, observed)[0].cpu().numpy()
        expected = sample["targets"]["rasters"]
        hold = np.repeat(inputs["rasters"][-1:], HORIZON, axis=0)
        predictions = {"hold": hold, "neural": learned}
        record = {"origin": metadata["originFrame"],
                  "scores": {method: score_predictions(expected, frames)
                             for method, frames in predictions.items()}}
        clip = reports.setdefault(metadata["clip"], {"windows": [], "visual": []})
        clip["windows"].append(record)
        clip["visual"].append({**record, "predicted": {method: encode_frames(frames)
                                                      for method, frames in predictions.items()}})
    all_windows = []
    for name, clip in reports.items():
        source = dataset.clips[name]
        references, (height, width) = load_reference(dataset, source)
        clip["methods"] = aggregate(clip["windows"])
        # Also report the exact rolling origins from the mathematical V1.
        selected = {i+1 for i in origins(source["frameCount"])}
        comparable = [w for w in clip["windows"] if w["origin"] in selected]
        clip["extrapolationV1Origins"] = aggregate(comparable)
        viewer = {"name": name+" / "+split, "width": width, "height": height,
                  "frameDurationMs": source["frameDurationMs"], "historyFrames": HISTORY,
                  "horizonFrames": HORIZON, "reference": references, "windows": clip.pop("visual"),
                  "methods": clip["methods"]}
        export_viewer(output/split/name, viewer)
        all_windows.extend(clip["windows"])
        print(f"{split}/{name}: hold IoU={clip['methods']['hold']['mean']['silhouetteIoU']:.4f}, "
              f"neural IoU={clip['methods']['neural']['mean']['silhouetteIoU']:.4f}", flush=True)
    return {"windows": len(all_windows), "methods": aggregate(all_windows), "clips": reports}
