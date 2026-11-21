"""Optical flow from observed raster pairs; no exported particle identities."""
import cv2
import numpy as np
from scipy.ndimage import map_coordinates

# Distinguish empty space from dark body and bright eye.
INTENSITY = np.array([0, 110, 170, 255], dtype=np.uint8)


def sample(image, points):
    """Bilinear sampling in image coordinates (x right, y down)."""
    coords = points.T[::-1]
    if image.ndim == 2:
        return map_coordinates(image, coords, order=1, mode="nearest")
    return np.column_stack([sample(image[..., i], points) for i in range(image.shape[2])])


def estimate_flow(a, b):
    """Dense Farneback forward and backward displacement, pixels per interval."""
    if a.shape != b.shape or a.ndim != 2:
        raise ValueError("Expected equal two-dimensional rasters")
    if not np.isin(a, [0, 1, 2, 3]).all() or not np.isin(b, [0, 1, 2, 3]).all():
        raise ValueError("Invalid raster shade")
    # Fixed parameters, not tuned on hidden frames.
    def direction(start, end):
        return cv2.calcOpticalFlowFarneback(
            INTENSITY[start], INTENSITY[end], None,
            pyr_scale=0.5, levels=4, winsize=21, iterations=5,
            poly_n=7, poly_sigma=1.5, flags=0)
    return direction(a, b), direction(b, a)


def consistent_displacement(forward, backward, points, tolerance=2.0):
    """Reject inconsistent/out-of-frame estimates; not a calibrated confidence."""
    displacement = sample(forward, points)
    arrival = points + displacement
    height, width = forward.shape[:2]
    inside = ((arrival[:, 0] >= 0) & (arrival[:, 0] <= width-1)
              & (arrival[:, 1] >= 0) & (arrival[:, 1] <= height-1))
    error = np.linalg.norm(displacement + sample(backward, arrival), axis=1)
    accepted = inside & np.isfinite(error) & (error <= tolerance)
    return np.where(accepted[:, None], displacement, 0), accepted, error
