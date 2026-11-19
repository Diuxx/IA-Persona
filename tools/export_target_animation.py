#!/usr/bin/env python3
"""Compile tracked particle poses from the user's full idle PNG sequence.

Every source PNG becomes one target pose. We keep the 43 provided frames in
order to preserve the user's original timing and smoothness. Identity matching
happens offline; the browser only interpolates between consecutive targets.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import io
from pathlib import Path
import re
import zipfile
import zlib

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'animations' / 'idle-frames.zip'
PIXEL_MAP = ROOT / 'assets' / 'persona-map.js'
OUTPUT = ROOT / 'assets' / 'animations' / 'idle-targets.js'
SIZE = 200
ART_BOUNDS = (0, 8, 190, 225)  # Fixed for ALL frames: keep top droplets + feet, exclude lettering.
BACKGROUND = 102
SOURCE_FRAME_COUNT = 43
LOOP_FRAMES = 43
FRAME_DURATION_MS = 40
MAX_SOURCE_BYTES = 1_000_000


def classify_pixels(image: Image.Image) -> np.ndarray:
    """Classify shape shades; transparent background/handwritten caption get class 0."""
    crop = image.convert('RGB').crop(ART_BOUNDS)
    factor = min(SIZE / crop.width, SIZE / crop.height)
    size = (round(crop.width * factor), round(crop.height * factor))
    crop = crop.resize(size, Image.Resampling.NEAREST)
    logical = Image.new('RGB', (SIZE, SIZE), (BACKGROUND,) * 3)
    logical.paste(crop, ((SIZE - crop.width) // 2, (SIZE - crop.height) // 2))
    gray = np.asarray(logical, dtype=np.uint16).mean(axis=2)
    classes = np.zeros((SIZE, SIZE), dtype=np.uint8)
    classes[gray <= 32] = 1
    classes[(gray >= 33) & (gray <= 93)] = 2
    classes[gray >= 139] = 3
    return classes


def read_source_frames(source_path: Path, loop_frames: int) -> tuple[list[np.ndarray], int]:
    """Read an explicit numbered PNG archive without trusting filenames or zip sizes."""
    if not source_path.is_file():
        raise FileNotFoundError(f'Reference not found: {source_path}')
    with zipfile.ZipFile(source_path) as archive:
        entries = archive.infolist()
        expected_names = [f'frame-{i:03d}.png' for i in range(1, SOURCE_FRAME_COUNT + 1)]
        if [entry.filename for entry in entries] != expected_names:
            raise ValueError(f'Expected {SOURCE_FRAME_COUNT} ordered frame-NNN.png files')
        if any(entry.file_size > MAX_SOURCE_BYTES for entry in entries):
            raise ValueError('PNG reference is too large')
        if not 2 <= loop_frames <= SOURCE_FRAME_COUNT:
            raise ValueError('Invalid loop frame count')
        frames = []
        for entry in entries[:loop_frames]:
            with Image.open(io.BytesIO(archive.read(entry))) as img:
                if img.format != 'PNG' or img.size != (190, 286):
                    raise ValueError(f'Unexpected PNG shape: {entry.filename}')
                classes = classify_pixels(img)
            if np.count_nonzero(classes == 1) < 1000 or not np.any(classes == 3):
                raise ValueError(f'Frame {entry.filename} has lost the cloud or eye')
            frames.append(classes)
    return frames, len(expected_names)


def source_groups() -> tuple[np.ndarray, np.ndarray, int]:
    """Use ParticleWorld.decodePixelMap's ordering, independent of the source art size."""
    text = PIXEL_MAP.read_text(encoding='utf-8')
    encoded = re.search(r"runs: '([^']+)'", text)
    if not encoded:
        raise ValueError('Unable to locate the source pixel map RLE')
    raw_runs = base64.b64decode(encoded.group(1))
    runs = np.frombuffer(raw_runs, dtype=np.uint8).reshape((-1, 4))
    positions, kinds = [], []
    for y, x, length, kind in runs:
        for xx in range(int(x), int(x + length)):
            positions.append((xx, int(y)))
            kinds.append(int(kind))
    return np.asarray(positions, dtype=np.uint8), np.asarray(kinds, dtype=np.uint8), zlib.adler32(raw_runs)


def hilbert_index(x: int, y: int) -> int:
    distance = 0
    for step in (128, 64, 32, 16, 8, 4, 2, 1):
        rx = 1 if x & step else 0
        ry = 1 if y & step else 0
        distance += step * step * ((3 * rx) ^ ry)
        if ry == 0:
            if rx:
                x, y = 255 - x, 255 - y
            x, y = y, x
    return distance


