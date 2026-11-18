#!/usr/bin/env python3
"""Compile a grayscale drawing into color-preserving RLE particle positions.

No pixel readback is necessary in the browser; this script is the asset pipeline.
"""
import base64
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source.png'
OUTPUT = ROOT / 'assets' / 'persona-map.js'
SIZE = 200
PALETTE = (
    (0, 0, 0, 0),       # Transparent background
    (6, 6, 8, 255),    # Black cloud
    (51, 51, 54, 255), # Dark gray volumes
    (224, 224, 222, 255), # Single bright eye
)


def classify(intensity: int) -> int:
    if intensity < 22:
        return 1
    if intensity < 85:
        return 2
    if intensity > 122:
        return 3
    return 0


def build_map(image: Image.Image) -> tuple[str, int]:
    logical_image = Image.new('L', (SIZE, SIZE), 102)
    # Keep the small vertical feet and the droplets inside the 200x200 grid.
    resized = image.convert('L').resize((176, 199), Image.Resampling.NEAREST)
    logical_image.paste(resized, (12, 0))

    runs = bytearray()
    visible = 0
    for y in range(SIZE):
        x = 0
        while x < SIZE:
            kind = classify(logical_image.getpixel((x, y)))
            if kind == 0:
                x += 1
                continue
            start = x
            while x < SIZE and classify(logical_image.getpixel((x, y))) == kind:
                x += 1
            length = x - start
            runs.extend((y, start, length, kind))
            visible += length
    return base64.b64encode(runs).decode('ascii'), visible


def main() -> None:
    encoded, visible = build_map(Image.open(SOURCE))
    payload = '''/** Generated from source.png by tools/export_particle_map.py.
 * RLE entries: [y, x, length, paletteIndex] as unsigned bytes.
 * Every visible pixel becomes one particle and keeps its original color family.
 */
const PERSONA_PIXEL_MAP = Object.freeze({
  width: 200,
  height: 200,
  count: %(count)d,
  palette: %(palette)s,
  runs: '%(runs)s',
});
if (typeof module !== 'undefined' && module.exports) module.exports = { PERSONA_PIXEL_MAP };
''' % {'count': visible, 'palette': repr([list(row) for row in PALETTE]), 'runs': encoded}
    OUTPUT.write_text(payload, encoding='utf-8')
    print(f'Exported {visible} pixels, {len(encoded)} base64 characters to {OUTPUT}')


if __name__ == '__main__':
    main()
