"""Identity-free interpolation between observed raster poses."""
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree

METHODS = ("linear", "cubic", "field")
PALETTE = (0, 1, 2, 3)


@dataclass
class Pair:
    start: np.ndarray
    end: np.ndarray
    start_shade: np.ndarray
    end_shade: np.ndarray
    lost: np.ndarray
    lost_shade: np.ndarray
    born: np.ndarray
    born_shade: np.ndarray


def rasterize_reference(poses, width, height):
    """Discard ALL exported identities and inactive coordinates before splitting."""
    frames = np.zeros((len(poses), height, width), dtype=np.uint8)
    for frame, pose in zip(frames, poses):
        active = pose[pose[:, 2] != 0]
        frame[active[:, 1], active[:, 0]] = active[:, 2]
    return frames


def known_indices(length, stride):
    if length < 3 or stride < 2:
        raise ValueError("Need at least three poses and a stride >= 2")
    return sorted(set(range(0, length, stride)) | {length - 1})


def points_from(image, eye):
    mask = image == 3 if eye else (image > 0) & (image < 3)
    y, x = np.nonzero(mask)
    return np.column_stack((x, y)).astype(float), image[y, x]


def match_group(start, end, max_distance):
    """Sparse greedy nearest-neighbour assignment, one-to-one within a radius.

    This is intentionally a simple baseline, not global optimal transport.
    Tie-breaking is deterministic in raster order.
    """
    if not len(start) or not len(end):
        return np.empty(0, dtype=int), np.empty(0, dtype=int)
    k = min(8, len(end))
    distance, target = cKDTree(end).query(start, k=k, distance_upper_bound=max_distance + 1e-9)
    distance = distance.reshape(len(start), k).ravel()
    target = target.reshape(len(start), k).ravel()
    source = np.repeat(np.arange(len(start)), k)
    valid = np.isfinite(distance)
    distance, source, target = distance[valid], source[valid], target[valid]
    order = np.lexsort((target, source, distance))
    used_start = np.zeros(len(start), bool)
    used_end = np.zeros(len(end), bool)
    left, right = [], []
    for edge in order:
        a, b = source[edge], target[edge]
        if not used_start[a] and not used_end[b]:
            used_start[a] = used_end[b] = True
            left.append(a)
            right.append(b)
    return np.asarray(left, dtype=int), np.asarray(right, dtype=int)


def match_frames(a, b, max_distance=12.0):
    groups = []
    for eye in (False, True):
        p, p_shade = points_from(a, eye)
        q, q_shade = points_from(b, eye)
        left, right = match_group(p, q, max_distance)
        lost = np.ones(len(p), bool)
        born = np.ones(len(q), bool)
        lost[left] = False
        born[right] = False
        groups.append(Pair(p[left], q[right], p_shade[left], q_shade[right],
                           p[lost], p_shade[lost], q[born], q_shade[born]))
    return Pair(*(np.concatenate([getattr(group, name) for group in groups])
                  for name in Pair.__dataclass_fields__))


def endpoint_velocity(pair, adjacent, width, height, gap, adjacent_gap, at_start):
    """Recover neighbours using observed pixel coordinates, never exported IDs."""
    slope = (pair.end - pair.start) / gap
    if adjacent is None:
        return slope
    anchor = pair.start if at_start else pair.end
    key = adjacent.end if at_start else adjacent.start
    previous_slope = (adjacent.end - adjacent.start) / adjacent_gap
    lookup = np.full((height, width, 2), np.nan)
    xy = key.astype(int)
    lookup[xy[:, 1], xy[:, 0]] = previous_slope
    xy = anchor.astype(int)
    neighbour = lookup[xy[:, 1], xy[:, 0]]
    # Monotone componentwise limiter: no new extrema from cubic overshoot.
    same_sign = slope * neighbour > 0
    limited = np.sign(slope) * np.minimum(0.5 * (np.abs(neighbour) + np.abs(slope)),
                                         2 * np.minimum(np.abs(neighbour), np.abs(slope)))
    return np.where(np.isfinite(neighbour), np.where(same_sign, limited, 0), slope)


def cubic_path(pair, t, gap, tangents):
    a, b = tangents
    return ((2*t**3 - 3*t**2 + 1) * pair.start
            + (t**3 - 2*t**2 + t) * gap * a
            + (-2*t**3 + 3*t**2) * pair.end
            + (t**3 - t**2) * gap * b)


