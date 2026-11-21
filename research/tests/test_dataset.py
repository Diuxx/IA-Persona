"""Dataset geometry, causality, family isolation and reader contracts."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_dataset import build, load_registered_source, REGISTRY
from dataset.core import (build_clip, scene_rasters, validate_registry,
                          window_starts, HISTORY, HORIZON)
from dataset.reader import MotionDataset, TRANSITIONS


def translation(length=15):
    frames = np.zeros((length, 20, 40), np.uint8)
    for i, frame in enumerate(frames):
        frame[7, 5+i] = 3
        frame[11, 5+i] = 1
    return frames


def registry():
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


class DatasetTests(unittest.TestCase):
    def test_registry_keeps_mirror_family_together(self):
        r = registry()
        self.assertEqual(validate_registry(r), {"idle": "train", "locomotion": "development"})
        r["splits"]["test"].append("locomotion")
        with self.assertRaises(ValueError):
            validate_registry(r)

    def test_mirror_cannot_be_assigned_different_family(self):
        r = registry()
        r["clips"][2]["family"] = "right-only"
        r["splits"]["test"] = ["right-only"]
        with self.assertRaises(ValueError):
            validate_registry(r)

    def test_native_padding_preserves_all_pixels(self):
        original = translation()
        padded, offset = scene_rasters(original)
        self.assertEqual(offset, [180, 190])
        self.assertEqual(padded.shape, (15, 400, 400))
        np.testing.assert_array_equal(padded[:, 190:210, 180:220], original)
        np.testing.assert_array_equal(np.count_nonzero(padded, axis=(1, 2)),
                                      np.count_nonzero(original, axis=(1, 2)))

    def test_density_and_velocity_units(self):
        arrays, _ = build_clip(translation(), 40)
        self.assertEqual(arrays["density"].shape, (15, 2, 100, 100))
        self.assertEqual(arrays["velocity"].shape, (15, 2, 100, 100, 2))
        np.testing.assert_array_equal(arrays["density"].sum(axis=(2, 3)), np.ones((15, 2)))
        self.assertFalse(arrays["transition_valid"][0])
        valid = arrays["matched"] > 0
        np.testing.assert_allclose(arrays["velocity"][valid],
                                   np.tile([25., 0.], (valid.sum(), 1)))
        self.assertFalse(arrays["births"].any())
        self.assertFalse(arrays["deaths"].any())
        self.assertAlmostEqual(arrays["time_seconds"][1], .04)

    def test_unmatched_population_conservation(self):
        frames = translation()
        frames[1, 1, 1] = 1
        arrays, _ = build_clip(frames, 60)
        self.assertEqual(arrays["births"][1].sum(), 1)
        self.assertEqual(arrays["deaths"][2].sum(), 1)

    def test_future_cannot_change_observed_features(self):
        original = translation()
        edited = original.copy()
        edited[5:] = 0
        a, _ = build_clip(original, 40)
        b, _ = build_clip(edited, 40)
        for key in a:
            np.testing.assert_array_equal(a[key][:5], b[key][:5])

    def test_windows(self):
        self.assertEqual(len(list(window_starts(43))), 31)
        self.assertEqual(len(list(window_starts(36))), 24)
        self.assertEqual(len(list(window_starts(12))), 0)

    def test_invalid_source(self):
        with self.assertRaises(ValueError):
            build_clip(translation(), 0)
        with self.assertRaises(ValueError):
            scene_rasters(np.ones((13, 401, 20), np.uint8))
        with self.assertRaises(ValueError):
            scene_rasters(np.full((13, 10, 10), 4, np.uint8))

    def test_external_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            np.savez_compressed(root/"jump.npz", rasters=translation(),
                                frame_duration_ms=50.)
            frames, meta = load_registered_source("npz:jump.npz", root/"clips.json")
            np.testing.assert_array_equal(frames, translation())
            self.assertEqual(meta["frameDurationMs"], 50.)
            self.assertFalse(meta["loop"])

    def test_reader_boundaries_split_and_checksum(self):
        frames = translation()
        r = {"schemaVersion": 1,
             "clips": [{"id": "demo", "source": "idle", "action": "test",
                        "family": "demo", "mirrorOf": None}],
             "splits": {"train": ["demo"], "development": [], "test": []}}
        meta = {"width": 40, "height": 20, "frameDurationMs": 40,
                "loop": False, "sourceSha256": {}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch("build_dataset.load_registered_source", return_value=(frames, meta)), patch("build_dataset.preview"):
                manifest = build(root, r)
            self.assertFalse(manifest["independentTestAvailable"])
            self.assertEqual(len(MotionDataset(root, "test")), 0)
            dataset = MotionDataset(root, "train")
            self.assertEqual(len(dataset), 3)
            sample = dataset[2]
            self.assertEqual(sample["inputs"]["rasters"].shape, (HISTORY, 400, 400))
            self.assertEqual(sample["targets"]["rasters"].shape, (HORIZON, 400, 400))
            for key in TRANSITIONS:
                self.assertFalse(sample["inputs"][key][0].any())
            self.assertTrue(sample["inputs"]["transition_valid"][1:].all())
            self.assertTrue(sample["targets"]["transition_valid"].all())
            self.assertAlmostEqual(sample["inputs"]["time_seconds"][-1], 0)
            self.assertAlmostEqual(sample["targets"]["time_seconds"][0], .04)
            padded, _ = scene_rasters(frames)
            np.testing.assert_array_equal(sample["inputs"]["rasters"], padded[2:7])
            np.testing.assert_array_equal(sample["targets"]["rasters"], padded[7:15])
            sample["inputs"]["rasters"][:] = 0
            np.testing.assert_array_equal(dataset[2]["inputs"]["rasters"], padded[2:7])
            (root/"demo.npz").write_bytes(b"corrupt")
            with self.assertRaises(ValueError):
                MotionDataset(root, "train")[0]

    def test_exact_mirror_rejected_across_families(self):
        r = {"schemaVersion": 1, "clips": [
            {"id": "a", "source": "idle", "action": "a", "family": "a"},
            {"id": "b", "source": "left", "action": "b", "family": "b"}],
            "splits": {"train": ["a"], "development": ["b"], "test": []}}
        frames = translation()
        meta = {"width": 40, "height": 20, "frameDurationMs": 40,
                "loop": False, "sourceSha256": {}}
        with tempfile.TemporaryDirectory() as folder:
            with patch("build_dataset.load_registered_source", side_effect=[(frames, meta), (frames[:, :, ::-1], meta)]), patch("build_dataset.preview"):
                with self.assertRaisesRegex(ValueError, "mirrored"):
                    build(Path(folder), r)


if __name__ == "__main__":
    unittest.main()
