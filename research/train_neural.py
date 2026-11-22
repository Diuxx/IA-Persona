"""Train and audit the first causal neural pose model (research only)."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch

from dataset.core import sha256, write_json
from dataset.reader import MotionDataset
from neural.evaluation import evaluate_split
from neural.training import LearningWindows, sanity_check, train
from run import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT/"research/output/dataset")
    parser.add_argument("--output", type=Path, default=ROOT/"research/output/neural")
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--sanity-steps", type=int, default=24)
    parser.add_argument("--width", type=int, default=24)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--evaluate-test", action="store_true", help="Evaluate reserved test only after model selection")
    args = parser.parse_args()
    if (min(args.epochs, args.batch_size, args.sanity_steps, args.width, args.threads) < 1
            or not np.isfinite(args.learning_rate) or args.learning_rate <= 0
            or not 0 <= args.seed < 2**32):
        parser.error("Invalid training parameters")
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA is unavailable in this PyTorch environment")
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    dataset = MotionDataset(args.dataset, "train")
    if not len(dataset):
        parser.error("A nonempty train split is required")
    source = LearningWindows(dataset)
    args.output.mkdir(parents=True, exist_ok=True)
    print("Overfit sanity check: only two train windows, independent model", flush=True)
    sanity = sanity_check(source, device, args.seed, args.width, args.learning_rate, args.sanity_steps)
    print(f"sanity loss {sanity['initialLoss']:.6f} -> {sanity['finalLoss']:.6f}", flush=True)
    model, history = train(source, device, args.seed, args.width, args.learning_rate,
                           args.epochs, args.batch_size)
    # Save before looking at development. No model selection on evaluation data.
    checkpoint = args.output/"model.pt"
    torch.save({name: value.detach().cpu() for name, value in model.state_dict().items()}, checkpoint)
    manifest_digest = sha256(args.dataset/"manifest.json")
    settings = {key: value for key, value in vars(args).items() if key not in ("dataset", "output")}
    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    write_json(args.output/"model.json", {"schemaVersion": 1, "architecture": "patch-residual-cnn",
                                        "parameters": parameter_count, "width": args.width,
                                        "datasetManifestSha256": manifest_digest,
                                        "weightsSha256": sha256(checkpoint), "settings": settings,
                                        "torchVersion": str(torch.__version__)})
    results = {}
    # The frozen model is evaluated on train (memorization) and development
    # (exploratory transfer); no independent test claims with this corpus.
    for split in ("train", "development") + (("test",) if args.evaluate_test else ()):
        results[split] = evaluate_split(model, MotionDataset(args.dataset, split),
                                        split, args.output, device)
    report = {"schemaVersion": 1, "datasetManifestSha256": manifest_digest,
              "settings": settings, "parameters": parameter_count,
              "sanity": sanity, "training": history, "splits": results,
              "independentTestAvailable": dataset.manifest["independentTestAvailable"],
              "testEvaluated": args.evaluate_test}
    write_json(args.output/"report.json", report)
    print(json.dumps({split: {"windows": value["windows"], "methods": value["methods"]}
                      for split, value in results.items()}, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
