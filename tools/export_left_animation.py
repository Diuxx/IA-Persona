#!/usr/bin/env python3
"""Compile the 34-frame « left » PNG sequence into one-shot particle targets.

Design (see docs/left-animation-v1.md):
- Source PNGs are NOT resampled and NOT centered frame by frame. One fixed
  integer offset places them on the same 200 × 200 logical grid as the idle
  clip; that offset is derived from the first frame's silhouette centre versus
  the idle first frame. The horizontal walk therefore survives.
- Pixels outside the 400 px stage are omitted: the renderer would clip them.
- Particle identities are matched offline. The first extra identities are the
  276 extras already used by the idle clip, so both clips share one pool
  (idle is a prefix of left). Eye pixels may exceed the 375 source eyes; extra
  eye identities are clones of source eyes.
- Output stores signed 16-bit coordinates, because the left walk leaves the
  0..255 range used by the idle encoding.

The compiled clip is one-shot: no loop, no automatic return to frame 1. The
final pose is briefly preserved by the runtime before the controller switches to idle.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import io
from pathlib import Path
import re
import sys
import zipfile

import numpy as np
from PIL import Image
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_target_animation as idle  # noqa: E402  (reuses idle classification and source map)

SOURCE = ROOT / 'assets' / 'animations' / 'left-frames.zip'
IDLE_TARGETS = ROOT / 'assets' / 'animations' / 'idle-targets.js'
OUTPUT = ROOT / 'assets' / 'animations' / 'left-targets.js'
FRAME_COUNT = 34
SOURCE_SIZE = (374, 200)
MAP_SIZE = 200
STAGE_SIZE = 400
ORIGIN = (STAGE_SIZE - MAP_SIZE) // 2  # ParticleWorld places the logical map at (100, 100).
# PROVISIONAL cadence: the source PNGs carry no timing. Tune with --frame-duration-ms.
FRAME_DURATION_MS = 60
MAX_SOURCE_BYTES = 1_000_000
# The clip ends by replaying the first HEAD_REPEAT_FRAMES source frames (same PNGs, not altered),
# then hands over to the idle loop. Set to 0 to keep the 34 source frames only.
HEAD_REPEAT_FRAMES = 13
# The clip starts at this 1-based source frame (frames 1 to START_FRAME-1 are not played).
START_FRAME = 12
NEXT_CLIP = 'idle'


def classify_source(image: Image.Image) -> np.ndarray:
    """Same grey thresholds as the idle compiler; background 102 maps to class 0."""
    gray = np.asarray(image.convert('RGB'), dtype=np.uint16).mean(axis=2)
    classes = np.zeros(gray.shape, dtype=np.uint8)
    classes[gray <= 32] = 1
    classes[(gray >= 33) & (gray <= 93)] = 2
    classes[gray >= 139] = 3
    return classes


def read_left_frames(source: Path) -> list[np.ndarray]:
    if not source.is_file():
        raise FileNotFoundError(f'Reference not found: {source}')
    expected = [f'frame-{i:03d}.png' for i in range(1, FRAME_COUNT + 1)]
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if [entry.filename for entry in entries] != expected:
            raise ValueError(f'Expected {FRAME_COUNT} ordered frame-NNN.png files')
        frames = []
        for entry in entries:
            if entry.file_size > MAX_SOURCE_BYTES:
                raise ValueError(f'PNG reference is too large: {entry.filename}')
            with Image.open(io.BytesIO(archive.read(entry))) as img:
                if img.format != 'PNG' or img.size != SOURCE_SIZE:
                    raise ValueError(f'Unexpected PNG shape: {entry.filename}')
                frames.append(classify_source(img))
    return frames


def silhouette_centre(classes: np.ndarray) -> tuple[float, float]:
    ys, xs = np.nonzero(classes)
    return (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2


def eye_centre(classes: np.ndarray) -> tuple[float, float]:
    """Centre of the eye: the white (class 3) pixels, the stable landmark shared by both clips."""
    ys, xs = np.nonzero(classes == 3)
    return float(xs.mean()), float(ys.mean())


def placement_offset(first_left: np.ndarray) -> tuple[int, int]:
    """One fixed offset for the whole sequence: the eye of the first left frame sits on the idle eye."""
    idle_first = idle.classify_pixels(
        Image.open(io.BytesIO(zipfile.ZipFile(idle.SOURCE).read('frame-001.png'))))
    ix, iy = eye_centre(idle_first)
    lx, ly = eye_centre(first_left)
    return int(round(ix - lx)), int(round(iy - ly))


def frame_targets(classes: np.ndarray, offset: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Visible pixels on the logical grid, restricted to the stage (scene 0..399)."""
    ys, xs = np.nonzero(classes)
    x = xs.astype(np.int32) + offset[0]
    y = ys.astype(np.int32) + offset[1]
    inside = (x >= -ORIGIN) & (x < STAGE_SIZE - ORIGIN) & (y >= -ORIGIN) & (y < STAGE_SIZE - ORIGIN)
    xy = np.stack([x[inside], y[inside]], axis=1)
    return xy, classes[ys, xs][inside]


