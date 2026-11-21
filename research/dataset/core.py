"""Build a causal, identity-free dataset from native raster observations."""
import hashlib
import json
from pathlib import Path

import numpy as np

from reconstruction.core import match_frames

SCENE_SIZE = 400
CELL = 4
HISTORY = 5
HORIZON = 8
RADIUS = 12.0
GROUPS = ("body", "eye")
SPLITS = ("train", "development", "test")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_registry(registry):
    if registry.get("schemaVersion") != 1:
        raise ValueError("Unsupported registry schema")
    clips = registry["clips"]
    splits = registry["splits"]
    if set(splits) != set(SPLITS):
        raise ValueError("Expected train, development and test splits")
    ids = [clip["id"] for clip in clips]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("Duplicate or empty clip registry")
    by_id = {clip["id"]: clip for clip in clips}
    families = {}
    for split, group_ids in splits.items():
        for family in group_ids:
            if family in families:
                raise ValueError("Family leakage between splits")
            families[family] = split
    if set(families) != {clip["family"] for clip in clips}:
        raise ValueError("Every family must be assigned exactly once")
    for clip in clips:
        if not all(isinstance(clip[key], str) and clip[key] for key in ("id", "family", "action", "source")):
            raise ValueError("Invalid clip descriptor")
        if not clip["id"].replace("-", "").replace("_", "").isalnum():
            raise ValueError("Unsafe clip identifier")
        mirror = clip.get("mirrorOf")
        if mirror is not None:
            if mirror == clip["id"] or mirror not in by_id or by_id[mirror]["family"] != clip["family"]:
                raise ValueError("A mirror must share its original's family")
    sources = [clip["source"] for clip in clips]
    if len(set(sources)) != len(sources):
        raise ValueError("Duplicate source")
    return families


def scene_rasters(frames):
    """Center the native raster without resampling, cropping or recentering per frame."""
    if (frames.ndim != 3 or frames.dtype != np.uint8 or not len(frames)
            or not 0 < frames.shape[1] <= SCENE_SIZE or not 0 < frames.shape[2] <= SCENE_SIZE
            or not np.isin(frames, (0, 1, 2, 3)).all()):
        raise ValueError("Invalid source rasters")
    _, height, width = frames.shape
    x, y = (SCENE_SIZE-width)//2, (SCENE_SIZE-height)//2
    scene = np.zeros((len(frames), SCENE_SIZE, SCENE_SIZE), np.uint8)
    scene[:, y:y+height, x:x+width] = frames
    return scene, [x, y]


def density_maps(frames):
    """Counts of body and eye pixels per cell, not binary occupancy."""
    groups = ((frames > 0) & (frames < 3), frames == 3)
    n = SCENE_SIZE//CELL
    return np.stack([mask.reshape(len(frames), n, CELL, n, CELL).sum(axis=(2, 4))
                     for mask in groups], axis=1).astype(np.uint8)


def add_counts(grid, points):
    x, y = (points//CELL).astype(int).T
    np.add.at(grid, (y, x), 1)


def transition_features(frames, dt):
    """At destination frame t, estimate motion using ONLY frames t-1 and t.

    The first transition has no observation: all counts and velocities zero,
    transition_valid False. Counts and masks distinguish unknown from still.
    """
    n = SCENE_SIZE//CELL
    shape = (len(frames), len(GROUPS), n, n)
    matched = np.zeros(shape, np.uint8)
    births = np.zeros_like(matched)
    deaths = np.zeros_like(matched)
    velocity = np.zeros((*shape, 2), np.float32)
    transition_valid = np.ones(len(frames), bool)
    transition_valid[0] = False
    for t in range(1, len(frames)):
        pair = match_frames(frames[t-1], frames[t], RADIUS)
        for g in range(len(GROUPS)):
            eye = g == 1
            select = (pair.end_shade == 3) == eye
            arrival = pair.end[select]
            displacement = (arrival-pair.start[select])/dt
            add_counts(matched[t, g], arrival)
            add_counts(births[t, g], pair.born[(pair.born_shade == 3) == eye])
            add_counts(deaths[t, g], pair.lost[(pair.lost_shade == 3) == eye])
            x, y = (arrival//CELL).astype(int).T
            np.add.at(velocity[t, g], (y, x), displacement)
    np.divide(velocity, matched[..., None], out=velocity, where=matched[..., None] > 0)
    return {"velocity": velocity, "matched": matched, "births": births, "deaths": deaths,
            "transition_valid": transition_valid}


def build_clip(frames, frame_duration_ms):
    if not np.isfinite(frame_duration_ms) or frame_duration_ms <= 0:
        raise ValueError("Invalid frame duration")
    scene, offset = scene_rasters(frames)
    if len(scene) < HISTORY+HORIZON:
        raise ValueError("Clip shorter than the learning window")
    dt = frame_duration_ms/1000
    density = density_maps(scene)
    arrays = {"rasters": scene, "density": density,
              "time_seconds": np.arange(len(scene), dtype=np.float64)*dt,
              **transition_features(scene, dt)}
    # This conservation check applies to the ESTIMATED correspondence, not true IDs.
    population = density.sum(axis=(2, 3), dtype=np.int64)
    matched = arrays["matched"].sum(axis=(2, 3), dtype=np.int64)
    born = arrays["births"].sum(axis=(2, 3), dtype=np.int64)
    lost = arrays["deaths"].sum(axis=(2, 3), dtype=np.int64)
    if (not np.array_equal(matched[1:]+born[1:], population[1:])
            or not np.array_equal(matched[1:]+lost[1:], population[:-1])):
        raise ValueError("Estimated population conservation failed")
    return arrays, offset


def window_starts(length):
    return range(max(0, length-HISTORY-HORIZON+1))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")
