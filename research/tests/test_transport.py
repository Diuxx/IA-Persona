"""Synthetic ground truth and leakage checks for sparse partial transport."""
import itertools
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reconstruction.core import match_group
from transport.assignment import partial_assignment
from transport.reconstruct import match_transport, reconstruct_transport
from optimal_transport import benchmark


def objective(p, q, left, right, radius):
    return float(np.sum((p[left]-q[right])**2)
                 + (len(p)+len(q)-2*len(left))*radius**2/2)


class TransportTests(unittest.TestCase):
    def test_global_assignment_beats_greedy(self):
        p = np.array([[0., 0.], [3., 0.]])
        q = np.array([[1., 0.], [-2., 0.]])
        left, right, _ = partial_assignment(p, q, radius=8, neighbours=2)
        greedy_left, greedy_right = match_group(p, q, 8)
        self.assertEqual(objective(p, q, left, right, 8), 8)
        self.assertLess(objective(p, q, left, right, 8),
                        objective(p, q, greedy_left, greedy_right, 8))

    def test_small_problem_matches_exhaustive_optimum(self):
        rng = np.random.default_rng(2026)
        for _ in range(10):
            p = rng.integers(0, 10, (3, 2)).astype(float)
            q = rng.integers(0, 10, (4, 2)).astype(float)
            radius = 5
            left, right, _ = partial_assignment(p, q, radius, neighbours=4)
            scores = []
            for count in range(4):
                for sources in itertools.combinations(range(len(p)), count):
                    for targets in itertools.permutations(range(len(q)), count):
                        scores.append(objective(p, q, np.array(sources, int),
                                                np.array(targets, int), radius))
            self.assertEqual(objective(p, q, left, right, radius), min(scores))

    def test_partial_mass_and_distance_limit(self):
        p = np.array([[0., 0.], [1., 1.], [20., 20.]])
        q = np.array([[0., 0.], [1., 1.], [40., 40.], [41., 41.]])
        left, right, _ = partial_assignment(p, q, radius=5)
        self.assertEqual(len(left), 2)
        self.assertEqual(len(set(left)), len(left))
        self.assertEqual(len(set(right)), len(right))

    def test_empty_groups(self):
        p = np.empty((0, 2))
        q = np.array([[1., 1.]])
        for start, end in ((p, q), (q, p), (p, p)):
            left, right, edges = partial_assignment(start, end)
            self.assertEqual(len(left), 0)
            self.assertEqual(len(right), 0)
            self.assertEqual(edges, 0)

    def test_temporal_cost_can_change_ambiguous_matching(self):
        p = np.array([[0., 0.], [2., 0.]])
        q = p.copy()
        prior = np.array([[2., 0.], [-2., 0.]])
        left, right, _ = partial_assignment(p, q, radius=8, prior=prior, temporal_weight=2)
        np.testing.assert_array_equal(q[right]-p[left], prior[left])

    def test_births_deaths_and_eye_body_are_separate(self):
        a = np.zeros((24, 24), np.uint8)
        b = a.copy()
        a[2, 2], a[4, 4], a[20, 20] = 3, 1, 2
        b[2, 3], b[4, 3], b[4, 5] = 3, 1, 2
        pair, report = match_transport(a, b, 3, 12)
        np.testing.assert_array_equal(pair.start_shade == 3, pair.end_shade == 3)
        for group, counts in report.items():
            self.assertEqual(counts["matched"] + counts["deaths"], counts["startPopulation"])
            self.assertEqual(counts["matched"] + counts["births"], counts["endPopulation"])
        self.assertEqual(report["body"]["births"], 1)
        self.assertEqual(report["body"]["deaths"], 1)

    def test_endpoints_and_translation(self):
        observed = np.zeros((3, 24, 24), np.uint8)
        observed[0, 8, 4] = observed[1, 8, 8] = observed[2, 8, 12] = 1
        prediction, diagnostics, intervals = reconstruct_transport(observed, [0, 2, 4], 5)
        for method, frames in prediction.items():
            np.testing.assert_array_equal(frames[[0, 2, 4]], observed)
            self.assertEqual(frames[1, 8, 6], 1)
            self.assertEqual(frames[3, 8, 10], 1)
            self.assertEqual(diagnostics[method][1]["collisions"], 0)
        self.assertEqual(intervals["temporal"][1]["body"]["linkedToPrevious"], 1)

    def test_no_hidden_data_leakage(self):
        reference = np.zeros((5, 32, 32), np.uint8)
        for i in range(5):
            reference[i, 8:18, 8+i:18+i] = 1
        changed = reference.copy()
        changed[1, 24, 24] = changed[3, 25, 25] = 3
        report_a, a = benchmark(reference, {"frameDurationMs": 40}, 2)
        report_b, b = benchmark(changed, {"frameDurationMs": 40}, 2)
        self.assertEqual(report_a["transportIntervals"], report_b["transportIntervals"])
        for name in a:
            np.testing.assert_array_equal(a[name], b[name])
            self.assertNotEqual(report_a["methods"][name]["mean"]["silhouetteIoU"],
                                report_b["methods"][name]["mean"]["silhouetteIoU"])
        json.dumps(report_a, allow_nan=False)

    def test_invalid_parameters(self):
        p = np.array([[0., 0.]])
        with self.assertRaises(ValueError):
            partial_assignment(p, p, radius=0)
        with self.assertRaises(ValueError):
            partial_assignment(p, p, neighbours=0)
        with self.assertRaises(ValueError):
            partial_assignment(p, p, temporal_weight=-1)


if __name__ == "__main__":
    unittest.main()
