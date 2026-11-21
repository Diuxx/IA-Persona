"""Motion Estimation V2: compare V1 and optical-flow-guided reconstruction."""
import argparse
import json
from pathlib import Path
import shutil
from time import perf_counter

import cv2
import numpy as np

from run import ROOT
from reconstruct import encode_frames
from reconstruction.core import known_indices, reconstruct
from reconstruction.evaluate import evaluate
from estimation.clips import load_reference
from estimation.guided import reconstruct_guided


def benchmark(reference, metadata, stride, cell=4, radius=12.0):
    indices = known_indices(len(reference), stride)
    hidden = sorted(set(range(len(reference))) - set(indices))
    observed = reference[indices].copy()
    start = perf_counter()
    predicted, diagnostics = reconstruct(observed, indices, len(reference), cell, radius)
    baseline_seconds = perf_counter()-start
    start = perf_counter()
    extra, extra_diagnostics, intervals = reconstruct_guided(observed, indices, len(reference), radius)
    guided_seconds = perf_counter()-start
    predicted.update(extra)
    diagnostics.update(extra_diagnostics)
    methods = {method: evaluate(reference, frames, hidden, diagnostics[method],
                                metadata["frameDurationMs"]/1000)
               for method, frames in predicted.items()}
    return {"known": [i+1 for i in indices], "hidden": [i+1 for i in hidden],
            "baselineSeconds": baseline_seconds, "guidedSeconds": guided_seconds,
            "flowIntervals": intervals, "methods": methods}, predicted


def run_clip(name, output, cell, radius):
    reference, metadata = load_reference(name)
    report = {"schemaVersion": 2, "source": metadata, "cellPx": cell,
              "matchRadiusPx": radius, "opencvVersion": cv2.__version__,
              "numpyVersion": np.__version__, "experiments": {}}
    viewer = {"width": metadata["width"], "height": metadata["height"],
              "frameDurationMs": metadata["frameDurationMs"], "name": name,
              "reference": encode_frames(reference), "experiments": {}}
    for stride in (2, 3, 4):
        scores, predicted = benchmark(reference, metadata, stride, cell, radius)
        report["experiments"][str(stride)] = scores
        viewer["experiments"][str(stride)] = {
            "scores": scores, "predicted": {method: encode_frames(frames)
                                            for method, frames in predicted.items()}}
        print(f"{name} stride={stride}: " + ", ".join(
            f"{method} IoU={result['mean']['silhouetteIoU']:.4f}"
            for method, result in scores["methods"].items()), flush=True)
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False)+"\n",
                                        encoding="utf-8")
    (output / "data.js").write_text("window.reconstructionData = " + json.dumps(
        viewer, separators=(",", ":"), allow_nan=False)+";\n", encoding="utf-8")
    for filename in ("index.html", "viewer.js", "viewer.css"):
        shutil.copyfile(ROOT / "research/estimation/viewer" / filename, output / filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clip", choices=("idle", "left", "right", "all"), default="all")
    parser.add_argument("--output", type=Path, default=ROOT / "research/output/estimation")
    parser.add_argument("--cell", type=int, default=4)
    parser.add_argument("--radius", type=float, default=12.0)
    args = parser.parse_args()
    if args.cell < 1 or not np.isfinite(args.radius) or args.radius <= 0:
        parser.error("invalid cell size or matching radius")
    cv2.setNumThreads(1)
    for name in ("idle", "left", "right") if args.clip == "all" else (args.clip,):
        run_clip(name, args.output / name, args.cell, args.radius)


if __name__ == "__main__":
    main()
