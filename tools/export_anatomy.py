#!/usr/bin/env python3
"""Compile semantic zones aligned exactly with persona-map.js.

The source is a flattened drawing: gray puff regions are segmented by connected
components; legs and face use source-coordinate masks from split_assets.py.
Nothing is read from images inside the browser.
"""
import base64
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'source' / 'source.png'
PARTICLE_MAP = ROOT / 'assets' / 'persona-map.js'
DESTINATION = ROOT / 'assets' / 'persona-anatomy.js'
SOURCE_SIZE = 200
SCALED_WIDTH = 176
SCALED_HEIGHT = 199
OFFSET_X = 12

REGIONS = (
    'body', 'eye', 'expression', 'puff-top', 'puff-left', 'puff-right',
    'droplet-left', 'droplet-right', 'leg-left', 'leg-right', 'spark',
)


def read_particle_runs():
    content = PARTICLE_MAP.read_text(encoding='utf-8')
    match = re.search(r"runs: '([^']+)'", content)
    if not match:
        raise ValueError('Carte persona-map.js introuvable ou incompatible.')
    encoded = base64.b64decode(match.group(1), validate=True)
    if len(encoded) % 4:
        raise ValueError('Carte de particules tronquée.')
    for y, x, length, palette in np.frombuffer(encoded, dtype=np.uint8).reshape((-1, 4)):
        for column in range(int(x), int(x) + int(length)):
            yield int(y), column, int(palette)


def component_masks(gray):
    n, labels, stats, _ = cv2.connectedComponentsWithStats((gray < 99).astype('uint8'), 8)
    if n < 6:
        raise ValueError('Les composants détachés de source.png sont manquants.')
    body_id = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    body = (labels == body_id).astype('uint8')
    masks = {}
    spark = np.zeros(gray.shape, dtype='uint8')
    for component in range(1, n):
        if component == body_id:
            continue
        x, _, _, _, area = stats[component]
        if area < 3:
            continue
        mask = (labels == component).astype('uint8')
        if area >= 300:
            masks['droplet-left' if x < 90 else 'droplet-right'] = mask
        else:
            spark = np.maximum(spark, mask)
    masks['spark'] = spark

    _, shades, _, _ = cv2.connectedComponentsWithStats(
        ((gray >= 43) & (gray <= 62)).astype('uint8'), 8,
    )
    for name, cx, cy in (
        ('puff-top', 90, 55),
        ('puff-left', 50, 89),
        ('puff-right', 132, 82),
    ):
        region = int(shades[cy, cx])
        if not region:
            raise ValueError(f'Masque de volume introuvable : {name}')
        mask = cv2.dilate((shades == region).astype('uint8'), np.ones((3, 3), 'uint8'))
        masks[name] = mask * body

    def polygon(points):
        mask = np.zeros(gray.shape, dtype='uint8')
        cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 1)
        return mask * body

    masks['expression'] = polygon([
        (70, 120), (129, 120), (137, 129), (132, 145),
        (114, 153), (89, 153), (73, 145), (65, 129),
    ])
    masks['leg-left'] = polygon([(59, 155), (86, 155), (86, 204), (56, 204)])
    masks['leg-right'] = polygon([(112, 153), (139, 153), (139, 204), (111, 204)])

    # Bright iris/eye pixels are classified in the source expression mask.
    face_outline = np.zeros(gray.shape, dtype='uint8')
    cv2.fillPoly(face_outline, [np.array([(70, 120), (129, 120), (137, 129), (132, 145),
        (114, 153), (89, 153), (73, 145), (65, 129)], dtype=np.int32)], 1)
    masks['eye'] = (face_outline * (gray > 122)).astype('uint8')
    return masks


def classify_image(gray):
    zones = np.zeros(gray.shape, dtype='uint8')
    masks = component_masks(gray)
    # Later masks win in overlap areas. Eye is applied last to preserve its identity.
    for region in (
        'puff-top', 'puff-left', 'puff-right', 'expression',
        'leg-left', 'leg-right', 'droplet-left', 'droplet-right', 'spark', 'eye',
    ):
        zones[masks[region] > 0] = REGIONS.index(region)

    image = Image.fromarray(zones, mode='L')
    image = image.resize((SCALED_WIDTH, SCALED_HEIGHT), Image.Resampling.NEAREST)
    logical = Image.new('L', (SOURCE_SIZE, SOURCE_SIZE))
    logical.paste(image, (OFFSET_X, 0))
    return np.array(logical, dtype='uint8')


def export_map(zones):
    # Only the pixels in persona-map.js are encoded, in row-major order.
    visible_by_row = [[] for _ in range(SOURCE_SIZE)]
    counts = [0] * len(REGIONS)
    for y, x, palette in read_particle_runs():
        zone = int(zones[y, x])
        if palette == 3 and zone == REGIONS.index('expression'):
            zone = REGIONS.index('eye')
        visible_by_row[y].append((x, zone))
        counts[zone] += 1

    encoded = bytearray()
    for y, row in enumerate(visible_by_row):
        if not row:
            continue
        start, current_zone = row[0]
        previous_x = start
        for x, zone in row[1:]:
            if zone != current_zone or x != previous_x + 1:
                encoded.extend((y, start, previous_x - start + 1, current_zone))
                start, current_zone = x, zone
            previous_x = x
        encoded.extend((y, start, previous_x - start + 1, current_zone))

    pixel_map_source = PARTICLE_MAP.read_text(encoding='utf-8')
    match = re.search(r'count: (\d+)', pixel_map_source)
    if not match:
        raise ValueError('Nombre de pixels absent de persona-map.js.')
    expected_count = int(match.group(1))
    if sum(counts) != expected_count or any(counts[i] == 0 for i in range(len(REGIONS))):
        raise ValueError(f'Carte anatomique incomplète : {dict(zip(REGIONS, counts))}')
    encoded64 = base64.b64encode(encoded).decode('ascii')
    regions_js = ', '.join(repr(name) for name in REGIONS)
    result = f'''/** Generated by tools/export_anatomy.py from source.png.
 * Every visible pixel has one anatomical region, aligned with persona-map.js.
 * RLE tuple: [y, x, count, regionId] as unsigned bytes.
 */
const PERSONA_ANATOMY = Object.freeze({{
  width: {SOURCE_SIZE},
  height: {SOURCE_SIZE},
  count: {sum(counts)},
  regions: [{regions_js}],
  runs: '{encoded64}',
}});
if (typeof module !== 'undefined' && module.exports) module.exports = {{ PERSONA_ANATOMY }};
'''
    DESTINATION.write_text(result, encoding='utf-8')
    print('Anatomy:', dict(zip(REGIONS, counts)))
    print('RLE bytes:', len(encoded), 'saved:', DESTINATION)


def main():
    gray = np.array(Image.open(SOURCE).convert('L'))
    export_map(classify_image(gray))


if __name__ == '__main__':
    main()