def first_mapping(source_xy: np.ndarray, target_xy: np.ndarray) -> np.ndarray:
    source_order = sorted(range(len(source_xy)), key=lambda i: hilbert_index(*map(int, source_xy[i])))
    target_order = sorted(range(len(target_xy)), key=lambda i: hilbert_index(*map(int, target_xy[i])))
    result = np.empty(len(source_xy), dtype=np.int32)
    for rank, source_index in enumerate(source_order):
        target_rank = min(len(target_order) - 1, (2 * rank + 1) * len(target_order) // (2 * len(source_order)))
        result[source_index] = target_order[target_rank]
    return result


def match_next(previous_xy: np.ndarray, new_xy: np.ndarray) -> np.ndarray:
    """Deterministic nearest-neighbor transport, prioritizing one point per target."""
    n = len(previous_xy)
    m = len(new_xy)
    if not n or not m:
        raise ValueError('Every frame requires visible shape pixels')
    available_sources = np.arange(n, dtype=np.int32)
    available_targets = np.arange(m, dtype=np.int32)
    selected = np.full(n, -1, dtype=np.int32)
    for _ in range(4):
        if not len(available_sources) or not len(available_targets):
            break
        tree = cKDTree(new_xy[available_targets])
        k = min(8, len(available_targets))
        distances, neighbors = tree.query(previous_xy[available_sources], k=k)
        if k == 1:
            distances, neighbors = distances[:, None], neighbors[:, None]
        order = np.argsort(distances, axis=None, kind='stable')
        source_slots = order // k
        target_slots = order % k
        matched_sources = np.zeros(len(available_sources), dtype=bool)
        matched_targets = np.zeros(len(available_targets), dtype=bool)
        for source_slot, target_slot in zip(source_slots, target_slots):
            if matched_sources[source_slot]:
                continue
            candidate = int(neighbors[source_slot, target_slot])
            if matched_targets[candidate]:
                continue
            matched_sources[source_slot] = True
            matched_targets[candidate] = True
            selected[available_sources[source_slot]] = available_targets[candidate]
            if matched_sources.all() or matched_targets.all():
                break
        available_sources = available_sources[~matched_sources]
        available_targets = available_targets[~matched_targets]
    if len(available_sources):
        if len(available_targets):
            # Preserve target coverage. Nearest-neighbor fallback alone sends many
            # particles to the same pixel and leaves visible holes in the body.
            # Space-filling ordering distributes the remaining IDs across all
            # as-yet-unoccupied pixels without a costly dense assignment.
            residual = first_mapping(previous_xy[available_sources].astype(np.uint8), new_xy[available_targets])
            selected[available_sources] = available_targets[residual]
        else:
            # More source particles than visible target pixels: controlled overlap.
            _, closest = cKDTree(new_xy).query(previous_xy[available_sources])
            selected[available_sources] = closest
    if (selected < 0).any():
        raise AssertionError('Missing a target for some particles')
    return selected


def build_targets(classes_by_frame: list[np.ndarray], source_xy: np.ndarray,
                  kinds: np.ndarray) -> tuple[np.ndarray, list[int], list[int]]:
    """Track persistent IDs, allowing each frame to activate exactly its visible pixels.

    All visible pixels receive a distinct particle; dormant IDs are reused before
    allocating any new runtime particle. Matching is performed offline, not at 60 Hz.
    """
    source_eye = np.flatnonzero(kinds == 3)
    source_body = np.flatnonzero(kinds != 3)
    max_body = max(int(np.count_nonzero((frame > 0) & (frame != 3))) for frame in classes_by_frame)
    max_eye = max(int(np.count_nonzero(frame == 3)) for frame in classes_by_frame)
    if max_eye > len(source_eye):
        raise ValueError('Eye particle pool must be expanded separately')
    extra_count = max(0, max_body - len(source_body))
    extra_sources = source_body[(np.arange(extra_count, dtype=np.int64) * len(source_body) // max(1, extra_count))]
    total = len(source_xy) + extra_count
    pool_xy = np.vstack((source_xy, source_xy[extra_sources])).astype(np.float32)
    body_ids = np.concatenate((source_body, np.arange(len(source_xy), total, dtype=np.int32)))
    group_ids = (source_eye, body_ids)
    # Inactive entries retain their last known target position and shade=0.
    positions = np.empty((len(classes_by_frame), total, 3), dtype=np.uint8)
    previous_positions = pool_xy.copy()
    previous_active = np.zeros(total, dtype=bool)
    frame_counts = []

    for frame_index, classes in enumerate(classes_by_frame):
        frame = positions[frame_index]
        frame[:, :2] = np.clip(previous_positions, 0, 255).astype(np.uint8)
        frame[:, 2] = 0
        for ids, mask in ((group_ids[0], classes == 3),
                          (group_ids[1], np.isin(classes, (1, 2)))):
            targets = np.argwhere(mask)[:, ::-1].copy().astype(np.uint8)
            if len(targets) > len(ids):
                raise ValueError(f'Insufficient pool capacity for frame {frame_index + 1}')
            active_ids = ids[previous_active[ids]]
            assigned_ids = np.empty(len(targets), dtype=np.int32)
            assigned_targets = np.empty(len(targets), dtype=np.int32)

            if len(targets) <= len(active_ids):
                # Every target chooses a distinct previously active particle.
                indices = match_next(targets.astype(np.float32), previous_positions[active_ids])
                assigned_ids[:] = active_ids[indices]
                assigned_targets[:] = np.arange(len(targets))
            else:
                n = len(active_ids)
                used_targets = np.zeros(len(targets), dtype=bool)
                if n:
                    target_indices = match_next(previous_positions[active_ids], targets.astype(np.float32))
                    assigned_ids[:n] = active_ids
                    assigned_targets[:n] = target_indices
                    used_targets[target_indices] = True
                remaining_targets = np.flatnonzero(~used_targets)
                dormant_ids = ids[~previous_active[ids]]
                chosen = match_next(targets[remaining_targets].astype(np.float32),
                                    previous_positions[dormant_ids])
                assigned_ids[n:] = dormant_ids[chosen]
                assigned_targets[n:] = remaining_targets

            selected_xy = targets[assigned_targets]
            frame[assigned_ids, :2] = selected_xy
            frame[assigned_ids, 2] = classes[selected_xy[:, 1], selected_xy[:, 0]]
            previous_positions[assigned_ids] = selected_xy
        previous_active = frame[:, 2] != 0
        frame_counts.append(int(np.count_nonzero(previous_active)))
        if frame_counts[-1] != int(np.count_nonzero(classes)):
            raise AssertionError(f'Frame {frame_index + 1}: target coverage mismatch')

    return positions, frame_counts, extra_sources.astype(int).tolist()


def compile_animation(source: Path, destination: Path, loop_frames: int = LOOP_FRAMES,
                      frame_duration_ms: int = FRAME_DURATION_MS) -> dict:
    if not 20 <= frame_duration_ms <= 300:
        raise ValueError('Frame duration should be between 20 and 300 milliseconds')
    classes_by_frame, source_frames = read_source_frames(source, loop_frames)
    # The final source pose should remain close enough to the first one for a
    # clean loop, but it is not forced to be identical.
    first = classes_by_frame[0] > 0
    last = classes_by_frame[-1] > 0
    overlap = np.count_nonzero(first & last) / np.count_nonzero(first | last)
    if overlap < 0.96:
        raise ValueError('The selected loop does not end near the original idle pose')

    source_xy, kinds, checksum = source_groups()
    targets, frame_counts, extra_sources = build_targets(classes_by_frame, source_xy, kinds)
    particle_major = targets.transpose((1, 0, 2)).copy().tobytes()
    compressed = gzip.compress(particle_major, compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode('ascii')
    payload = '\n'.join([
        '/** Generated from idle-frames.zip by tools/export_target_animation.py. */',
        'const PERSONA_IDLE_TARGETS = Object.freeze({',
        "  name: 'idle',", '  width: 200,', '  height: 200,',
        f'  sourceFrames: {source_frames},',
        f'  frameCount: {len(classes_by_frame)},',
        f'  particleCount: {targets.shape[1]},',
        f'  frameActiveCounts: {frame_counts},',
        f'  extraSources: {extra_sources},',
        f'  sourceChecksum: {checksum},',
        f'  durationMs: {len(classes_by_frame) * frame_duration_ms},',
        "  encoding: 'gzip-particle-major-rgb3-dynamic',",
        f"  payload: '{encoded}',", '});',
        "if (typeof module !== 'undefined' && module.exports) module.exports = { PERSONA_IDLE_TARGETS };", '',
    ])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(payload, encoding='utf8')
    travel = np.hypot(np.diff(targets[:, :, 0].astype(float), axis=0),
                      np.diff(targets[:, :, 1].astype(float), axis=0))
    return {
        'reference_frames': source_frames,
        'loop_frames': len(classes_by_frame),
        'duration_ms': len(classes_by_frame) * frame_duration_ms,
        'pool_capacity': targets.shape[1],
        'min_visible': min(frame_counts),
        'max_visible': max(frame_counts),
        'mean_motion_px': round(float(np.mean(travel)), 2),
        'p95_motion_px': round(float(np.percentile(travel, 95)), 2),
        'loop_iou': round(float(overlap), 4),
        'compressed_bytes': len(compressed),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--loop-frames', type=int, default=LOOP_FRAMES)
    parser.add_argument('--frame-duration-ms', type=int, default=FRAME_DURATION_MS)
    args = parser.parse_args()
    print(compile_animation(args.source, args.output, args.loop_frames, args.frame_duration_ms))


if __name__ == '__main__':
    main()
