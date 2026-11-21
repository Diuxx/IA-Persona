"""Export a versioned dataset and a visual audit, without training a model."""
import argparse
import html
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
import numpy as np
import scipy

from run import ROOT
from estimation.clips import load_reference
from dataset.core import (SCENE_SIZE, CELL, HISTORY, HORIZON, RADIUS, GROUPS, SPLITS,
                          build_clip, validate_registry, window_starts, sha256, write_json)

REGISTRY = ROOT/"research/dataset/clips.json"


def preview(path, arrays, name):
    frames = arrays["rasters"]
    indices = np.linspace(0, len(frames)-1, 5, dtype=int)
    figure, axes = plt.subplots(2, 5, figsize=(13, 5.6), constrained_layout=True)
    palette = ListedColormap(["#dddddd", "#191919", "#888888", "#ffffff"])
    for i, frame in enumerate(indices):
        axes[0, i].imshow(frames[frame], cmap=palette, vmin=0, vmax=3, interpolation="nearest")
        axes[0, i].set_title("Frame "+str(frame+1))
        axes[0, i].axis("off")
        axes[1, i].imshow(arrays["density"][frame, 0], vmin=0, vmax=CELL**2, cmap="viridis")
        axes[1, i].set_title("Densité corps")
        axes[1, i].axis("off")
    figure.suptitle(name+" : poses observées et densité locale")
    figure.savefig(path, dpi=130)
    plt.close(figure)


def build(output, registry):
    families = validate_registry(registry)
    output.mkdir(parents=True, exist_ok=True)
    clips, windows = [], []
    source_hashes = {}
    for descriptor in registry["clips"]:
        name = descriptor["id"]
        frames, metadata = load_reference(descriptor["source"])
        arrays, offset = build_clip(frames, metadata["frameDurationMs"])
        raw_digest = hashlib.sha256(arrays["rasters"].tobytes()).hexdigest()
        previous_family = source_hashes.setdefault(raw_digest, descriptor["family"])
        if previous_family != descriptor["family"]:
            raise ValueError("Identical raster clip assigned to different families")
        filename = name+".npz"
        np.savez_compressed(output/filename, **arrays)
        preview(output/(name+".png"), arrays, name)
        population = arrays["density"].sum(axis=(1, 2, 3), dtype=np.int64)
        starts = list(window_starts(len(frames)))
        split = families[descriptor["family"]]
        clips.append({**descriptor, "split": split, "file": filename,
                      "sha256": sha256(output/filename), "rasterSha256": raw_digest,
                      "sourceSha256": metadata["sourceSha256"],
                      "sourceWidth": metadata["width"], "sourceHeight": metadata["height"],
                      "sceneOffsetXY": offset, "frameDurationMs": metadata["frameDurationMs"],
                      "frameCount": len(frames), "windowCount": len(starts),
                      "minPopulation": int(population.min()), "maxPopulation": int(population.max()),
                      "loop": metadata["loop"]})
        windows.extend({"clip": name, "split": split, "start": start} for start in starts)
        print(f"{name}: {len(frames)} poses, {len(starts)} fenêtres, split={split}, "
              f"population={population.min()}..{population.max()}", flush=True)
    counts = {split: {"clips": sum(c["split"] == split for c in clips),
                      "families": sum(s == split for s in families.values()),
                      "windows": sum(w["split"] == split for w in windows)} for split in SPLITS}
    manifest = {"schemaVersion": 1, "sceneSize": SCENE_SIZE, "cellPx": CELL,
                "historyFrames": HISTORY, "horizonFrames": HORIZON,
                "matchRadiusPx": RADIUS, "groups": list(GROUPS),
                "numpyVersion": np.__version__, "scipyVersion": scipy.__version__,
                "splitPolicy": registry["splits"], "counts": counts, "clips": clips,
                "windows": windows, "independentTestAvailable": counts["test"]["families"] > 0}
    write_json(output/"manifest.json", manifest)
    audit(output, manifest)
    print(json.dumps(counts), flush=True)
    return manifest


def audit(output, manifest):
    sections = []
    for clip in manifest["clips"]:
        name = html.escape(clip["id"])
        sections.append(f'<section><h2>{name} — {clip["split"]}</h2>'
                        f'<p>{clip["frameCount"]} poses · {clip["windowCount"]} fenêtres · '
                        f'{clip["frameDurationMs"]} ms/pose · population {clip["minPopulation"]}–{clip["maxPopulation"]}</p>'
                        f'<img src="{name}.png" alt="Poses et densité de {name}"></section>')
    counts = manifest["counts"]
    rows = "".join(f'<tr><td>{split}</td><td>{c["families"]}</td><td>{c["clips"]}</td>'
                   f'<td>{c["windows"]}</td></tr>' for split, c in counts.items())
    warning = "" if manifest["independentTestAvailable"] else "<p><strong>Aucun jeu de test indépendant.</strong> Corpus exploratoire uniquement.</p>"
    (output/"index.html").write_text(
        '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Motion Dataset V1</title>'
        '<style>body{font:16px system-ui;background:#151a20;color:#eee;max-width:1100px;margin:auto;padding:24px}'
        'img{width:100%}td,th{padding:8px 20px;text-align:left}section{margin:24px 0}</style>'
        '<h1>Motion Dataset V1</h1><p>5 poses observées → 8 poses futures. '
        'Les fenêtres qui se recouvrent ne sont pas des exemples indépendants.</p>'+warning+
        '<table><tr><th>Split</th><th>Familles</th><th>Clips</th><th>Fenêtres</th></tr>'+rows+'</table>'
        +''.join(sections), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT/"research/output/dataset")
    args = parser.parse_args()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    build(args.output, registry)


if __name__ == "__main__":
    main()
