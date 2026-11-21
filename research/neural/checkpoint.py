"""Reload trusted, checksummed weights without arbitrary pickled models."""
import json
from pathlib import Path

import torch

from dataset.core import sha256
from neural.model import MotionForecaster


def load_model(directory, device="cpu"):
    directory = Path(directory)
    metadata = json.loads((directory/"model.json").read_text(encoding="utf-8"))
    if metadata["schemaVersion"] != 1 or metadata["architecture"] != "patch-residual-cnn":
        raise ValueError("Unsupported neural checkpoint")
    path = directory/"model.pt"
    if sha256(path) != metadata["weightsSha256"]:
        raise ValueError("Checkpoint checksum mismatch")
    model = MotionForecaster(metadata["width"]).to(device)
    model.load_state_dict(torch.load(path, map_location=device, weights_only=True), strict=True)
    model.eval()
    return model, metadata
