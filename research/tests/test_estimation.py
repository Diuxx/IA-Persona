import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from estimation.clips import load_reference
from estimation.flow import estimate_flow, consistent_displacement
from estimation.guided import guided_match, flow_path, reconstruct_guided
from estimate import benchmark


class OpticalFlowTests(unittest.TestCase):
    def test_known_translation_on_textured_patch(self):
        rng = np.random.default_rng(2026)
        a = np.zeros((96, 96), np.uint8)
        a[24:64, 24:64] = rng.integers(1, 4, size=(40, 40))
        b = np.zeros_like(a)
        b[27:67, 29:69] = a[24:64, 24:64]
        f, r = estimate_flow(a, b)
        y, x = np.mgrid[32:56, 32:56]
        points = np.column_stack((x.ravel(), y.ravel())).astype(float)
        displacement, accepted, _ = consistent_displacement(f, r, points)
        self.assertGreater(accepted.mean(), .8)
        np.testing.assert_allclose(np.median(displacement[accepted], axis=0),
                                   [5, 3], atol=.7)

    def test_consistency_and_outside_rejection(self):
        f = np.zeros((12, 12, 2), np.float32)
        f[..., 0] = 3
        b = -f
        points = np.array([[2., 2.], [11., 2.]])
        delta, accepted, error = consistent_displacement(f, b, points)
        np.testing.assert_array_equal(accepted, [True, False])
        np.testing.assert_array_equal(delta, [[3, 0], [0, 0]])
        self.assertEqual(error[0], 0)
        _, accepted, _ = consistent_displacement(f, f, points)
        self.assertFalse(accepted.any())

    def test_guided_matching_and_endpoints(self):
        a = np.zeros((20, 20), np.uint8)
        b = a.copy()
        a[5, 4:7] = b[5, 8:11] = 1
        a[9, 4] = b[9, 8] = 3
        f = np.zeros((20, 20, 2), np.float32)
        f[..., 0] = 4
        pair, report = guided_match(a, b, f, -f, 1)
        self.assertEqual(len(pair.start), 4)
        np.testing.assert_array_equal(pair.end - pair.start, [[4, 0]]*4)
        np.testing.assert_array_equal(pair.start_shade == 3, pair.end_shade == 3)
        np.testing.assert_allclose(flow_path(pair, f, -f, 0), pair.start)
        np.testing.assert_allclose(flow_path(pair, f, -f, 1), pair.end)
        np.testing.assert_allclose(flow_path(pair, f, -f, .5), pair.start + [2, 0])
        self.assertEqual(report["body"]["matched"], 3)
        self.assertEqual(report["body"]["baselineMatched"], 0)

    def test_empty_raster(self):
        observed = np.zeros((2, 24, 24), np.uint8)
        result, diag, intervals = reconstruct_guided(observed, [0, 2], 3)
        self.assertFalse(any(frames.any() for frames in result.values()))
        self.assertEqual(diag["guided_flow"][1]["planned"], 0)
        self.assertIsNone(intervals[0]["eye"]["meanConsistencyErrorPx"])

    def test_hidden_frames_cannot_change_predictions(self):
        reference = np.zeros((5, 40, 40), np.uint8)
        for i in range(5):
            reference[i, 8:20, 8+i:20+i] = 1
        edited = reference.copy()
        edited[1, 30, 30] = 3
        edited[3, 29, 29] = 2
        a, pred_a = benchmark(reference, {"frameDurationMs": 40}, 2)
        b, pred_b = benchmark(edited, {"frameDurationMs": 40}, 2)
        self.assertEqual(a["flowIntervals"], b["flowIntervals"])
        for method in pred_a:
            np.testing.assert_array_equal(pred_a[method], pred_b[method])
            self.assertNotEqual(a["methods"][method]["mean"]["silhouetteIoU"],
                                b["methods"][method]["mean"]["silhouetteIoU"])
        json.dumps(a, allow_nan=False)

    def test_real_clip_rasters(self):
        for name in ("idle", "left", "right"):
            with self.subTest(name=name):
                frames, metadata = load_reference(name)
                expected = (43, 200, 200) if name == "idle" else (36, 400, 400)
                self.assertEqual(frames.shape, expected)
                self.assertEqual(metadata["frameDurationMs"], 40 if name == "idle" else 60)
                counts = np.count_nonzero(frames, axis=(1, 2))
                self.assertEqual((int(counts.min()), int(counts.max())),
                                 (13623, 16103) if name == "idle" else (16079, 23311))
                self.assertTrue(np.isin(frames, [0, 1, 2, 3]).all())
