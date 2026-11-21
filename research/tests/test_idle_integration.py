from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run import load_idle
from motion_fields import analyze


class IdleIntegrationTests(unittest.TestCase):
    def test_real_idle_contract(self):
        poses, regions, metadata = load_idle()
        self.assertEqual(poses.shape, (43, 16162, 3))
        self.assertEqual(metadata["frameDurationMs"], 40)
        self.assertEqual(len(metadata["regionNames"]), 11)
        self.assertEqual(regions.shape, (16162,))
        profile, arrays = analyze(poses, regions, metadata)
        self.assertEqual(profile["population"], {"min": 13623, "max": 16103})
        np.testing.assert_array_equal(arrays["density"].sum(axis=(1, 2)),
                                      (poses[..., 2] != 0).sum(axis=1))
        self.assertTrue(arrays["velocity_valid"][-1].any())
        self.assertFalse(np.isfinite(arrays["velocity"][~arrays["velocity_valid"]]).any())
