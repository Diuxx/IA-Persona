#!/usr/bin/env python3
"""Analyse une séquence PNG source en un profil de mouvements hors navigateur.

Les fichiers source ne fournissent pas d'identités de particules : la mesure
repose sur des silhouettes et des composants connexes, jamais sur des ID fictifs.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / 'assets' / 'animations' / 'left-frames.zip'
DEFAULT_OUTPUT = ROOT / 'assets' / 'animations' / 'analysis' / 'left.motion.json'
MAX_FRAMES = 160
MAX_FRAME_BYTES = 1_000_000
MAX_PIXELS_PER_FRAME = 1_000_000
HOLD_CENTROID_TOLERANCE = 0.5
HOLD_SILHOUETTE_IOU = 0.995


def rounded(value: float | None) -> float | None:
    return None if value is None else round(float(value), 3)


def point(x: float, y: float) -> dict[str, float]:
    return {'x': rounded(x), 'y': rounded(y)}


def distance(first: dict, second: dict) -> float:
    return float(np.hypot(second['x'] - first['x'], second['y'] - first['y']))


def center_and_bounds(mask: np.ndarray) -> dict:
    """Description d'une région visible ; zéro pixel => centre/limites null."""
    y, x = np.nonzero(mask)
    if not len(x):
        return {'visiblePixels': 0, 'centroid': None, 'bounds': None}
    return {
        'visiblePixels': int(len(x)),
        'centroid': point(x.mean(), y.mean()),
        'bounds': {
            'left': int(x.min()), 'top': int(y.min()),
            'right': int(x.max()), 'bottom': int(y.max()),
            'width': int(x.max() - x.min() + 1),
            'height': int(y.max() - y.min() + 1),
        },
    }


