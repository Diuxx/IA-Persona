"""Partial transport and temporal regularization on observed raster poses."""
import numpy as np

from reconstruction.core import Pair, points_from, render, endpoint_velocity, cubic_path
from transport.assignment import partial_assignment

METHODS = ("transport_linear", "transport_temporal", "transport_cubic")


def previous_displacements(previous, points, shape, gap_ratio):
    prior = np.full(points.shape, np.nan)
    if previous is None or not len(previous.end):
        return prior
    lookup = np.full((*shape, 2), np.nan)
    x, y = previous.end.astype(int).T
    lookup[y, x] = (previous.end - previous.start) * gap_ratio
    x, y = points.astype(int).T
    return lookup[y, x]


def match_transport(a, b, radius, neighbours, previous=None, gap_ratio=1.0,
                    temporal_weight=0.0):
    groups, diagnostics = [], {}
    for eye in (False, True):
        p, ps = points_from(a, eye)
        q, qs = points_from(b, eye)
        prior = previous_displacements(previous, p, a.shape, gap_ratio) if temporal_weight else None
        left, right, edge_count = partial_assignment(
            p, q, radius, neighbours, prior, temporal_weight)
        lost = np.ones(len(p), bool)
        born = np.ones(len(q), bool)
        lost[left], born[right] = False, False
        pair = Pair(p[left], q[right], ps[left], qs[right],
                    p[lost], ps[lost], q[born], qs[born])
        groups.append(pair)
        delta = pair.end - pair.start
        squared_distance = float(np.sum(delta**2))
        temporal_cost = 0.0
        prior_count = 0
        if prior is not None:
            known = np.isfinite(prior[left]).all(axis=1)
            prior_count = int(known.sum())
            temporal_cost = float(temporal_weight * np.sum(
                (delta[known] - prior[left][known])**2))
        unmatched_cost = (len(pair.lost) + len(pair.born)) * radius**2 / 2
        diagnostics["eye" if eye else "body"] = {
            "startPopulation": len(p), "endPopulation": len(q),
            "matched": len(left), "births": len(pair.born), "deaths": len(pair.lost),
            "candidateEdges": edge_count,
            "zeroDisplacementMatches": int(np.all(delta == 0, axis=1).sum()),
            "meanDisplacementPx": float(np.linalg.norm(delta, axis=1).mean()) if len(left) else None,
            "transportCostPx2": squared_distance,
            "unmatchedCostPx2": unmatched_cost,
            "temporalCostPx2": temporal_cost,
            "linkedToPrevious": prior_count,
            "objectivePx2": squared_distance + unmatched_cost + temporal_cost,
        }
    return Pair(*(np.concatenate([getattr(group, key) for group in groups])
                  for key in Pair.__dataclass_fields__)), diagnostics


def build_pairs(observed, indices, radius, neighbours, temporal_weight):
    pairs, reports = [], []
    gaps = np.diff(indices)
    for i, (a, b) in enumerate(zip(observed[:-1], observed[1:])):
        ratio = gaps[i] / gaps[i-1] if i else 1.0
        pair, report = match_transport(a, b, radius, neighbours,
                                      pairs[-1] if i else None, ratio, temporal_weight)
        pairs.append(pair)
        reports.append({"start": indices[i]+1, "end": indices[i+1]+1, **report})
    return pairs, reports


def reconstruct_transport(observed, indices, length, radius=12.0, neighbours=12,
                          temporal_weight=0.5):
    if (len(observed) != len(indices) or len(indices) < 2
            or sorted(set(indices)) != list(indices)
            or indices[0] != 0 or indices[-1] != length-1):
        raise ValueError("Invalid observation indices")
    if not np.isfinite(temporal_weight) or temporal_weight < 0:
        raise ValueError("Invalid temporal weight")
    height, width = observed.shape[1:]
    spatial, spatial_reports = build_pairs(observed, indices, radius, neighbours, 0.0)
    temporal, temporal_reports = build_pairs(observed, indices, radius, neighbours, temporal_weight)
    gaps = np.diff(indices)
    predicted = {method: np.zeros((length, height, width), np.uint8) for method in METHODS}
    diagnostics = {method: {} for method in METHODS}
    for frames in predicted.values():
        frames[indices] = observed
    for i, (start, end) in enumerate(zip(indices[:-1], indices[1:])):
        if end-start == 1:
            continue
        pair = temporal[i]
        gap = gaps[i]
        tangents = (
            endpoint_velocity(pair, temporal[i-1] if i else None, width, height, gap,
                              gaps[i-1] if i else gap, True),
            endpoint_velocity(pair, temporal[i+1] if i+1 < len(temporal) else None,
                              width, height, gap, gaps[i+1] if i+1 < len(temporal) else gap, False),
        )
        for index in range(start+1, end):
            t = (index-start)/gap
            for method, matched, positions in (
                ("transport_linear", spatial[i], (1-t)*spatial[i].start + t*spatial[i].end),
                ("transport_temporal", pair, (1-t)*pair.start + t*pair.end),
                ("transport_cubic", pair, cubic_path(pair, t, gap, tangents)),
            ):
                predicted[method][index], diagnostics[method][index] = render(
                    matched, positions, t, width, height)
    return predicted, diagnostics, {"spatial": spatial_reports, "temporal": temporal_reports}
