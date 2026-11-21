import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reconstruction.core import (
    METHODS, DisplacementField, known_indices, match_frames,
    rasterize_reference, reconstruct,
)
from reconstruction.evaluate import score_frame, evaluate
from reconstruct import benchmark


class ReconstructionTests(unittest.TestCase):
    def test_split_counts(self):
        self.assertEqual([len(known_indices(43, s)) for s in (2, 3, 4)], [22, 15, 12])

    def test_raster_ignores_ids_and_inactive_positions(self):
        a = np.array([[[2, 3, 1], [4, 5, 0], [1, 1, 3]]], np.uint8)
        b = a[:, ::-1].copy()
        b[0, 1, :2] = [0, 0]
        np.testing.assert_array_equal(rasterize_reference(a, 8, 8), rasterize_reference(b, 8, 8))

    def test_matching_is_unique_and_material_aware(self):
        a = np.zeros((10, 10), np.uint8)
        b = a.copy()
        a[2, 2], a[2, 3], a[7, 7] = 1, 2, 3
        b[2, 3], b[2, 4], b[7, 8] = 2, 1, 3
        pair = match_frames(a, b)
        self.assertEqual(len(pair.start), 3)
        self.assertEqual(len(np.unique(pair.end, axis=0)), 3)
        np.testing.assert_array_equal(pair.start_shade == 3, pair.end_shade == 3)

    def test_matching_radius_leaves_unmatched_mass(self):
        a = np.zeros((16, 16), np.uint8)
        b = a.copy()
        a[0, 0], b[15, 15] = 1, 1
        pair = match_frames(a, b, 2)
        self.assertEqual(len(pair.start), 0)
        self.assertEqual(len(pair.lost), 1)
        self.assertEqual(len(pair.born), 1)

    def test_constant_field_advection(self):
        y, x = np.mgrid[2:14, 2:14]
        points = np.column_stack((x.ravel(), y.ravel())).astype(float)
        displacement = np.tile([2., -1.], (len(points), 1))
        field = DisplacementField(points, displacement, 20, 20, 2)
        np.testing.assert_allclose(field.advect(points, displacement, 0.5),
                                   points + 0.5*displacement, atol=1e-10)

    def test_translation_midpoint_and_known_endpoints(self):
        observed = np.zeros((2, 16, 16), np.uint8)
        observed[0, 5, 4] = 1
        observed[1, 5, 8] = 1
        result, diagnostics = reconstruct(observed, [0, 2], 3)
        for name in METHODS:
            np.testing.assert_array_equal(result[name][[0, 2]], observed)
            self.assertEqual(result[name][1, 5, 6], 1)
            self.assertEqual(diagnostics[name][1]["collisions"], 0)

    def test_variable_population(self):
        observed = np.zeros((2, 12, 12), np.uint8)
        observed[0, 1, 1] = 1
        observed[1, 1, 1] = observed[1, 8, 8] = observed[1, 9, 8] = 1
        result, diagnostics = reconstruct(observed, [0, 2], 3, max_distance=2)
        for name in METHODS:
            self.assertEqual(diagnostics[name][1]["planned"], 2)
            self.assertEqual(np.count_nonzero(result[name][1]), 2)

    def test_empty_observations_are_valid(self):
        observed = np.zeros((2, 8, 8), np.uint8)
        result, _ = reconstruct(observed, [0, 2], 3)
        self.assertFalse(any(frames.any() for frames in result.values()))

    def test_hidden_changes_cannot_change_predictions(self):
        reference = np.zeros((5, 12, 12), np.uint8)
        reference[:, 4, 3:6] = 1
        changed = reference.copy()
        changed[1, 8, 8] = 3
        changed[3, 1, 1] = 2
        metadata = {"frameDurationMs": 40}
        report_a, a = benchmark(reference, metadata, 2, 4, 12)
        report_b, b = benchmark(changed, metadata, 2, 4, 12)
        for name in METHODS:
            np.testing.assert_array_equal(a[name], b[name])
            self.assertNotEqual(report_a["methods"][name]["mean"]["silhouetteIoU"],
                                report_b["methods"][name]["mean"]["silhouetteIoU"])

    def test_metrics_and_json(self):
        reference = np.zeros((5, 5), np.uint8)
        reference[2, 2] = 3
        prediction = np.zeros_like(reference)
        prediction[2, 3] = 3
        score = score_frame(reference, prediction, {})
        self.assertEqual(score["silhouetteIoU"], 0)
        self.assertEqual(score["eyeIoU"], 0)
        self.assertEqual(score["symmetricDistancePx"], 1)
        self.assertEqual(score["populationError"], 0)
        identical = score_frame(reference, reference, {})
        self.assertEqual(identical["silhouetteIoU"], 1)
        json.dumps(identical, allow_nan=False)

    def test_evaluation_ignores_observed_frames(self):
        reference = np.zeros((3, 5, 5), np.uint8)
        reference[:, 1, 1] = 1
        predicted = reference.copy()
        predicted[0, 1, 1] = 0
        predicted[2, 1, 1] = 0
        report = evaluate(reference, predicted, [1], {1: {"collisions": 0, "outside": 0}}, .04)
        self.assertEqual(report["mean"]["silhouetteIoU"], 1)
        self.assertEqual(list(report["frames"]), ["2"])


if __name__ == "__main__":
    unittest.main()
