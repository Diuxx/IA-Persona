"""Compare causal forecasts over multiple chronological windows."""
import argparse
import base64
import json
import shutil
from pathlib import Path

import numpy as np
import scipy

from run import ROOT
from estimation.clips import load_reference
from extrapolation.forecast import HISTORY
from extrapolation.evaluate import HORIZON, ORIGIN_STRIDE, origins, evaluate_origin, aggregate


def encode_frames(frames):
    """Four 2-bit shade indices per byte. No lossy image compression."""
    output = []
    for frame in frames:
        values = frame.ravel()
        padded = np.pad(values, (0, (-len(values)) % 4))
        packed = padded[::4] | (padded[1::4] << 2) | (padded[2::4] << 4) | (padded[3::4] << 6)
        output.append(base64.b64encode(packed.tobytes()).decode("ascii"))
    return output


def run_clip(name, output, horizon, stride, radius, neighbours, cell):
    reference, metadata = load_reference(name)
    windows, visual = [], []
    for origin in origins(len(reference), horizon, stride):
        report, predicted = evaluate_origin(reference, origin, horizon, radius, neighbours, cell)
        windows.append(report)
        visual.append({"origin": report["origin"], "scores": report["scores"],
                       "predicted": {method: encode_frames(frames) for method, frames in predicted.items()}})
        print(f"{name} origin={origin+1}: " + ", ".join(
            f"{method} IoU@{horizon}={scores[-1]['silhouetteIoU']:.4f}"
            for method, scores in report["scores"].items()), flush=True)
    summary = aggregate(windows, horizon)
    report = {"schemaVersion": 1, "source": metadata, "historyFrames": HISTORY,
              "horizonFrames": horizon, "originStrideFrames": stride,
              "matchRadiusPx": radius, "neighbours": neighbours, "cellPx": cell,
              "numpyVersion": np.__version__, "scipyVersion": scipy.__version__,
              "windows": windows, "methods": summary}
    viewer = {"name": name, "width": metadata["width"], "height": metadata["height"],
              "frameDurationMs": metadata["frameDurationMs"], "historyFrames": HISTORY,
              "horizonFrames": horizon, "reference": encode_frames(reference),
              "windows": visual, "methods": summary}
    output.mkdir(parents=True, exist_ok=True)
    (output/"report.json").write_text(json.dumps(report, indent=2, allow_nan=False)+"\n",
                                       encoding="utf-8")
    (output/"data.js").write_text("window.extrapolationData = " + json.dumps(
        viewer, separators=(",", ":"), allow_nan=False)+";\n", encoding="utf-8")
    for filename in ("index.html", "viewer.js", "viewer.css"):
        shutil.copyfile(ROOT/"research/extrapolation/viewer"/filename, output/filename)
    for method, score in summary.items():
        print(f"{name} summary {method}: mean IoU={score['mean']['silhouetteIoU']:.4f}; "
              f"IoU@{horizon}={score['byHorizon'][str(horizon)]['silhouetteIoU']:.4f}; "
              f"gain vs hold={score['mean']['iouGainVsHold']:+.4f}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clip", choices=("idle", "left", "right", "all"), default="all")
    parser.add_argument("--output", type=Path, default=ROOT/"research/output/extrapolation")
    parser.add_argument("--horizon", type=int, default=HORIZON)
    parser.add_argument("--stride", type=int, default=ORIGIN_STRIDE)
    parser.add_argument("--radius", type=float, default=12.)
    parser.add_argument("--neighbours", type=int, default=12)
    parser.add_argument("--cell", type=int, default=4)
    args = parser.parse_args()
    if (not 1 <= args.horizon <= 31 or args.stride < 1 or args.cell < 1
            or args.neighbours < 1 or not np.isfinite(args.radius) or args.radius <= 0):
        parser.error("invalid forecast parameters")
    for name in ("idle", "left", "right") if args.clip == "all" else (args.clip,):
        run_clip(name, args.output/name, args.horizon, args.stride, args.radius,
                 args.neighbours, args.cell)


if __name__ == "__main__":
    main()
