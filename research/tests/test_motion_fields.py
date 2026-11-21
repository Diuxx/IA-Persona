import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motion_fields import analyze, local_field, spatial_gradient, trajectories


class MotionFieldsTests(unittest.TestCase):
    def test_constant_velocity(self):
        positions = np.array([[[0., 0.]], [[2., 0.]], [[4., 0.]], [[6., 0.]]])
        data = trajectories(positions, np.ones((4, 1), bool), 0.5, False)
        np.testing.assert_allclose(data["velocity"][:3, 0], [[4, 0]] * 3)
        np.testing.assert_allclose(data["acceleration"][:2, 0], 0)
        np.testing.assert_allclose(data["jerk"][0, 0], 0)
        self.assertTrue(np.isnan(data["velocity"][-1]).all())

    def test_visibility_breaks_derivatives(self):
        positions = np.zeros((4, 1, 2))
        visible = np.array([[True], [False], [True], [True]])
        data = trajectories(positions, visible, 1, False)
        self.assertEqual(data["velocity_valid"][:, 0].tolist(), [False, False, True, False])
        self.assertFalse(data["acceleration_valid"].any())

    def test_loop_seam(self):
        positions = np.array([[[0., 0.]], [[1., 0.]], [[2., 0.]]])
        data = trajectories(positions, np.ones((3, 1), bool), 1, True)
        np.testing.assert_allclose(data["velocity"][-1, 0], [-2, 0])

    def test_gradient_and_missing_neighbours(self):
        y, x = np.mgrid[:7, :7]
        support = np.ones(x.shape, bool)
        dx, dy = spatial_gradient(2. * x + 3. * y, support, 1)
        np.testing.assert_allclose(dx[1:-1, 1:-1], 2)
        np.testing.assert_allclose(dy[1:-1, 1:-1], 3)
        support[3, 4] = False
        dx, _ = spatial_gradient(x.astype(float), support, 1)
        self.assertTrue(np.isnan(dx[3, 3]))

    def test_translation_field(self):
        y, x = np.mgrid[:24, :24]
        points = np.column_stack((x.ravel(), y.ravel()))
        velocity = np.tile([3., -4.], (len(points), 1))
        field, residual = local_field(points, velocity, points, 24, 24)
        for name in ("divergence", "curl", "strain_rate"):
            self.assertTrue(np.isfinite(field[name]).any())
            np.testing.assert_allclose(field[name][np.isfinite(field[name])], 0, atol=1e-10)
        np.testing.assert_allclose(residual[np.isfinite(residual)], 0, atol=1e-10)
        self.assertEqual(field["density"].sum(), len(points))

    def test_empty_field_is_not_zero_velocity(self):
        empty = np.empty((0, 2))
        field, residual = local_field(empty, empty, empty, 8, 8)
        self.assertTrue(np.isnan(field["vx"]).all())
        self.assertEqual(residual.size, 0)

    def test_profile_population_and_json(self):
        poses = np.array([[[1, 1, 1], [2, 2, 0]], [[2, 1, 1], [2, 2, 2]]], dtype=np.uint8)
        metadata = {"width": 8, "height": 8, "frameDurationMs": 40,
                    "loop": True, "regionNames": ["body"], "frameCount": 2}
        profile, arrays = analyze(poses, np.array([0, 0]), metadata)
        self.assertEqual(profile["population"], {"min": 1, "max": 2})
        self.assertEqual(profile["frames"][0]["appearing"], 1)
        self.assertEqual(profile["frames"][1]["disappearing"], 1)
        self.assertEqual(arrays["density"].sum(axis=(1, 2)).tolist(), [1, 2])
        json.dumps(profile, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
