"""Small convolutional residual forecaster on lossless 4x4 raster patches."""
import torch
from torch import nn
from torch.nn import functional as F

from dataset.core import CELL, HISTORY, HORIZON

COUNT_KEYS = ("density", "matched", "births", "deaths")
INPUT_KEYS = ("rasters", *COUNT_KEYS, "velocity", "transition_valid", "time_seconds")
SHADE_CLASSES = 4
# Three visible shade channels per pixel, eight count channels, four velocity
# channels, a transition flag and a time channel per observation.
INPUT_CHANNELS = HISTORY * (3*CELL**2 + 8 + 4 + 1 + 1)


def encode_observations(observations):
    """Use only the past; patchification is a rearrangement, not downsampling."""
    raster = observations["rasters"]
    if raster.ndim != 4 or raster.shape[1] != HISTORY:
        raise ValueError("Expected batched observations [B,5,H,W]")
    batch, _, height, width = raster.shape
    if height % CELL or width % CELL:
        raise ValueError("Raster dimensions must be divisible by cell size")
    h, w = height//CELL, width//CELL
    visible = torch.stack([raster == shade for shade in (1, 2, 3)], dim=2).float()
    patches = F.pixel_unshuffle(visible.reshape(batch, HISTORY*3, height, width), CELL)
    counts = [observations[key].float().reshape(batch, HISTORY*2, h, w)/CELL**2
              for key in COUNT_KEYS]
    velocity = observations["velocity"].float()
    # Displacements are normalized by a fixed physical scale, not corpus stats.
    velocity = (velocity.permute(0, 1, 2, 5, 3, 4)
                .reshape(batch, HISTORY*4, h, w)/300).clamp(-4, 4)
    valid = observations["transition_valid"].float()[:, :, None, None].expand(-1, -1, h, w)
    times = observations["time_seconds"].float()[:, :, None, None].expand(-1, -1, h, w)/0.32
    return torch.cat((patches, *counts, velocity, valid, times), dim=1)


class MotionForecaster(nn.Module):
    """Predict all eight future shade maps jointly, without teacher forcing."""

    def __init__(self, width=24):
        super().__init__()
        self.encoder = nn.Sequential(nn.Conv2d(INPUT_CHANNELS, width, 1), nn.SiLU(),
                                     nn.Conv2d(width, width, 3, padding=1), nn.SiLU())
        self.context = nn.Sequential(nn.Conv2d(width, width, 3, padding=2, dilation=2),
                                     nn.SiLU(), nn.Conv2d(width, width, 3, padding=4, dilation=4),
                                     nn.SiLU())
        self.head = nn.Conv2d(width, HORIZON*SHADE_CLASSES*CELL**2, 1)
        # Before training, argmax exactly recovers the last observed pose.
        nn.init.zeros_(self.head.weight)
        nn.init.zeros_(self.head.bias)

    def forward(self, observations):
        raster = observations["rasters"]
        features = self.encoder(encode_observations(observations))
        residual = F.pixel_shuffle(self.head(features+self.context(features)), CELL)
        residual = residual.reshape(raster.shape[0], HORIZON, SHADE_CLASSES, *raster.shape[-2:])
        prior = F.one_hot(raster[:, -1].long(), SHADE_CLASSES).permute(0, 3, 1, 2).float()
        return residual + 2.0*prior[:, None]


def motion_loss(logits, expected, last):
    """Emphasize changed pixels and the small eye region, still learn background."""
    target = expected.long()
    class_weights = logits.new_tensor([1.0, 2.0, 2.0, 6.0])
    changed = (target != last[:, None]).to(logits.dtype)
    weights = class_weights[target] * (1.0 + 3.0*changed)
    ce = F.cross_entropy(logits.flatten(0, 1), target.flatten(0, 1),
                         reduction="none").reshape_as(target)
    return (ce*weights).sum()/weights.sum().clamp_min(1)


@torch.no_grad()
def predict(model, observations):
    model.eval()
    return model(observations).argmax(dim=2).to(torch.uint8)