def classify_image(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Conserve les seuils de classes du compilateur d'animation existant."""
    grayscale = rgb.astype(np.float32).mean(axis=2)
    dark = grayscale <= 93
    bright = grayscale >= 139
    return dark | bright, bright


def observe_frame(image: Image.Image, frame_number: int, filename: str) -> tuple[dict, dict]:
    rgb = np.asarray(image.convert('RGB'))
    silhouette, bright = classify_image(rgb)
    if not silhouette.any():
        raise ValueError(f'{filename} : silhouette vide')
    if np.count_nonzero(np.all(rgb == 102, axis=2)) < rgb.shape[0] * rgb.shape[1] * 0.4:
        raise ValueError(f'{filename} : fond gris de référence non reconnu')

    connected, component_count = ndimage.label(silhouette, structure=np.ones((3, 3), dtype=np.uint8))
    populations = np.bincount(connected.ravel())
    populations[0] = 0
    biggest_label = int(np.argmax(populations))
    body = connected == biggest_label
    detached = silhouette & ~body
    measures = {
        'index': frame_number,
        'sourceFile': filename,
        'silhouette': center_and_bounds(silhouette),
        'regions': {
            'primaryBody': center_and_bounds(body),
            'brightEyeCandidate': center_and_bounds(bright),
            'detachedMatter': center_and_bounds(detached),
        },
        'connectedComponents': int(component_count),
    }
    # Le blanc peut disparaître pendant un clignement ; ne pas interpoler sa position.
    body_center = measures['regions']['primaryBody']['centroid']
    eye_center = measures['regions']['brightEyeCandidate']['centroid']
    measures['regions']['brightEyeCandidate']['relativeToPrimaryBody'] = (
        point(eye_center['x'] - body_center['x'], eye_center['y'] - body_center['y'])
        if eye_center is not None else None
    )
    return measures, {'silhouette': silhouette, 'body': body}


def intersection_over_union(before: np.ndarray, after: np.ndarray) -> float:
    intersection = int(np.count_nonzero(before & after))
    union = int(np.count_nonzero(before | after))
    return intersection / union if union else 1.0


def translated_mask(mask: np.ndarray, dx: int, dy: int) -> np.ndarray:
    height, width = mask.shape
    destination = np.zeros_like(mask)
    x_start = max(0, -dx)
    x_end = min(width, width - dx)
    y_start = max(0, -dy)
    y_end = min(height, height - dy)
    if x_start < x_end and y_start < y_end:
        destination[y_start + dy:y_end + dy, x_start + dx:x_end + dx] = (
            mask[y_start:y_end, x_start:x_end]
        )
    return destination


def compare_frames(previous: dict, next_frame: dict, previous_masks: dict,
                   next_masks: dict) -> dict:
    before = previous['regions']['primaryBody']['centroid']
    after = next_frame['regions']['primaryBody']['centroid']
    dx = after['x'] - before['x']
    dy = after['y'] - before['y']
    body_distance = float(np.hypot(dx, dy))
    aligned = translated_mask(previous_masks['silhouette'], round(dx), round(dy))
    mask_before = previous_masks['silhouette']
    mask_after = next_masks['silhouette']
    iou = intersection_over_union(mask_before, mask_after)
    is_hold = body_distance <= HOLD_CENTROID_TOLERANCE and iou >= HOLD_SILHOUETTE_IOU
    return {
        'fromFrame': previous['index'], 'toFrame': next_frame['index'],
        'primaryBodyDisplacementPx': point(dx, dy),
        'primaryBodyDistancePx': rounded(body_distance),
        'silhouetteIoU': rounded(iou),
        'alignedSilhouetteIoU': rounded(intersection_over_union(aligned, mask_after)),
        # Sans appariement stable : ces nombres sont des changements de pixels,
        # pas des naissances/morts d'identifiants de particules.
        'newlyOccupiedPixels': int(np.count_nonzero(mask_after & ~mask_before)),
        'newlyEmptyPixels': int(np.count_nonzero(mask_before & ~mask_after)),
        'nearIdenticalHold': bool(is_hold),
    }


def find_holds(transitions: list[dict]) -> list[dict]:
    holds = []
    first_frame = None
    last_frame = None
    for transition in transitions:
        if transition['nearIdenticalHold']:
            if first_frame is None:
                first_frame = transition['fromFrame']
            last_frame = transition['toFrame']
        elif first_frame is not None:
            holds.append({'firstFrame': first_frame, 'lastFrame': last_frame})
            first_frame = None
            last_frame = None
    if first_frame is not None:
        holds.append({'firstFrame': first_frame, 'lastFrame': last_frame})
    return holds


def build_motion_summary(frames: list[dict], transitions: list[dict]) -> dict:
    first = frames[0]['regions']['primaryBody']
    last = frames[-1]['regions']['primaryBody']
    initial_center = first['centroid']
    final_center = last['centroid']
    xs = [frame['regions']['primaryBody']['centroid']['x'] for frame in frames]
    leftmost_index = int(np.argmin(xs))
    rightmost_index = int(np.argmax(xs))
    final_transition = transitions[-1]
    heights = [frame['regions']['primaryBody']['bounds']['height'] for frame in frames]
    normalized_amplitude = (initial_center['x'] - min(xs)) / first['bounds']['height']
    return {
        'initialPrimaryBodyCenter': initial_center,
        'leftmostPrimaryBodyCenter': frames[leftmost_index]['regions']['primaryBody']['centroid'],
        'leftmostFrame': leftmost_index + 1,
        'rightmostFrame': rightmost_index + 1,
        'finalPrimaryBodyCenter': final_center,
        'maximumLeftwardDisplacementPx': rounded(initial_center['x'] - min(xs)),
        'maximumLeftwardDisplacementBodyHeights': rounded(normalized_amplitude),
        'netHorizontalDisplacementPx': rounded(final_center['x'] - initial_center['x']),
        'horizontalReboundFromLeftmostPx': rounded(final_center['x'] - min(xs)),
        'bodyHeightVariationPx': rounded(max(heights) - min(heights)),
        'minVisiblePixels': min(frame['silhouette']['visiblePixels'] for frame in frames),
        'maxVisiblePixels': max(frame['silhouette']['visiblePixels'] for frame in frames),
        'nearIdenticalHolds': find_holds(transitions),
        'terminal': {
            'finalTransitionBodyDistancePx': final_transition['primaryBodyDistancePx'],
            'finalTransitionSilhouetteIoU': final_transition['silhouetteIoU'],
            'finalTransitionNearIdentical': final_transition['nearIdenticalHold'],
            'stopEvidence': (
                'terminal-pose-stable-across-last-pair' if final_transition['nearIdenticalHold']
                else 'terminal-stability-not-demonstrated'
            ),
        },
    }


def load_png_frames(source: Path) -> tuple[list[dict], list[dict], tuple[int, int]]:
    with ZipFile(source) as archive:
        entries = archive.infolist()
        if not 2 <= len(entries) <= MAX_FRAMES:
            raise ValueError(f'Nombre de frames invalide : {len(entries)}')
        expected = [f'frame-{index:03d}.png' for index in range(1, len(entries) + 1)]
        if [entry.filename for entry in entries] != expected:
            raise ValueError('Les frames doivent être ordonnées : frame-001.png, frame-002.png, etc.')
        if any(entry.file_size > MAX_FRAME_BYTES for entry in entries):
            raise ValueError('Une frame dépasse la taille autorisée')

        frames = []
        masks = []
        dimensions = None
        for index, entry in enumerate(entries, 1):
            with Image.open(io.BytesIO(archive.read(entry))) as image:
                if image.format != 'PNG':
                    raise ValueError(f'{entry.filename} : format non PNG')
                if image.width * image.height > MAX_PIXELS_PER_FRAME:
                    raise ValueError('Dimensions trop grandes pour une frame')
                if dimensions is None:
                    dimensions = image.size
                elif image.size != dimensions:
                    raise ValueError('Les dimensions des frames diffèrent')
                measure, mask = observe_frame(image, index, entry.filename)
            frames.append(measure)
            masks.append(mask)
    return frames, masks, dimensions


def analyze_source(source: Path, *, frame_duration_ms: float | None = None,
                   animation_name: str = 'left',
                   user_intent: str | None = 'aller à gauche et s’arrêter') -> dict:
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,49}', animation_name):
        raise ValueError('Nom d’animation invalide')
    if user_intent is not None and (not isinstance(user_intent, str) or len(user_intent) > 240):
        raise ValueError('Intention de mouvement invalide')
    if frame_duration_ms is not None and (not 1 <= frame_duration_ms <= 1000):
        raise ValueError('Durée de frame invalide (1–1000 ms)')
    frames, masks, dimensions = load_png_frames(source)
    transitions = [compare_frames(frames[index], frames[index + 1], masks[index], masks[index + 1])
                   for index in range(len(frames) - 1)]
    # Conserve le canvas source, même si la silhouette n'occupe qu'une partie.
    canvas_size = list(dimensions)
    try:
        source_name = source.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        source_name = source.name
    return {
        'schemaVersion': 1,
        'analysisKind': 'source-png-silhouettes-without-particle-identities',
        'animation': {
            'name': animation_name, 'frameCount': len(frames),
            'frameDurationMs': rounded(frame_duration_ms),
            'durationMs': rounded(frame_duration_ms * len(frames)) if frame_duration_ms is not None else None,
            'canvasSize': canvas_size,
            'loop': None,
            'timingSource': 'manual-parameter' if frame_duration_ms is not None else 'not-provided-in-png',
            'sourceArchive': source_name,
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        },
        'sourceIntent': {
            'userDescription': user_intent,
            'proposedPlaybackLoop': False,
            'validatedEndPose': False,
        },
        'summary': build_motion_summary(frames, transitions),
        'frames': frames,
        'transitions': transitions,
        'methodology': {
            'colorClasses': 'grayscale <=93 or >=139; background gray 102 excluded',
            'primaryBody': 'largest 8-connected occupied component per frame, not stable particle IDs',
            'brightEyeCandidate': 'all occupied pixels >=139; may vanish or overlap other light details',
            'detachedMatter': 'all occupied pixels outside the primary component',
            'holds': f'body center change <= {HOLD_CENTROID_TOLERANCE}px and full silhouette IoU >= {HOLD_SILHOUETTE_IOU}',
            'caveats': [
                'Source PNG does not encode time; durations are unknown without an explicit parameter.',
                'Near-identical frames are not proof of duration or sustained stops.',
                'The final frame cannot show what happens after the sequence ends.',
                'Connected-component membership can change when parts touch or separate.',
                'No stable particle identities or 11-region anatomical assignments can be deduced from these PNGs alone.',
                'The source canvas is not the 200x200 runtime coordinate system; no crop or rescale has been applied.',
            ],
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--name', type=str, default='left',
                        help='Validated animation identifier for the JSON profile')
    parser.add_argument('--intent', type=str, default='aller à gauche et s’arrêter',
                        help='Human-provided movement description, not an automatically inferred label')
    parser.add_argument('--frame-duration-ms', type=float, default=None,
                        help='Optional known source cadence; omitted means time is unknown')
    parser.add_argument('--check', action='store_true', help='Verify that the committed JSON is up to date')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    profile = analyze_source(args.source, frame_duration_ms=args.frame_duration_ms,
                             animation_name=args.name, user_intent=args.intent)
    content = json.dumps(profile, indent=2, ensure_ascii=False, allow_nan=False) + '\n'
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding='utf-8') != content:
            raise ValueError(f'Profil manquant ou obsolète : {args.output}')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding='utf-8')
    summary = profile['summary']
    print(f"{profile['animation']['frameCount']} frames ; déplacement maximum vers la gauche : "
          f"{summary['maximumLeftwardDisplacementPx']} px ; "
          f"arrêt final : {summary['terminal']['stopEvidence']}")


if __name__ == '__main__':
    main()
