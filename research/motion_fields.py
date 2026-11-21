"""Offline measurements of compiled target poses, not of rendered physics."""
import numpy as np
from scipy.ndimage import gaussian_filter


def differentiate(values, valid, dt, loop):
    """Forward difference, valid only when both consecutive samples exist."""
    result = (np.roll(values, -1, axis=0) - values) / dt
    supported = valid & np.roll(valid, -1, axis=0)
    if not loop:
        supported[-1] = False
    result[~supported] = np.nan
    return result, supported


def trajectories(positions, visible, dt, loop):
    """Derivative units: px/s, px/s², px/s³. Never connect invisible samples."""
    velocity, velocity_valid = differentiate(positions, visible, dt, loop)
    acceleration, acceleration_valid = differentiate(velocity, velocity_valid, dt, loop)
    jerk, jerk_valid = differentiate(acceleration, acceleration_valid, dt, loop)
    return {
        "velocity": velocity, "velocity_valid": velocity_valid,
        "acceleration": acceleration, "acceleration_valid": acceleration_valid,
        "jerk": jerk, "jerk_valid": jerk_valid,
    }


def bin_sum(points, values, shape, cell):
    indices = (points // cell).astype(int)
    result = np.zeros(shape, dtype=float)
    np.add.at(result, (indices[:, 1], indices[:, 0]), values)
    return result


def spatial_gradient(field, supported, cell):
    """Central differences only where all four adjacent cells are supported."""
    dx = np.full_like(field, np.nan)
    dy = np.full_like(field, np.nan)
    if min(field.shape) < 3:
        return dx, dy
    valid = (supported[1:-1, 1:-1] & supported[1:-1, :-2]
             & supported[1:-1, 2:] & supported[:-2, 1:-1]
             & supported[2:, 1:-1])
    dx[1:-1, 1:-1] = np.where(valid, (field[1:-1, 2:] - field[1:-1, :-2]) / (2 * cell), np.nan)
    dy[1:-1, 1:-1] = np.where(valid, (field[2:, 1:-1] - field[:-2, 1:-1]) / (2 * cell), np.nan)
    return dx, dy


def local_field(points, velocity, visible_points, width, height, cell=4):
    """Estimate a coarse Eulerian velocity field by normalized Gaussian binning.

    The returned residual is a diagnostic of local disagreement, not a calibrated
    probability that an identity match is wrong.
    """
    shape = ((height + cell - 1) // cell, (width + cell - 1) // cell)
    count = bin_sum(points, 1, shape, cell)
    density = bin_sum(visible_points, 1, shape, cell)
    weight = gaussian_filter(count, 1.0, mode="constant")
    supported = (count >= 1) & (weight >= 2.0)
    components = []
    for component in velocity.T:
        total = gaussian_filter(bin_sum(points, component, shape, cell), 1.0, mode="constant")
        components.append(np.divide(total, weight, out=np.full(shape, np.nan), where=supported))
    vx, vy = components
    du_dx, du_dy = spatial_gradient(vx, supported, cell)
    dv_dx, dv_dy = spatial_gradient(vy, supported, cell)
    # Symmetric velocity gradient: Frobenius norm of the local strain-rate tensor.
    strain = np.sqrt(du_dx**2 + dv_dy**2 + 0.5 * (du_dy + dv_dx)**2)
    indices = (points // cell).astype(int)
    estimate = np.column_stack((vx[indices[:, 1], indices[:, 0]],
                                vy[indices[:, 1], indices[:, 0]]))
    residual = np.linalg.norm(velocity - estimate, axis=1)
    return {
        "density": density, "sample_count": count, "supported": supported,
        "vx": vx, "vy": vy, "divergence": du_dx + dv_dy,
        "curl": dv_dx - du_dy, "strain_rate": strain,
    }, residual


def statistics(values):
    finite = values[np.isfinite(values)]
    if not finite.size:
        return {"count": 0, "mean": None, "p95": None, "max": None}
    return {"count": int(finite.size), "mean": float(finite.mean()),
            "p95": float(np.percentile(finite, 95)), "max": float(finite.max())}


def analyze(poses, region_ids, metadata, cell=4):
    """Return a JSON-ready profile and arrays for reproducible visual analysis."""
    if not isinstance(cell, int) or not 1 <= cell <= min(metadata["width"], metadata["height"]):
        raise ValueError("Invalid grid cell size")
    dt = metadata["frameDurationMs"] / 1000
    if not np.isfinite(dt) or dt <= 0:
        raise ValueError("Invalid frame duration")
    positions = poses[..., :2].astype(float)
    visible = poses[..., 2] != 0
    loop = metadata["loop"]
    derivatives = trajectories(positions, visible, dt, loop)
    fields = []
    residuals = np.full(visible.shape, np.nan)
    summaries = []
    for index, position in enumerate(positions):
        valid = derivatives["velocity_valid"][index]
        field, residual = local_field(
            position[valid], derivatives["velocity"][index, valid],
            position[visible[index]], metadata["width"], metadata["height"], cell)
        fields.append(field)
        residuals[index, valid] = residual
        next_visible = visible[(index + 1) % len(visible)]
        has_transition = loop or index + 1 < len(visible)
        summaries.append({
            "frame": index + 1, "visible": int(visible[index].sum()),
            "appearing": int((~visible[index] & next_visible).sum()) if has_transition else None,
            "disappearing": int((visible[index] & ~next_visible).sum()) if has_transition else None,
            "supportedCells": int(field["supported"].sum()),
            "divergence": statistics(field["divergence"]),
            "curl": statistics(field["curl"]),
            "strainRate": statistics(field["strain_rate"]),
        })
    arrays = {name: np.stack([field[name] for field in fields]) for name in fields[0]}
    arrays.update(derivatives)
    arrays.update(positions=positions, visible=visible, shade=poses[..., 2],
                  region_ids=region_ids, residual=residuals)

    def motion_summary(selection):
        return {
            name: statistics(np.linalg.norm(derivatives[name][:, selection], axis=-1))
            for name in ("velocity", "acceleration", "jerk")
        } | {"localVelocityResidual": statistics(residuals[:, selection])}

    profile = {
        "schemaVersion": 1, "source": "compiled-target-poses",
        "animation": metadata, "gridCellPx": cell, "smoothingSigmaCells": 1.0,
        "units": {"velocity": "px/s", "acceleration": "px/s²", "jerk": "px/s³",
                  "divergence": "1/s", "curl": "1/s", "strainRate": "1/s",
                  "density": "visible points/cell", "localVelocityResidual": "px/s"},
        "population": {"min": int(visible.sum(axis=1).min()), "max": int(visible.sum(axis=1).max())},
        "motion": motion_summary(slice(None)),
        "regions": {name: motion_summary(region_ids == index)
                    for index, name in enumerate(metadata["regionNames"])},
        "frames": summaries,
    }
    return profile, arrays
