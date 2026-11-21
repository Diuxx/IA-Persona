"""Sparse discrete partial optimal transport with explicit birth/death costs."""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import min_weight_full_bipartite_matching
from scipy.spatial import cKDTree


def nearest_edges(start, end, radius, neighbours):
    k = min(neighbours, len(end))
    distances, targets = cKDTree(end).query(start, k=k, distance_upper_bound=radius + 1e-9)
    sources = np.repeat(np.arange(len(start)), k)
    valid = np.isfinite(distances.ravel())
    return sources[valid], targets.ravel()[valid]


def candidate_edges(start, end, radius, neighbours):
    """Union of both nearest-neighbour directions; no dense cost matrix."""
    left, right = nearest_edges(start, end, radius, neighbours)
    reverse_right, reverse_left = nearest_edges(end, start, radius, neighbours)
    codes = np.unique(np.concatenate((left * len(end) + right,
                                     reverse_left * len(end) + reverse_right)))
    return codes // len(end), codes % len(end)


def partial_assignment(start, end, radius=12.0, neighbours=12,
                       prior=None, temporal_weight=0.0):
    """Minimize transport cost plus penalties for unmatched unit masses.

    Each source has a private dummy destination (death); an unused real
    destination is a birth. Equal birth/death penalties are radius²/2.
    The constant cost of all births can be subtracted: real edges cost
    distance² (+ temporal penalty), dummy edges cost radius².
    The solution is exact on this restricted sparse graph, not unrestricted OT.
    """
    if (not np.isfinite(radius) or radius <= 0 or not isinstance(neighbours, int)
            or neighbours < 1 or not np.isfinite(temporal_weight) or temporal_weight < 0):
        raise ValueError("Invalid transport parameters")
    if start.ndim != 2 or end.ndim != 2 or start.shape[1:] != (2,) or end.shape[1:] != (2,):
        raise ValueError("Expected point arrays of shape (n, 2)")
    if not np.isfinite(start).all() or not np.isfinite(end).all():
        raise ValueError("Non-finite point coordinates")
    if prior is not None and prior.shape != start.shape:
        raise ValueError("Invalid displacement prior")
    n, m = len(start), len(end)
    if not n or not m:
        return np.empty(0, dtype=int), np.empty(0, dtype=int), 0
    left, right = candidate_edges(start, end, radius, neighbours)
    displacement = end[right] - start[left]
    cost = np.einsum("ij,ij->i", displacement, displacement)
    if prior is not None and temporal_weight:
        expected = prior[left]
        known = np.isfinite(expected).all(axis=1)
        residual = displacement[known] - expected[known]
        cost[known] += temporal_weight * np.einsum("ij,ij->i", residual, residual)
    # Edges no better than two independent birth/death events are unnecessary.
    useful = cost < radius**2
    rows = np.concatenate((left[useful], np.arange(n)))
    cols = np.concatenate((right[useful], m + np.arange(n)))
    # SciPy's sparse matcher treats explicit zero weights as absent edges.
    # Adding a constant to every edge preserves the full-assignment optimum.
    weights = np.concatenate((cost[useful], np.full(n, radius**2))) + 1.0
    graph = coo_matrix((weights, (rows, cols)), shape=(n, m+n)).tocsr()
    row_ids, col_ids = min_weight_full_bipartite_matching(graph)
    matched = col_ids < m
    return row_ids[matched], col_ids[matched], int(useful.sum())
