"""Read trusted compiled clips; preserve the V1 idle coordinate system."""
import base64
import hashlib
import json
import subprocess

import numpy as np

from run import ROOT, load_idle
from reconstruction.core import rasterize_reference


def load_reference(name):
    if name == "idle":
        poses, _, metadata = load_idle()
        return rasterize_reference(poses, metadata["width"], metadata["height"]), metadata
    if name not in ("left", "right"):
        raise ValueError("Unknown clip")
    result = subprocess.run(["node", str(ROOT / "research/export_clip.cjs"), name],
                            capture_output=True, check=True, timeout=60)
    metadata = json.loads(result.stdout)
    frames = np.frombuffer(base64.b64decode(metadata.pop("frames"), validate=True), dtype=np.uint8)
    frames = frames.reshape(metadata["frameCount"], metadata["height"], metadata["width"])
    if np.count_nonzero(frames, axis=(1, 2)).tolist() != metadata["frameActiveCounts"]:
        raise ValueError("Raster population mismatch")
    for filename in (f"animations/{name}-targets.js", "persona-map.js", "persona-anatomy.js"):
        metadata.setdefault("sourceSha256", {})[filename] = hashlib.sha256(
            (ROOT / "assets" / filename).read_bytes()).hexdigest()
    return frames, metadata