class DisplacementField:
    """Gaussian-smoothed displacement per interval, in each material group."""

    def __init__(self, points, displacement, width, height, cell):
        self.cell = cell
        shape = ((height + cell - 1)//cell, (width + cell - 1)//cell)
        xy = (points // cell).astype(int)
        count = np.zeros(shape)
        np.add.at(count, (xy[:, 1], xy[:, 0]), 1)
        self.weight = gaussian_filter(count, 1.0, mode="constant")
        components = []
        for component in displacement.T:
            grid = np.zeros(shape)
            np.add.at(grid, (xy[:, 1], xy[:, 0]), component)
            components.append(gaussian_filter(grid, 1.0, mode="constant"))
        self.components = components

    def sample(self, points, fallback):
        coords = (points / self.cell - 0.5).T[::-1]
        weight = map_coordinates(self.weight, coords, order=1, mode="nearest")
        numerator = np.column_stack([
            map_coordinates(component, coords, order=1, mode="nearest")
            for component in self.components])
        return np.divide(numerator, weight[:, None], out=fallback.copy(),
                         where=weight[:, None] >= 0.1)

    def advect(self, points, fallback, duration):
        # Midpoint integration of a stationary local displacement field.
        position = points.copy()
        dt = duration / 4
        for _ in range(4):
            midpoint = position + 0.5 * dt * self.sample(position, fallback)
            position += dt * self.sample(midpoint, fallback)
        return position


def build_fields(pair, width, height, cell):
    fields = []
    for eye in (False, True):
        mask = (pair.start_shade == 3) == eye
        delta = pair.end[mask] - pair.start[mask]
        fields.append((mask, DisplacementField(pair.start[mask], delta, width, height, cell),
                       DisplacementField(pair.end[mask], delta, width, height, cell)))
    return fields


def field_path(pair, t, fields):
    output = np.empty_like(pair.start)
    for mask, forward, backward in fields:
        if not mask.any():
            continue
        start, end = pair.start[mask], pair.end[mask]
        delta = end - start
        # Bi-directional advection blended to satisfy both observed endpoints.
        output[mask] = ((1-t) * forward.advect(start, delta, t)
                        + t * backward.advect(end, delta, -(1-t)))
    return output


def stable_subset(points, shades, fraction):
    """Common deterministic visibility schedule, not a learned mass model."""
    keep = int(np.floor(len(points) * fraction + 0.5))
    xy = points.astype(np.int64)
    score = (xy[:, 0] * 73856093) ^ (xy[:, 1] * 19349663)
    order = np.argsort(score, kind="stable")[:keep]
    return points[order], shades[order]


def render(pair, positions, t, width, height):
    lost, lost_shade = stable_subset(pair.lost, pair.lost_shade, 1-t)
    born, born_shade = stable_subset(pair.born, pair.born_shade, t)
    points = np.concatenate((positions, lost, born))
    shades = np.concatenate((pair.start_shade if t < 0.5 else pair.end_shade,
                             lost_shade, born_shade))
    xy = np.floor(points + 0.5).astype(int)
    inside = ((xy[:, 0] >= 0) & (xy[:, 0] < width)
              & (xy[:, 1] >= 0) & (xy[:, 1] < height))
    image = np.zeros((height, width), np.uint8)
    # Deterministic eye priority when rounded points collide.
    np.maximum.at(image, (xy[inside, 1], xy[inside, 0]), shades[inside])
    return image, {"planned": len(points), "outside": int((~inside).sum()),
                   "collisions": int(inside.sum() - np.count_nonzero(image))}


def reconstruct(observed, indices, length, cell=4, max_distance=12.0):
    """Only observed images and their times are accepted by this function."""
    if (len(observed) != len(indices) or len(indices) < 2
            or sorted(set(indices)) != list(indices)
            or indices[0] != 0 or indices[-1] != length-1):
        raise ValueError("Invalid observation indices")
    if cell < 1 or max_distance <= 0 or not np.isfinite(max_distance):
        raise ValueError("Invalid reconstruction parameters")
    height, width = observed.shape[1:]
    pairs = [match_frames(a, b, max_distance) for a, b in zip(observed[:-1], observed[1:])]
    gaps = np.diff(indices)
    result = {method: np.zeros((length, height, width), np.uint8) for method in METHODS}
    diagnostics = {method: {} for method in METHODS}
    for frames in result.values():
        frames[indices] = observed
    for i, pair in enumerate(pairs):
        start, end = indices[i:i+2]
        gap = gaps[i]
        if gap == 1:
            continue
        tangents = (
            endpoint_velocity(pair, pairs[i-1] if i else None, width, height, gap,
                              gaps[i-1] if i else gap, True),
            endpoint_velocity(pair, pairs[i+1] if i+1 < len(pairs) else None, width, height, gap,
                              gaps[i+1] if i+1 < len(pairs) else gap, False),
        )
        fields = build_fields(pair, width, height, cell)
        for index in range(start+1, end):
            t = (index-start)/gap
            paths = {"linear": (1-t)*pair.start + t*pair.end,
                     "cubic": cubic_path(pair, t, gap, tangents),
                     "field": field_path(pair, t, fields)}
            for method, positions in paths.items():
                result[method][index], diagnostics[method][index] = render(
                    pair, positions, t, width, height)
    return result, diagnostics
