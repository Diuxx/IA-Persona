"""Sépare des zones animables du PNG aplati fourni par l'utilisateur.

Les parties masquées sous les volumes du nuage n'existent pas dans la source :
les mouvements doivent donc rester discrets pour conserver les raccords.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source.png'
OUTPUT = ROOT / 'assets'
BACKGROUND = 102


def take_components(labels: np.ndarray, stats: np.ndarray, boxes):
    selected = np.zeros(labels.shape, dtype=np.uint8)
    for i, box in enumerate(stats):
        x, y, w, h, area = map(int, box)
        if i == 0 or area < 3:
            continue
        if any(x >= left and x + w <= right and y >= top and y + h <= bottom
               for left, top, right, bottom in boxes):
            selected[labels == i] = 255
    return selected


def fill_holes(mask: np.ndarray) -> np.ndarray:
    flood = mask.copy()
    h, w = mask.shape
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), dtype=np.uint8), (0, 0), 255)
    return np.maximum(mask, cv2.bitwise_not(flood))


def polygon_mask(shape, points):
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    return mask


def save(name, rgb, mask, scale=4):
    alpha = mask.astype(np.uint8)
    arr = np.dstack([rgb, alpha])
    img = Image.fromarray(arr, 'RGBA')
    img = img.resize((img.width * scale, img.height * scale), Image.Resampling.LANCZOS)
    img.save(OUTPUT / name)


def main():
    OUTPUT.mkdir(exist_ok=True)
    source = np.array(Image.open(SOURCE).convert('RGB'))
    gray = source[..., 0]
    # L'image provient d'une capture sur fond #666, qui doit devenir transparent.
    threshold = np.uint8(gray < 99)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(threshold, 8)
    assert n >= 5, 'Le découpage suppose le PNG de référence original.'
    items = sorted(range(1, n), key=lambda index: stats[index, cv2.CC_STAT_AREA], reverse=True)
    body_id = items[0]
    body_binary = np.uint8(labels == body_id) * 255
    body_binary = fill_holes(body_binary)
    # Les contours anti-aliasés ne doivent pas garder l'ancien fond gris.
    matte_alpha = np.uint8(np.clip((BACKGROUND - gray.astype(float)) / 51, 0, 1) * 255)
    matte_alpha = np.maximum(matte_alpha, np.uint8((gray < 100) * 255))
    matte_alpha = np.where(gray <= 51, 255, matte_alpha).astype(np.uint8)
    body_alpha = np.where(body_binary > 0, 255, 0).astype(np.uint8)
    body_alpha[(gray >= 99) & (gray <= 102) & (body_binary > 0)] = 255

    # Les zones de brillance/puff sont des composants gris internes du corps.
    highlights = np.uint8((gray >= 43) & (gray <= 62))
    _, shade_labels, shade_stats, _ = cv2.connectedComponentsWithStats(highlights, 8)
    puff_regions = {
        'puff-top.png': (90, 55),
        'puff-left.png': (50, 89),
        'puff-right.png': (132, 82),
    }
    remaining = source.copy()
    remaining_body_alpha = body_alpha.copy()
    overlay_assets = {}
    for filename, (cx, cy) in puff_regions.items():
        target_label = int(shade_labels[cy, cx])
        if target_label == 0:
            raise ValueError(f'Impossible de segmenter {filename}')
        region = np.uint8(shade_labels == target_label) * 255
        # La zone grise est bordée d'antialias, récupéré avec une dilatation de 1 px.
        region = cv2.dilate(region, np.ones((3, 3), np.uint8))
        region = cv2.bitwise_and(region, body_binary)
        # Les pixels noirs bordant le volume restent dans la silhouette de base.
        overlay_assets[filename] = region
        remaining[region > 0] = [0, 0, 0]

    # Extraire la bouche au-dessus du corps pour un mouvement indépendant.
    mouth = polygon_mask(gray.shape, [
        (70, 120), (129, 120), (137, 129), (132, 145),
        (114, 153), (89, 153), (73, 145), (65, 129),
    ])
    mouth = cv2.bitwise_and(mouth, body_binary)
    overlay_assets['mouth.png'] = mouth
    remaining[mouth > 0] = [0, 0, 0]

    # Séparer les pattes. La partie recouverte par le nuage reste cachée.
    legs = {
        'leg-left.png': polygon_mask(gray.shape, [(59, 155), (86, 155), (86, 204), (56, 204)]),
        'leg-right.png': polygon_mask(gray.shape, [(112, 153), (139, 153), (139, 204), (111, 204)]),
    }
    for filename, legmask in legs.items():
        legmask = cv2.bitwise_and(legmask, body_binary)
        overlay_assets[filename] = legmask
        # Suppression seulement sous le raccord afin de préserver le bord du corps.
        cut = np.where(np.indices(gray.shape)[0] >= 165, legmask, 0)
        remaining_body_alpha[cut > 0] = 0

    save('body.png', remaining, remaining_body_alpha)
    for filename, mask in overlay_assets.items():
        save(filename, source, mask)

    # Composants détachés, dont les deux grosses gouttelettes et quatre petites.
    detached = []
    for i in range(1, n):
        if i == body_id or int(stats[i, cv2.CC_STAT_AREA]) < 3:
            continue
        x, y, w, h, area = map(int, stats[i])
        detached.append((x, y, i, w, h, area))
    detached.sort(key=lambda item: item[0])
    count = 0
    for x, y, i, w, h, area in detached:
        if area >= 300 and x < 90:
            filename = 'droplet-left.png'
        elif area >= 300 and x >= 90:
            filename = 'droplet-right.png'
        else:
            count += 1
            filename = f'spark-{count}.png'
        mask = np.uint8(labels == i) * 255
        # Même fond que la source pour conserver les trous intérieurs.
        save(filename, source, mask)

    print(f'{len(list(OUTPUT.glob("*.png")))} calques extraits dans {OUTPUT}')


if __name__ == '__main__':
    main()
