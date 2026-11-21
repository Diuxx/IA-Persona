"""Run masked-pose transport comparisons on idle, left and right."""
import argparse
import json
import shutil
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
import scipy

from run import ROOT
from reconstruct import encode_frames
from estimate import benchmark as baseline_benchmark
from estimation.clips import load_reference
from reconstruction.core import known_indices
from reconstruction.evaluate import evaluate
from transport.reconstruct import reconstruct_transport


def benchmark(reference, metadata, stride, radius=12.0, neighbours=12, temporal_weight=0.5):
    report, predicted = baseline_benchmark(reference, metadata, stride, 4, radius)
    indices = known_indices(len(reference), stride)
    hidden = sorted(set(range(len(reference))) - set(indices))
    start = perf_counter()
    extra, diagnostics, intervals = reconstruct_transport(
        reference[indices].copy(), indices, len(reference), radius, neighbours, temporal_weight)
    report["transportSeconds"] = perf_counter()-start
    report["transportIntervals"] = intervals
    for method, frames in extra.items():
        report["methods"][method] = evaluate(reference, frames, hidden, diagnostics[method],
                                             metadata["frameDurationMs"]/1000)
    predicted.update(extra)
    return report, predicted


def run_clip(name, output, radius, neighbours, temporal_weight):
    reference, metadata = load_reference(name)
    report = {"schemaVersion": 3, "source": metadata, "matchRadiusPx": radius,
              "neighboursPerDirection": neighbours, "temporalWeight": temporal_weight,
              "birthDeathPenaltyPx2": radius**2/2, "numpyVersion": np.__version__,
              "scipyVersion": scipy.__version__, "opencvVersion": cv2.__version__,
              "experiments": {}}
    viewer = {"width": metadata["width"], "height": metadata["height"],
              "frameDurationMs": metadata["frameDurationMs"], "name": name,
              "reference": encode_frames(reference), "experiments": {}}
    for stride in (2, 3, 4):
        scores, predicted = benchmark(reference, metadata, stride, radius, neighbours, temporal_weight)
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
        shutil.copyfile(ROOT / "research/transport/viewer" / filename, output / filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clip", choices=("idle", "left", "right", "all"), default="all")
    parser.add_argument("--output", type=Path, default=ROOT / "research/output/transport")
    parser.add_argument("--radius", type=float, default=12.0)
    parser.add_argument("--neighbours", type=int, default=12)
    parser.add_argument("--temporal-weight", type=float, default=0.5)
    args = parser.parse_args()
    if (not np.isfinite(args.radius) or args.radius <= 0 or args.neighbours < 1
            or not np.isfinite(args.temporal_weight) or args.temporal_weight < 0):
        parser.error("invalid transport parameters")
    cv2.setNumThreads(1)
    for name in ("idle", "left", "right") if args.clip == "all" else (args.clip,):
        run_clip(name, args.output/name, args.radius, args.neighbours, args.temporal_weight)


if __name__ == "__main__":
    main()
