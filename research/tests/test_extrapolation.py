"""Causal isolation, synthetic forecasts and evaluation invariants."""
import base64
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extrapolation.forecast import METHODS, forecast, damped_steps, rasterize
from extrapolation.evaluate import origins, evaluate_origin, aggregate
from extrapolate import encode_frames


def translation(length=13):
    frames = np.zeros((length, 32, 40), np.uint8)
    for i, frame in enumerate(frames):
        frame[10, 5+i] = 3
        frame[15, 5+i] = 1
    return frames


class ExtrapolationTests(unittest.TestCase):
    def test_origin_protocol(self):
        for length, expected in ((43, 9), (36, 7)):
            selected = origins(length)
            self.assertEqual(len(selected), expected)
            self.assertEqual(selected[0], 4)
            self.assertEqual(selected[-1]+8, length-1)
            self.assertTrue(all(i >= 4 and i+8 < length for i in selected))

    def test_known_translation(self):
        frames = translation()
        report, predicted = evaluate_origin(frames, 4, 8)
        self.assertEqual(report["observed"], [1, 2, 3, 4, 5])
        self.assertEqual(report["future"], list(range(6, 14)))
        for method in ("centroid", "particle_velocity", "transport_velocity"):
            np.testing.assert_array_equal(predicted[method], frames[5:])
            self.assertTrue(all(score["silhouetteIoU"] == 1
                                for score in report["scores"][method]))
        np.testing.assert_array_equal(predicted["hold"],
                                      np.repeat(frames[4:5], 8, axis=0))

    def test_hidden_future_cannot_affect_any_forecast(self):
        original = translation()
        edited = original.copy()
        edited[5:] = 0
        a, pred_a = evaluate_origin(original, 4, 8)
        b, pred_b = evaluate_origin(edited, 4, 8)
        self.assertEqual(a["estimatedMotion"], b["estimatedMotion"])
        for method in METHODS:
            np.testing.assert_array_equal(pred_a[method], pred_b[method])
        self.assertNotEqual(a["scores"]["centroid"], b["scores"]["centroid"])

    def test_earlier_frames_outside_window_cannot_affect_forecast(self):
        frames = translation(17)
        edited = frames.copy()
        edited[:4] = 0
        _, a = evaluate_origin(frames, 8, 8)
        _, b = evaluate_origin(edited, 8, 8)
        for method in METHODS:
            np.testing.assert_array_equal(a[method], b[method])

    def test_horizon_prefix_invariant(self):
        history = translation()[:5]
        short, _, _ = forecast(history, 2)
        long, _, _ = forecast(history, 8)
        for method in METHODS:
            np.testing.assert_array_equal(short[method], long[method][:2])

    def test_damping_is_sublinear(self):
        self.assertEqual(damped_steps(1), 1)
        self.assertLess(damped_steps(8), 8)
        self.assertGreater(damped_steps(8), damped_steps(4))

    def test_raster_collision_and_boundary(self):
        image, stats = rasterize(np.array([[1., 1.], [1., 1.], [-1., 0.]]),
                                  np.array([1, 3, 2], np.uint8), (4, 4))
        self.assertEqual(image[1, 1], 3)
        self.assertEqual(stats, {"planned": 3, "outside": 1, "collisions": 1})

    def test_empty_history(self):
        result, _, _ = forecast(np.zeros((5, 8, 8), np.uint8), 3)
        self.assertFalse(any(frames.any() for frames in result.values()))

    def test_static_history(self):
        history = np.zeros((5, 12, 12), np.uint8)
        history[:, 3:7, 3:7] = 1
        history[:, 4, 4] = 3
        result, _, _ = forecast(history, 3)
        for frames in result.values():
            np.testing.assert_array_equal(frames, np.repeat(history[-1:], 3, axis=0))

    def test_shape_population_can_change(self):
        history = np.zeros((5, 32, 32), np.uint8)
        for i in range(5):
            history[i, 10-i:15+i, 10-i:15+i] = 1
        predicted, _, _ = forecast(history, 4)
        self.assertGreater(np.count_nonzero(predicted["shape_trend"][-1]),
                           np.count_nonzero(history[-1]))

    def test_horizon_summary_and_json(self):
        a, _ = evaluate_origin(translation(17), 4, 8)
        b, _ = evaluate_origin(translation(17), 8, 8)
        scores = aggregate([a, b], 8)
        self.assertEqual(scores["hold"]["mean"]["iouGainVsHold"], 0)
        self.assertEqual(scores["centroid"]["mean"]["samples"], 16)
        self.assertEqual(scores["centroid"]["byHorizon"]["8"]["samples"], 2)
        self.assertEqual(scores["centroid"]["mean"]["silhouetteIoU"], 1)
        self.assertIsNone(scores["shape_trend"]["mean"]["collisions"])
        json.dumps(scores, allow_nan=False)

    def test_lossless_viewer_encoding(self):
        frame = np.array([[0, 1, 2], [3, 2, 1]], np.uint8)
        encoded = base64.b64decode(encode_frames([frame])[0])
        values = [(encoded[i//4] >> (2*(i%4))) & 3 for i in range(frame.size)]
        np.testing.assert_array_equal(values, frame.ravel())

    def test_invalid_window(self):
        with self.assertRaises(ValueError):
            origins(8)
        with self.assertRaises(ValueError):
            forecast(translation()[:4], 8)
        with self.assertRaises(ValueError):
            evaluate_origin(translation(), 10, 8)


if __name__ == "__main__":
    unittest.main()
