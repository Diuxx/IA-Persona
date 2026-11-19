"""Tests unitaires de l'analyse des PNG sources ; sans modifier le moteur Canvas."""
from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parent / 'analyze_source_motion.py'
if not SCRIPT.exists():
    SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'analyze_source_motion.py'
spec = importlib.util.spec_from_file_location('analyze_source_motion', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def make_frame(x: int, size: tuple[int, int] = (40, 25), *, empty: bool = False) -> bytes:
    image = Image.new('RGB', size, (102, 102, 102))
    if not empty:
        drawing = ImageDraw.Draw(image)
        drawing.rectangle((x, 7, x + 7, 14), fill=(8, 8, 8))
        drawing.rectangle((x + 2, 9, x + 4, 10), fill=(240, 240, 240))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def create_archive(filename: Path, centers: list[int], *, bad_index: bool = False,
                   inconsistent_size: bool = False, empty_frame: bool = False) -> None:
    with ZipFile(filename, 'w') as archive:
        for i, x in enumerate(centers, 1):
            frame_name = f'frame-{i + (1 if bad_index else 0):03d}.png'
            dimensions = (41, 25) if i == len(centers) and inconsistent_size else (40, 25)
            archive.writestr(frame_name, make_frame(x, dimensions, empty=empty_frame and i == 2))


class SourceMotionTests(unittest.TestCase):
    def test_left_motion_with_terminal_hold(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'left.zip'
            create_archive(source, [12, 12, 8, 8, 8])
            profile = module.analyze_source(source)
            self.assertEqual(profile['animation']['frameCount'], 5)
            self.assertEqual(profile['animation']['frameDurationMs'], None)
            self.assertEqual(profile['animation']['durationMs'], None)
            self.assertEqual(profile['animation']['canvasSize'], [40, 25])
            self.assertEqual(profile['summary']['maximumLeftwardDisplacementPx'], 4)
            self.assertEqual(profile['summary']['netHorizontalDisplacementPx'], -4)
            self.assertEqual(profile['summary']['nearIdenticalHolds'], [
                {'firstFrame': 1, 'lastFrame': 2},
                {'firstFrame': 3, 'lastFrame': 5},
            ])
            self.assertTrue(profile['summary']['terminal']['finalTransitionNearIdentical'])
            self.assertEqual(profile['frames'][0]['regions']['brightEyeCandidate']['visiblePixels'], 6)
            self.assertIsNone(profile['animation']['loop'])

    def test_final_rebound_does_not_count_as_stable_stop(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'left.zip'
            create_archive(source, [12, 10, 8, 13])
            profile = module.analyze_source(source, frame_duration_ms=40)
            self.assertEqual(profile['animation']['durationMs'], 160)
            self.assertEqual(profile['animation']['timingSource'], 'manual-parameter')
            self.assertEqual(profile['summary']['horizontalReboundFromLeftmostPx'], 5)
            self.assertFalse(profile['summary']['terminal']['finalTransitionNearIdentical'])
            self.assertEqual(profile['transitions'][-1]['fromFrame'], 3)
            self.assertEqual(profile['transitions'][-1]['toFrame'], 4)

    def test_rejects_bad_archive_order_and_dimensions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'left.zip'
            create_archive(source, [10, 11], bad_index=True)
            with self.assertRaisesRegex(ValueError, 'ordonnées'):
                module.analyze_source(source)
            create_archive(source, [10, 11], inconsistent_size=True)
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                module.analyze_source(source)

    def test_rejects_empty_silhouette_and_invalid_cadence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'left.zip'
            create_archive(source, [10, 11], empty_frame=True)
            with self.assertRaisesRegex(ValueError, 'vide'):
                module.analyze_source(source)
            with self.assertRaisesRegex(ValueError, 'Durée'):
                module.analyze_source(source, frame_duration_ms=0)

    def test_real_left_archive_if_available(self) -> None:
        default = Path(__file__).resolve().parents[1] / 'assets' / 'animations' / 'left-frames.zip'
        archive = Path(os.environ.get('IA_PERSONA_LEFT_ZIP', str(default)))
        if not archive.is_file():
            self.skipTest('Archive de référence absente de cet environnement')
        profile = module.analyze_source(archive)
        self.assertEqual(profile['animation']['frameCount'], 34)
        self.assertEqual(profile['animation']['canvasSize'], [374, 200])
        self.assertEqual(profile['animation']['sourceSha256'],
                         '98618dd7e12816c764c335563437f08eb0ec5402fe5ec748e1d5b83e6ae1127d')
        self.assertEqual(profile['summary']['leftmostFrame'], 31)
        self.assertGreater(profile['summary']['maximumLeftwardDisplacementPx'], 60)
        self.assertEqual(profile['summary']['terminal']['stopEvidence'],
                         'terminal-stability-not-demonstrated')
        self.assertEqual(len(profile['transitions']), 33)


if __name__ == '__main__':
    unittest.main()