ASSIGNMENT_LEAF_SIZE = 400


def assign_identities(rows_xy: np.ndarray, cols_xy: np.ndarray) -> np.ndarray:
    """Injective assignment of every row (the smaller side) to a distinct column, minimising travel.

    Spatial bisection: rows and columns are split along the widest axis with matching
    quotas, so each half stays feasible. Leaves of at most ASSIGNMENT_LEAF_SIZE rows are
    solved exactly (Hungarian method). Minimising the SUM of distances keeps each identity
    close to its previous pixel, which a greedy nearest-neighbour pass cannot guarantee.
    Splitting turns one 20 000-node problem into many small exact ones.
    """
    n, m = len(rows_xy), len(cols_xy)
    if n == 0:
        return np.empty(0, dtype=np.int64)
    if n > m:
        raise ValueError('The smaller side must fit inside the larger one')
    result = np.full(n, -1, dtype=np.int64)
    stack = [(np.arange(n), np.arange(m))]
    while stack:
        row_ids, col_ids = stack.pop()
        if len(row_ids) == 0:
            continue
        if len(row_ids) <= ASSIGNMENT_LEAF_SIZE:
            cost = cdist(rows_xy[row_ids], cols_xy[col_ids])
            picked_rows, picked_cols = linear_sum_assignment(cost)
            result[row_ids[picked_rows]] = col_ids[picked_cols]
            continue
        both = np.vstack((rows_xy[row_ids], cols_xy[col_ids]))
        axis = int(np.argmax(both.max(axis=0) - both.min(axis=0)))
        row_order = row_ids[np.argsort(rows_xy[row_ids, axis], kind='stable')]
        col_order = col_ids[np.argsort(cols_xy[col_ids, axis], kind='stable')]
        half = len(row_order) // 2
        # Cut both sides at the same coordinate, so each column lands on its geographic side.
        # Clamping keeps both halves feasible (each side needs at least as many columns as rows).
        cut = rows_xy[row_order[half], axis]
        left_cols = int(np.count_nonzero(cols_xy[col_order, axis] < cut))
        left_cols = min(max(left_cols, half), len(col_order) - (len(row_order) - half))
        stack.append((row_order[:half], col_order[:left_cols]))
        stack.append((row_order[half:], col_order[left_cols:]))
    if (result < 0).any():
        raise AssertionError('Some identities were not assigned')
    return result


def read_idle_extra_sources(path: Path) -> list[int]:
    text = path.read_text(encoding='utf-8')
    match = re.search(r'extraSources: \[([^\]]*)\]', text)
    if not match:
        raise ValueError('Unable to read idle extraSources')
    return [int(value) for value in match.group(1).split(',') if value.strip()]


