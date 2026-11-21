"""Offline benchmark: python research/reconstruct.py."""
import argparse
import base64
import json
from pathlib import Path
import shutil
from time import perf_counter

from run import load_idle, ROOT
from reconstruction.core import reconstruct, rasterize_reference, known_indices
from reconstruction.evaluate import evaluate


def encode_frames(frames):
    return [base64.b64encode(frame.tobytes()).decode("ascii") for frame in frames]


def benchmark(reference, metadata, stride, cell, radius):
    indices = known_indices(len(reference), stride)
    hidden = sorted(set(range(len(reference))) - set(indices))
    # Only a detached observed subset crosses the reconstruction boundary.
    start = perf_counter()
    predicted, diagnostics = reconstruct(reference[indices].copy(), indices,
                                         len(reference), cell, radius)
    elapsed = perf_counter() - start
    scores = {method: evaluate(reference, frames, hidden, diagnostics[method],
                               metadata["frameDurationMs"]/1000)
              for method, frames in predicted.items()}
    report = {"known": [i+1 for i in indices], "hidden": [i+1 for i in hidden],
              "totalReconstructionSeconds": elapsed, "methods": scores}
    return report, predicted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "research/output/reconstruction")
    parser.add_argument("--cell", type=int, default=4)
    parser.add_argument("--radius", type=float, default=12.0, help="matching radius in pixels")
    args = parser.parse_args()
    poses, _, metadata = load_idle()
    reference = rasterize_reference(poses, metadata["width"], metadata["height"])
    report = {"schemaVersion": 1, "source": metadata, "cellPx": args.cell,
              "matchRadiusPx": args.radius, "experiments": {}}
    viewer = {"width": metadata["width"], "height": metadata["height"],
              "frameDurationMs": metadata["frameDurationMs"],
              "reference": encode_frames(reference), "experiments": {}}
    for stride in (2, 3, 4):
        scores, predicted = benchmark(reference, metadata, stride, args.cell, args.radius)
        report["experiments"][str(stride)] = scores
        viewer["experiments"][str(stride)] = {
            "scores": scores, "predicted": {method: encode_frames(frames)
                                            for method, frames in predicted.items()}}
        print(f"stride={stride}: {len(scores['hidden'])} hidden poses; "
              + ", ".join(f"{name} IoU={values['mean']['silhouetteIoU']:.4f}"
                          for name, values in scores["methods"].items()))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False)+"\n",
                                              encoding="utf-8")
    (args.output / "data.js").write_text("window.reconstructionData = "
                                         + json.dumps(viewer, separators=(",", ":"), allow_nan=False)
                                         + ";\n", encoding="utf-8")
    for name in ("index.html", "viewer.js", "viewer.css"):
        shutil.copyfile(ROOT / "research/reconstruction/viewer" / name, args.output / name)


if __name__ == "__main__":
    main()
