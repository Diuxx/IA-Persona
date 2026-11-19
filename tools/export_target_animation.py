#!/usr/bin/env python3
"""Convert a reference GIF to temporally matched particle targets.

At runtime, the original 15 886 particles keep their identity. Each frame only
changes their destination and their black/gray/white shading. The match is done
once offline with spatial nearest-neighbor transport, not in the browser.

The input has a #666 background and a handwritten "IDLE" legend at the bottom.
The fixed crop removes only that legend, without re-centering each frame.
"""
from __future__ import annotations

import argparse
import base64
from pathlib import Path
import gzip
import re
import zlib

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'animations' / 'idle-reference.gif'
PIXEL_MAP = ROOT / 'assets' / 'persona-map.js'
OUTPUT = ROOT / 'assets' / 'animations' / 'idle-targets.js'
SIZE = 200
ART_BOUNDS = (0, 25, 190, 235)
FRAME_STRIDE = 2
BACKGROUND = 102


def classify_pixels(image: Image.Image) -> np.ndarray:
    """Return 200×200 pixels: 0 background, 1 dark, 2 gray, 3 eye/white."""
    crop = image.convert('RGB').crop(ART_BOUNDS)
    factor = min(SIZE / crop.width, SIZE / crop.height)
    crop = crop.resize((round(crop.width * factor), round(crop.height * factor)), Image.Resampling.NEAREST)
    logical = Image.new('RGB', (SIZE, SIZE), (BACKGROUND,) * 3)
    logical.paste(crop, ((SIZE - crop.width) // 2, (SIZE - crop.height) // 2))
    gray = np.asarray(logical, dtype=np.uint16).mean(axis=2)
    classes = np.zeros((SIZE, SIZE), dtype=np.uint8)
    classes[(gray >= 33) & (gray <= 93)] = 2
    classes[gray <= 32] = 1
    classes[gray >= 139] = 3
    return classes


def source_groups() -> tuple[np.ndarray, np.ndarray, int]:
    """Read the same pixel order used by ParticleWorld.decodePixelMap()."""
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
    """Nearest spatial transport, keeping source identities stable across frames.

    Multi-pass matching avoids the large crossed paths of per-frame sorting.
    Unavoidable extra points share a target only after all distinct positions
    have been considered. The mapping is deterministic for a given GIF.
    """
    n = len(previous_xy)
    m = len(new_xy)
    if not n or not m:
        raise ValueError('Every reference frame needs a visible face and body')
    available_sources = np.arange(n, dtype=np.int32)
    available_targets = np.arange(m, dtype=np.int32)
    selected = np.full(n, -1, dtype=np.int32)
    for _ in range(4):
        if not len(available_sources) or not len(available_targets):
            break
        tree = cKDTree(new_xy[available_targets])
        k = min(8, len(available_targets))
        dist, neighbors = tree.query(previous_xy[available_sources], k=k)
        if k == 1:
            dist, neighbors = dist[:, None], neighbors[:, None]
        order = np.argsort(dist, axis=None, kind='stable')
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
        # If target has fewer points than source, extra particles may overlap.
        if not len(available_targets):
            tree = cKDTree(new_xy)
            _, closest = tree.query(previous_xy[available_sources])
            selected[available_sources] = closest
        else:
            tree = cKDTree(new_xy[available_targets])
            _, closest = tree.query(previous_xy[available_sources])
            selected[available_sources] = available_targets[closest]
    if (selected < 0).any():
        raise AssertionError('Every source particle must have a destination')
    return selected


def compile_animation(source_path: Path, output_path: Path, stride: int = FRAME_STRIDE) -> dict:
    if not 1 <= stride <= 20:
        raise ValueError('stride must be between 1 and 20')
    original_xy, kinds, source_checksum = source_groups()
    frame_data = []
    frame_durations = []
    with Image.open(source_path) as gif:
        if gif.format != 'GIF' or gif.size != (190, 292) or gif.n_frames < 2:
            raise ValueError('Reference must be the 190×292 multi-frame idle GIF')
        original_frames = gif.n_frames
        total_duration = 0
        for i in range(original_frames):
            gif.seek(i)
            duration = gif.info.get('duration', 40) or 40
            total_duration += duration
            if i % stride == 0:
                classes = classify_pixels(gif.convert('RGB'))
                if not (classes == 3).any() or not (classes == 1).any():
                    raise ValueError(f'Frame {i} has lost the eye or body')
                frame_data.append(classes)
                frame_durations.append(duration)
    if not frame_data:
        raise ValueError('No reference frames were decoded')

    all_positions = []
    identities = [np.flatnonzero(kinds == 3), np.flatnonzero(kinds != 3)]
    previous_positions = [None, None]
    for index, classes in enumerate(frame_data):
        packed = np.empty((len(original_xy), 3), dtype=np.uint8)
        for group, (particle_indices, criterion) in enumerate(zip(identities, [classes == 3, (classes == 1) | (classes == 2)])):
            coords_yx = np.argwhere(criterion).astype(np.uint8)
            targets_xy = coords_yx[:, ::-1].copy()
            if index == 0:
                indices = first_mapping(original_xy[particle_indices], targets_xy)
            else:
                indices = match_next(previous_positions[group], targets_xy)
            mapped = targets_xy[indices]
            packed[particle_indices, :2] = mapped
            packed[particle_indices, 2] = classes[mapped[:, 1], mapped[:, 0]]
            previous_positions[group] = mapped.astype(np.float32)
        all_positions.append(packed)

    # Particle-major order compresses successive coordinates of the same point
    # extremely well. JS converts this back to frame-major buffers once.
    data = np.stack(all_positions)
    particle_major = data.transpose((1, 0, 2)).copy().tobytes()
    compressed = gzip.compress(particle_major, compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode('ascii')
    script = '\n'.join([
        '/** Generated from idle-reference.gif by tools/export_target_animation.py. */',
        'const PERSONA_IDLE_TARGETS = Object.freeze({',
        "  name: 'idle',", '  width: 200,', '  height: 200,',
        f'  sourceFrames: {original_frames},',
        f'  frameCount: {len(frame_data)},',
        f'  particleCount: {len(original_xy)},',
        f'  sourceChecksum: {source_checksum},',
        f'  durationMs: {total_duration},',
        "  encoding: 'gzip-particle-major-rgb3',",
        f"  payload: '{encoded}',", '});',
        "if (typeof module !== 'undefined' && module.exports) module.exports = { PERSONA_IDLE_TARGETS };",
        '',
    ])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(script, encoding='utf8')
    diff = np.hypot(data[1:, :, 0].astype(float) - data[:-1, :, 0].astype(float),
                    data[1:, :, 1].astype(float) - data[:-1, :, 1].astype(float))
    return {
        'source_frames': original_frames,
        'target_frames': len(frame_data),
        'particle_count': len(original_xy),
        'duration_ms': total_duration,
        'mean_step_px': round(float(diff.mean()), 2),
        'p95_step_px': round(float(np.percentile(diff, 95)), 2),
        'compressed_bytes': len(compressed),
        'output_bytes': output_path.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--stride', type=int, default=FRAME_STRIDE)
    options = parser.parse_args()
    print(compile_animation(options.source, options.output, options.stride))


if __name__ == '__main__':
    main()
