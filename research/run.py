"""Run from the repository root: python research/run.py."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from motion_fields import analyze

ROOT = Path(__file__).resolve().parent.parent


def load_idle():
    # Fixed trusted repository scripts only; no arbitrary JavaScript input.
    process = subprocess.run(["node", str(ROOT / "research/export_idle.cjs")],
                             capture_output=True, check=True, timeout=60)
    data = json.loads(process.stdout)
    poses = np.frombuffer(base64.b64decode(data.pop("frames"), validate=True), dtype=np.uint8)
    poses = poses.reshape(data["frameCount"], data["particleCount"], 3)
    regions = np.frombuffer(base64.b64decode(data.pop("regionIds"), validate=True), dtype=np.uint8)
    if regions.shape != (data["particleCount"],):
        raise ValueError("Region assignment length mismatch")
    for filename in ("animations/idle-targets.js", "persona-map.js", "persona-anatomy.js"):
        data.setdefault("sourceSha256", {})[filename] = hashlib.sha256(
            (ROOT / "assets" / filename).read_bytes()).hexdigest()
    return poses, regions, data


def plot_frame(path, arrays, metadata, cell, index):
    """Diagnostic figure; unmatched/unsupported cells are blank, not zero."""
    fig, axes = plt.subplots(2, 3, figsize=(13, 8), constrained_layout=True)
    width, height = metadata["width"], metadata["height"]
    ny, nx = arrays["density"][index].shape
    extent = (0, nx * cell, ny * cell, 0)
    x, y = np.meshgrid((np.arange(nx) + 0.5) * cell, (np.arange(ny) + 0.5) * cell)
    mask = arrays["supported"][index]
    vx, vy = arrays["vx"][index], arrays["vy"][index]
    ax = axes[0, 0]
    positions = arrays["positions"][index, arrays["visible"][index]]
    ax.scatter(positions[:, 0] + 0.5, positions[:, 1] + 0.5, s=1, color="0.75")
    ax.quiver(x[mask], y[mask], vx[mask], vy[mask], angles="xy", scale_units="xy",
              scale=1 / (metadata["frameDurationMs"] / 1000), color="tab:blue")
    ax.set_title("Vitesse (flèche = déplacement sur un pas)")
    speed = np.hypot(vx, vy)
    maps = [
        (arrays["density"][index], "Densité (points/cellule)", "viridis"),
        (speed, "Vitesse (px/s)", "viridis"),
        (arrays["divergence"][index], "Divergence (1/s)", "coolwarm"),
        (arrays["curl"][index], "Rotation (1/s)", "coolwarm"),
        (arrays["strain_rate"][index], "Déformation (1/s)", "magma"),
    ]
    for ax, (values, title, cmap) in zip(axes.flat[1:], maps):
        kwargs = {}
        finite = values[np.isfinite(values)]
        if cmap == "coolwarm" and finite.size:
            limit = max(float(np.abs(finite).max()), 1e-9)
            kwargs = {"vmin": -limit, "vmax": limit}
        image = ax.imshow(np.ma.masked_invalid(values), extent=extent, cmap=cmap, **kwargs)
        ax.set_title(title)
        fig.colorbar(image, ax=ax, shrink=0.8)
    for ax in axes.flat:
        ax.set(xlim=(0, width), ylim=(height, 0), aspect="equal")
    fig.suptitle(f"IA-Persona / idle / pose {index + 1} (coordonnées image)")
    fig.savefig(path, dpi=150)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "research/output")
    parser.add_argument("--cell", type=int, default=4)
    parser.add_argument("--frame", type=int, default=1, help="1-based diagnostic pose")
    args = parser.parse_args()
    poses, regions, metadata = load_idle()
    if not 1 <= args.frame <= len(poses):
        parser.error("--frame outside available poses")
    profile, arrays = analyze(poses, regions, metadata, args.cell)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "idle.motion-lab.json").write_text(
        json.dumps(profile, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    np.savez_compressed(args.output / "idle.fields.npz", **arrays)
    plot_frame(args.output / "idle.fields.png", arrays, metadata, args.cell, args.frame - 1)
    print(f"{len(poses)} poses; {profile['population']}; output: {args.output}")


if __name__ == "__main__":
    main()