def build_pool(frames: list[tuple[np.ndarray, np.ndarray]], source_xy: np.ndarray,
               kinds: np.ndarray, idle_extras: list[int],
               fixed_extras: list[int] | None = None) -> tuple[np.ndarray, list[int], np.ndarray, np.ndarray]:
    """Return (pool home positions, extra sources, eye ids, body ids).

    With fixed_extras, the pool is imposed (used by clips that share another clip's pool,
    such as the mirrored clip): the frames must fit inside it.
    """
    source_eye = np.flatnonzero(kinds == 3)
    source_body = np.flatnonzero(kinds != 3)
    max_body = max(int(np.count_nonzero(shade != 3)) for _, shade in frames)
    max_eye = max(int(np.count_nonzero(shade == 3)) for _, shade in frames)
    if fixed_extras is not None:
        extras = [int(v) for v in fixed_extras]
        base = len(source_xy)
        pool_xy = np.vstack((source_xy.astype(np.int32), source_xy[np.asarray(extras, dtype=np.int64)].astype(np.int32)))
        extra_kinds = kinds[np.asarray(extras, dtype=np.int64)]
        body_ids = np.concatenate((source_body, base + np.flatnonzero(extra_kinds != 3)))
        eye_ids = np.concatenate((source_eye, base + np.flatnonzero(extra_kinds == 3)))
        if max_body > len(body_ids) or max_eye > len(eye_ids):
            raise ValueError('The fixed pool is too small for these frames')
        return pool_xy, extras, eye_ids, body_ids
    if any(kinds[index] == 3 for index in idle_extras):
        raise ValueError('Idle extras must be body identities')
    body_extra = max(0, max_body - len(source_body) - len(idle_extras))
    remaining = np.setdiff1d(source_body, np.asarray(idle_extras, dtype=np.int64))
    new_body = remaining[np.arange(body_extra, dtype=np.int64) * len(remaining) // max(1, body_extra)] \
        if body_extra else np.empty(0, dtype=np.int64)
    eye_extra = max(0, max_eye - len(source_eye))
    new_eye = source_eye[np.arange(eye_extra, dtype=np.int64) * len(source_eye) // max(1, eye_extra)] \
        if eye_extra else np.empty(0, dtype=np.int64)
    extras = [int(v) for v in idle_extras] + [int(v) for v in new_body] + [int(v) for v in new_eye]
    base = len(source_xy)
    pool_xy = np.vstack((source_xy.astype(np.int32), source_xy[np.asarray(extras, dtype=np.int64)].astype(np.int32)))
    total = base + len(extras)
    body_ids = np.concatenate((source_body, np.arange(base, base + len(idle_extras) + len(new_body), dtype=np.int64)))
    eye_ids = np.concatenate((source_eye, np.arange(base + len(idle_extras) + len(new_body), total, dtype=np.int64)))
    return pool_xy, extras, eye_ids, body_ids


def build_targets(frames: list[tuple[np.ndarray, np.ndarray]], pool_xy: np.ndarray,
                  eye_ids: np.ndarray, body_ids: np.ndarray) -> np.ndarray:
    """Return int32 array (frames, pool, 3): x, y, shade. Shade 0 = identity inactive in that frame."""
    total = len(pool_xy)
    prev_pos = pool_xy.astype(np.int32).copy()
    prev_active = np.zeros(total, dtype=bool)
    out = np.zeros((len(frames), total, 3), dtype=np.int32)
    for frame_index, (xy, shade) in enumerate(frames):
        pose = out[frame_index]
        pose[:, :2] = prev_pos
        for ids, mask in ((eye_ids, shade == 3), (body_ids, shade != 3)):
            targets = xy[mask]
            target_shade = shade[mask]
            if len(targets) > len(ids):
                raise ValueError(f'Insufficient pool capacity for frame {frame_index + 1}')
            if not len(targets):
                # Group absent in this frame (e.g. closed eye): its identities stay at rest with shade 0.
                continue
            active = ids[prev_active[ids]]
            dormant = ids[~prev_active[ids]]
            if len(targets) <= len(active):
                # Some active identities go dormant (shade 0); each target keeps one identity.
                pick = assign_identities(targets.astype(np.float64), prev_pos[active].astype(np.float64))
                assigned_ids = active[pick]
                assigned_targets = np.arange(len(targets))
            else:
                # Every active identity keeps a target; the surplus targets are newborn identities.
                pick = (assign_identities(prev_pos[active].astype(np.float64), targets.astype(np.float64))
                        if len(active) else np.empty(0, dtype=np.int64))
                used = np.zeros(len(targets), dtype=bool)
                used[pick] = True
                remaining = np.flatnonzero(~used)
                # Newborn identities appear on their target (fading in), so their old rest position is irrelevant.
                dormant_pick = (assign_identities(targets[remaining].astype(np.float64),
                                                  prev_pos[dormant].astype(np.float64))
                                if len(remaining) else np.empty(0, dtype=np.int64))
                assigned_ids = np.concatenate((active, dormant[dormant_pick]))
                assigned_targets = np.concatenate((pick, remaining))
            chosen = targets[assigned_targets]
            pose[assigned_ids, :2] = chosen
            pose[assigned_ids, 2] = target_shade[assigned_targets]
            prev_pos[assigned_ids] = chosen
        prev_active = pose[:, 2] != 0
        expected = len(frames[frame_index][0])
        if int(np.count_nonzero(prev_active)) != expected:
            raise AssertionError(f'Frame {frame_index + 1}: target coverage mismatch')
    return out


def encode_payload(targets: np.ndarray) -> bytes:
    """Particle-major records: int16 x, int16 y (little endian), uint8 shade = 5 bytes."""
    if targets.min() < np.iinfo(np.int16).min or targets.max() > np.iinfo(np.int16).max:
        raise ValueError('Coordinates exceed the signed 16-bit encoding')
    particle_major = targets.transpose((1, 0, 2))
    count, frames = particle_major.shape[0], particle_major.shape[1]
    packed = np.empty((count, frames, 5), dtype=np.uint8)
    for axis, start in ((0, 0), (1, 2)):
        values = np.ascontiguousarray(particle_major[..., axis].astype('<i2'))
        packed[..., start:start + 2] = values.view(np.uint8).reshape(count, frames, 2)
    packed[..., 4] = particle_major[..., 2].astype(np.uint8)
    return packed.tobytes()


def compile_animation(source: Path, destination: Path, frame_duration_ms: int = FRAME_DURATION_MS,
                      head_repeat: int = HEAD_REPEAT_FRAMES, start_frame: int = START_FRAME,
                      name: str = 'left', mirror: bool = False, shared_pool_from: Path | None = None,
                      next_clip: str = NEXT_CLIP) -> dict:
    if not 20 <= frame_duration_ms <= 300:
        raise ValueError('Frame duration should be between 20 and 300 milliseconds')
    if not 0 <= head_repeat <= FRAME_COUNT:
        raise ValueError('head_repeat must be between 0 and the source frame count')
    if not 1 <= start_frame <= FRAME_COUNT:
        raise ValueError('start_frame must be a 1-based source frame number')
    source_classes = read_left_frames(source)
    if mirror:
        # Horizontal mirror of the same PNGs: the eye is re-anchored below, so the mirror is exact.
        source_classes = [np.fliplr(c) for c in source_classes]
    # The eye of the first PLAYED frame sits on the idle eye, so the start matches idle.
    offset = placement_offset(source_classes[start_frame - 1])
    # Sequence = source frames start_frame..34, then the first `head_repeat` source frames again.
    sequence = source_classes[start_frame - 1:] + source_classes[:head_repeat]
    frames = [frame_targets(c, offset) for c in sequence]
    frame_total = len(sequence)
    source_xy, kinds, checksum = idle.source_groups()
    idle_extras = read_idle_extra_sources(IDLE_TARGETS)
    fixed_extras = read_idle_extra_sources(shared_pool_from) if shared_pool_from else None
    pool_xy, extras, eye_ids, body_ids = build_pool(frames, source_xy, kinds, idle_extras,
                                                    fixed_extras=fixed_extras)
    targets = build_targets(frames, pool_xy, eye_ids, body_ids)
    compressed = gzip.compress(encode_payload(targets), compresslevel=9, mtime=0)
    encoded = base64.b64encode(compressed).decode('ascii')
    counts = [int(np.count_nonzero(t[:, 2])) for t in targets]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('\n'.join([
        f'/** Generated from left-frames.zip by tools/export_left_animation.py ({name}{", mirrored" if mirror else ""}). Do not edit by hand. */',
        f'const PERSONA_{name.upper()}_TARGETS = Object.freeze({{',
        f"  name: '{name}',",
        "  kind: 'one-shot',",
        f"  next: '{next_clip}',",
        '  width: 200,',
        '  height: 200,',
        f'  sourceFrames: {FRAME_COUNT},',
        f'  frameCount: {frame_total},',
        f'  particleCount: {targets.shape[1]},',
        f'  frameActiveCounts: {counts},',
        f'  extraSources: {extras},',
        f'  sourceChecksum: {checksum},',
        f'  durationMs: {frame_total * frame_duration_ms},',
        "  encoding: 'gzip-particle-major-xy16-rgb',",
        f"  payload: '{encoded}',",
        '});',
        f"if (typeof module !== 'undefined' && module.exports) module.exports = {{ PERSONA_{name.upper()}_TARGETS }};",
        '',
    ]), encoding='utf8')
    # Start continuity: identities active in frame 1 versus their rest-pose positions.
    rest = pool_xy.astype(np.float64)
    first = targets[0]
    active_first = first[:, 2] != 0
    start_travel = np.hypot(first[active_first, 0] - rest[active_first, 0],
                            first[active_first, 1] - rest[active_first, 1])
    # Travel is measured only for identities visible in both consecutive frames.
    continuing = (targets[1:, :, 2] != 0) & (targets[:-1, :, 2] != 0)
    deltas = targets[1:, :, :2].astype(float) - targets[:-1, :, :2].astype(float)
    frame_travel = np.hypot(deltas[..., 0], deltas[..., 1])[continuing]
    return {
        'frames': frame_total,
        'source_frames': FRAME_COUNT,
        'head_repeat': head_repeat,
        'offset': offset,
        'pool_capacity': int(targets.shape[1]),
        'extra_sources': len(extras),
        'eye_identities': int(len(eye_ids)),
        'min_visible': min(counts),
        'max_visible': max(counts),
        'max_eye_visible': int(max(np.count_nonzero(t[:, 2] == 3) for t in targets)),
        'start_travel_mean_px': round(float(np.mean(start_travel)), 2),
        'start_travel_p95_px': round(float(np.percentile(start_travel, 95)), 2),
        'frame_travel_mean_px': round(float(np.mean(frame_travel)), 2),
        'frame_travel_p95_px': round(float(np.percentile(frame_travel, 95)), 2),
        'duration_ms': frame_total * frame_duration_ms,
        'compressed_bytes': len(compressed),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--frame-duration-ms', type=int, default=FRAME_DURATION_MS)
    parser.add_argument('--name', default='left', help='Clip name (lowercase letters and hyphens).')
    parser.add_argument('--mirror', action='store_true', help='Flip the source frames horizontally.')
    parser.add_argument('--shared-pool-from', type=Path, default=None,
                        help='Reuse the identity pool of another compiled clip (must fit inside it).')
    parser.add_argument('--next', dest='next_clip', default=NEXT_CLIP, help='Clip played after this one.')
    args = parser.parse_args()
    print(compile_animation(args.source, args.output, args.frame_duration_ms, name=args.name,
                            mirror=args.mirror, shared_pool_from=args.shared_pool_from,
                            next_clip=args.next_clip))


if __name__ == '__main__':
    main()
