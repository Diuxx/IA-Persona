"""NumPy reader: one sample exposes separate observed input and future target."""
import json
from pathlib import Path

import numpy as np

from dataset.core import HISTORY, HORIZON, SPLITS, sha256

TRANSITIONS = ("velocity", "matched", "births", "deaths", "transition_valid")


class MotionDataset:
    def __init__(self, root, split):
        self.root = Path(root)
        if split not in SPLITS:
            raise ValueError("Unknown split")
        self.manifest = json.loads((self.root/"manifest.json").read_text(encoding="utf-8"))
        if (self.manifest["schemaVersion"] != 1
                or self.manifest["historyFrames"] != HISTORY
                or self.manifest["horizonFrames"] != HORIZON):
            raise ValueError("Unsupported dataset schema")
        self.samples = [item for item in self.manifest["windows"] if item["split"] == split]
        self.clips = {item["id"]: item for item in self.manifest["clips"] if item["split"] == split}
        self._cache = {}

    def __len__(self):
        return len(self.samples)

    def _load(self, clip):
        if clip not in self._cache:
            info = self.clips[clip]
            path = self.root/info["file"]
            if sha256(path) != info["sha256"]:
                raise ValueError("Dataset clip checksum mismatch: "+clip)
            with np.load(path, allow_pickle=False) as data:
                self._cache[clip] = {key: data[key] for key in data.files}
        return self._cache[clip]

    def __getitem__(self, index):
        entry = self.samples[index]
        clip = self.clips[entry["clip"]]
        data = self._load(entry["clip"])
        start = entry["start"]
        boundary = start+HISTORY
        end = boundary+HORIZON
        if start < 0 or end > len(data["rasters"]):
            raise ValueError("Invalid window boundaries")
        inputs = {name: data[name][start:boundary].copy() for name in ("rasters", "density", *TRANSITIONS)}
        # The transition arriving at the first observed frame would expose a pose
        # outside the window. Remove it, even when it was available at clip level.
        for name in TRANSITIONS:
            inputs[name][0] = 0
        targets = {name: data[name][boundary:end].copy() for name in ("rasters", "density", *TRANSITIONS)}
        origin_time = data["time_seconds"][boundary-1]
        inputs["time_seconds"] = data["time_seconds"][start:boundary]-origin_time
        targets["time_seconds"] = data["time_seconds"][boundary:end]-origin_time
        return {"inputs": inputs, "targets": targets,
                "metadata": {"clip": clip["id"], "family": clip["family"],
                             "action": clip["action"], "originFrame": boundary,
                             "frameDurationMs": clip["frameDurationMs"]}}
