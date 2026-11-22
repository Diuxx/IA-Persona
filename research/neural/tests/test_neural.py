"""Optional PyTorch tests; run separately from the dependency-free motion lab tests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from dataset.core import HISTORY, HORIZON, sha256
from neural.model import MotionForecaster, encode_observations, INPUT_CHANNELS, motion_loss, predict
from neural.training import LearningWindows, seed_everything, train_step
from neural.evaluation import score_predictions, aggregate
from neural.checkpoint import load_model


def synthetic(side=32):
    h = side//4
    observed = {
        "rasters": torch.zeros((1, HISTORY, side, side), dtype=torch.uint8),
        "density": torch.zeros((1, HISTORY, 2, h, h), dtype=torch.uint8),
        "matched": torch.zeros((1, HISTORY, 2, h, h), dtype=torch.uint8),
        "births": torch.zeros((1, HISTORY, 2, h, h), dtype=torch.uint8),
        "deaths": torch.zeros((1, HISTORY, 2, h, h), dtype=torch.uint8),
        "velocity": torch.zeros((1, HISTORY, 2, h, h, 2), dtype=torch.float32),
        "transition_valid": torch.tensor([[False, True, True, True, True]]),
        "time_seconds": torch.arange(-4, 1, dtype=torch.float64)[None]*.04,
    }
    expected = torch.zeros((1, HORIZON, side, side), dtype=torch.uint8)
    for i in range(HISTORY):
        observed["rasters"][0, i, 6:14, 5+i:13+i] = 1
        observed["rasters"][0, i, 8, 8+i] = 3
    for i in range(HORIZON):
        expected[0, i, 6:14, 10+i:18+i] = 1
        expected[0, i, 8, 13+i] = 3
    return observed, expected


class NeuralTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)

    def setUp(self):
        seed_everything(2026)

    def test_patch_shape_and_channel_count(self):
        observed, _ = synthetic()
        encoded = encode_observations(observed)
        self.assertEqual(tuple(encoded.shape), (1, INPUT_CHANNELS, 8, 8))
        self.assertTrue(torch.isfinite(encoded).all())
        self.assertEqual(INPUT_CHANNELS, 310)

    def test_initial_prediction_is_exact_hold(self):
        observed, expected = synthetic()
        model = MotionForecaster(8)
        logits = model(observed)
        self.assertEqual(tuple(logits.shape), (1, HORIZON, 4, 32, 32))
        actual = predict(model, observed)
        torch.testing.assert_close(actual, observed["rasters"][:, -1:].expand_as(expected))

    def test_full_resolution(self):
        observed, _ = synthetic(400)
        result = predict(MotionForecaster(8), observed)
        self.assertEqual(tuple(result.shape), (1, 8, 400, 400))
        self.assertEqual(result.dtype, torch.uint8)

    def test_learning_decreases_loss(self):
        observed, expected = synthetic()
        model = MotionForecaster(8)
        optimizer = torch.optim.AdamW(model.parameters(), lr=.01)
        with torch.no_grad():
            initial = motion_loss(model(observed), expected, observed["rasters"][:, -1]).item()
        for _ in range(24):
            train_step(model, optimizer, (observed, expected), torch.device("cpu"))
        with torch.no_grad():
            final = motion_loss(model(observed), expected, observed["rasters"][:, -1]).item()
        self.assertLess(final, initial)

    def test_adapter_keeps_targets_out_of_inputs(self):
        observed, expected = synthetic()
        sample = {"inputs": {key: value[0].numpy() for key, value in observed.items()},
                  "targets": {"rasters": expected[0].numpy(), "velocity": np.ones((8, 2, 8, 8, 2))}}
        actual, target = LearningWindows([sample])[0]
        self.assertEqual(set(actual), set(observed))
        torch.testing.assert_close(target, expected[0])
        model = MotionForecaster(8)
        a = predict(model, {k: v[None] for k, v in actual.items()})
        sample["targets"]["rasters"][:] = 0
        actual, _ = LearningWindows([sample])[0]
        b = predict(model, {k: v[None] for k, v in actual.items()})
        torch.testing.assert_close(a, b)

    def test_aggregate_compares_exact_same_targets(self):
        observed, expected = synthetic()
        truth = expected[0].numpy()
        hold = np.repeat(observed["rasters"][0, -1:].numpy(), HORIZON, axis=0)
        report = aggregate([{"scores": {"hold": score_predictions(truth, hold),
                                        "neural": score_predictions(truth, truth)}}])
        self.assertEqual(report["neural"]["mean"]["silhouetteIoU"], 1)
        self.assertGreater(report["neural"]["mean"]["iouGainVsHold"], 0)
        self.assertEqual(report["neural"]["byHorizon"]["8"]["samples"], 1)
        json.dumps(report, allow_nan=False)

    def test_checkpoint_round_trip_and_checksum(self):
        observed, _ = synthetic()
        original = MotionForecaster(8)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            torch.save(original.state_dict(), path/"model.pt")
            metadata = {"schemaVersion": 1, "architecture": "patch-residual-cnn",
                        "width": 8, "weightsSha256": sha256(path/"model.pt")}
            (path/"model.json").write_text(json.dumps(metadata), encoding="utf-8")
            loaded, _ = load_model(path)
            torch.testing.assert_close(predict(original, observed), predict(loaded, observed))
            (path/"model.pt").write_bytes(b"bad")
            with self.assertRaisesRegex(ValueError, "checksum"):
                load_model(path)


if __name__ == "__main__":
    unittest.main()
