"""Ablation: optical-flow-guided matching and bidirectional flow trajectories."""
import numpy as np

from reconstruction.core import Pair, match_group, points_from, render
from estimation.flow import estimate_flow, consistent_displacement, sample

METHODS = ("guided_linear", "guided_flow")


def guided_match(a, b, forward, backward, radius):
    groups = []
    diagnostics = {}
    for eye in (False, True):
        p, ps = points_from(a, eye)
        q, qs = points_from(b, eye)
        motion, accepted, error = consistent_displacement(forward, backward, p)
        # Match around the estimated arrival, not around the original coordinate.
        left, right = match_group(p + motion, q, radius)
        lost = np.ones(len(p), bool)
        born = np.ones(len(q), bool)
        lost[left], born[right] = False, False
        groups.append(Pair(p[left], q[right], ps[left], qs[right],
                           p[lost], ps[lost], q[born], qs[born]))
        diagnostics["eye" if eye else "body"] = {
            "observedStart": len(p), "observedEnd": len(q),
            "matched": len(left), "acceptedFlow": int(accepted.sum()),
            "meanConsistencyErrorPx": float(error.mean()) if len(error) else None,
            "meanFlowMagnitudePx": float(np.linalg.norm(motion, axis=1).mean()) if len(p) else None,
            "zeroDisplacementMatches": int(np.all(p[left] == q[right], axis=1).sum()),
        }
    pair = Pair(*(np.concatenate([getattr(group, key) for group in groups])
                  for key in Pair.__dataclass_fields__))
    return pair, diagnostics


def flow_path(pair, forward, backward, t):
    """Blend paths initiated from both anchors, with reliable-flow fallback."""
    delta = pair.end - pair.start
    f, accepted_f, _ = consistent_displacement(forward, backward, pair.start)
    b, accepted_b, _ = consistent_displacement(backward, forward, pair.end)
    f = np.where(accepted_f[:, None], f, delta)
    b = np.where(accepted_b[:, None], b, -delta)
    return ((1-t)*(pair.start + t*f) + t*(pair.end + (1-t)*b))


def reconstruct_guided(observed, indices, length, radius=12.0):
    if (len(observed) != len(indices) or len(indices) < 2
            or sorted(set(indices)) != list(indices)
            or indices[0] != 0 or indices[-1] != length-1
            or not np.isfinite(radius) or radius <= 0):
        raise ValueError("Invalid observation indices or radius")
    height, width = observed.shape[1:]
    predicted = {name: np.zeros((length, height, width), np.uint8) for name in METHODS}
    diagnostics = {name: {} for name in METHODS}
    interval_reports = []
    for frames in predicted.values():
        frames[indices] = observed
    for i, (start, end) in enumerate(zip(indices[:-1], indices[1:])):
        if end-start == 1:
            continue
        a, b = observed[i:i+2]
        forward, backward = estimate_flow(a, b)
        pair, report = guided_match(a, b, forward, backward, radius)
        interval_reports.append({"start": start+1, "end": end+1, **report})
        for index in range(start+1, end):
            t = (index-start)/(end-start)
            paths = {"guided_linear": (1-t)*pair.start + t*pair.end,
                     "guided_flow": flow_path(pair, forward, backward, t)}
            for name, path in paths.items():
                predicted[name][index], diagnostics[name][index] = render(pair, path, t, width, height)
    return predicted, diagnostics, interval_reports
