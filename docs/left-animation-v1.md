# Animations « gauche » et « droite » — V1

Ce document décrit l'implémentation des animations `left` (aller à gauche) et `right`
(aller à droite) dans le Canvas, leurs choix techniques, leurs limites et la procédure de
régénération. C'est une note technique modifiable. Elle ne modifie pas
[`docs/PROJECT.md`](PROJECT.md), document de référence figé.

## Résumé

| Élément | Valeur |
| --- | --- |
| Sources | `assets/animations/left-frames.zip` (34 PNG, 374 × 200), non modifiées |
| Séquence jouée | frames sources 12 à 34, puis frames 1 à 13 rejouées : **36 frames** |
| Cadence | **60 ms par frame, provisoire** : durée totale 2,16 s |
| Fin | retour automatique à l'idle |
| Clip miroir | `right` : miroir horizontal exact de `left`, même séquence et même rythme |
| Pool de particules | **23 532 identités**, partagé avec l'idle (16 162 identités) |
| Données compilées | `assets/animations/left-targets.js`, `assets/animations/right-targets.js` |
| Compilateur | `tools/export_left_animation.py` |

## Pourquoi ces choix

### Séquence jouée

Le mouvement commence à la **frame source 12** : les frames 1 à 11 ne sont pas jouées.
Le clip joue ensuite les frames 12 à 34, puis rejoue les frames 1 à 13 pour revenir vers
la position de départ, avant le retour à l'idle. Les PNG ne sont pas modifiés : les
frames rejouées sont exactement les mêmes images.

### Cadence

Les PNG ne contiennent aucune durée. **60 ms par frame** est une valeur provisoire, à
valider visuellement. Elle est réglable à la compilation avec `--frame-duration-ms`.

### Référentiel commun et ancrage

Les frames ne sont ni rééchantillonnées ni centrées une par une : une **seule** translation
entière (un décalage fixe) place toute la séquence dans le repère logique 200 × 200 de
l'idle. Ce décalage est calculé pour que **le centre de l'œil de la première frame jouée**
tombe sur le centre de l'œil de la première frame idle. Le mouvement horizontal est donc
conservé, et le départ colle à l'idle.

| Clip | Décalage (x, y) |
| --- | --- |
| `left` (frame 12 comme première frame) | (-65, 3) |
| `right` (miroir, frame 12 comme première frame) | (-98, 3) |

L'échelle est **1:1** avec les PNG source. Le personnage est donc d'environ 16 % plus petit
que l'idle (hauteur de silhouette 159 px contre 189 px). Une échelle de 1,19 dépasserait le
cadre de 400 px et demanderait plus de 375 yeux (414 pixels d'œil en certaines frames).

### Cadre de scène

Les pixels situés hors du cadre de 400 × 400 (pixels logiques hors de `[-100, 300[`) sont
**exclus** de la compilation : le moteur ne les afficherait pas. Pour `left`, cela concerne
576 pixels sur 653 038 (0,09 %), au maximum 153 par frame. Les détails périphériques
situés à l'extrême droite peuvent donc être tronqués dans les frames 24 à 28.

### Mouvement : interpolation et ralentissement

Le clip non bouclé est lu avec une **courbe ease-in-out** (`smoothstep`) : la vitesse est
nulle au départ et à l'arrivée, sans arrêt brutal. La position fractionnaire entre deux
frames donne le mélange (`blend`) du moteur, comme pour l'idle.

## Population de particules

- Le pool est **une seule structure** : l'idle en est un **préfixe**. Les 276 extras
  d'origine de l'idle sont les premiers extras de `left` ; `right` reprend exactement la
  liste de `left`.
- Les identités supplémentaires sont des **clones** de particules sources, corps comme yeux.
  Les yeux de `left` atteignent 414 pixels, contre 375 dans la carte : 39 clones d'œil sont
  donc nécessaires.
- Une identité absente d'une frame passe à l'opacité zéro ; son apparition et sa disparition
  sont **progressives** à l'intérieur d'une frame (interpolation de `activity`).
- L'idle ne change pas : il est complété par des identités inactives (`shade = 0`) jusqu'à la
  taille du pool.
- Effectifs visibles mesurés : **16 079 à 23 311** par frame.

## Appariement des identités (compilation)

Chaque identité garde une position continue d'une frame à l'autre. L'appariement se fait
hors navigateur, sur deux groupes (yeux et corps) :

1. Les pixels visibles de la frame suivante et les identités actives sont **découpés
   spatialement** : bissection récursive selon l'axe le plus étendu, coupe à la même
   coordonnée des deux côtés, avec serrage pour garder chaque moitié faisable.
2. Chaque bloc d'au plus **400 éléments** est résolu **exactement** (méthode hongroise,
   `linear_sum_assignment`), en minimisant la **somme des déplacements**.
3. Les identités surnuméraires deviennent des naissances, placées sur leur pixel cible et
   apparaissant en fondu.

Temps de compilation : environ **31 secondes** (contre plus de deux minutes sans fin avec
l'appariement global de la première version).

## Lecteur et contrôleur

- `TargetAnimationPlayer` sait lire deux types de clip :
  - `loop` (idle) : boucle, retour de la dernière frame vers la première ;
  - `one-shot` (left, right) : lecture unique, sans retour automatique à la frame 1, avec
    `next: 'idle'` déclaré dans les données.
- À la fin d'un `one-shot`, le contrôleur **passe automatiquement à idle** sans relâcher la
  pose : l'idle prend la suite depuis la pose finale.
- `stop` relâche la pose et renvoie les particules vers le repos. Changer de clip, par
  exemple `left` vers `right` ou `left` vers `idle`, **ne relâche pas** la pose : le nouveau
  clip prend la main directement.
- Les clips sont chargés **du plus grand au plus petit** (`createClips`) : l'agrandissement
  du pool n'a lieu qu'une fois, et les autres clips sont complétés en conséquence.
- Un clip `one-shot` refuse `loop: true` avec une erreur explicite.

## Commandes publiques

```javascript
window.persona.dispatch({ type: 'animation', name: 'left' });   // aller à gauche
window.persona.dispatch({ type: 'animation', name: 'right' });  // aller à droite
window.persona.dispatch({ type: 'animation', name: 'idle' });   // idle en boucle
window.persona.dispatch({ type: 'animation', action: 'stop' });  // relâche la pose
window.persona.getSnapshot().animation;  // clip actif, frame, kind, completed, held…
```

`getSnapshot().animation` expose : `name`, `kind`, `playing`, `held`, `completed`, `frame`,
`frameCount`, `visibleCount`, `speed`, `progress`, `densityLimit`.

## Interface

- Boutons « Jouer l’idle », « Aller à gauche », « Aller à droite », « Arrêter l’animation ».
- L'inspecteur de frames suit le clip actif : 36 frames pour `left` et `right`, 43 pour
  l'idle. La fin de boucle est désactivée pour les clips `one-shot`.

## Mesures

Mesures obtenues sur les données actuelles (pas de déplacement entre frames consécutives,
identités visibles dans les deux frames) :

| Mesure | Valeur |
| --- | ---: |
| Déplacement moyen entre frames | 4,2 px |
| 95e percentile entre frames | 22 px |
| Déplacement moyen au lancement depuis l'idle | 2,4 px (95e percentile 12 px) |
| Taille compilée (`left`) | environ 0,9 Mo |

Une borne inférieure (distance au pixel le plus proche de la frame précédente, sans
contrainte d'identité) donne un 99e percentile à 10 px ; notre appariement est encore à
34 px au 99e percentile. Le reste est un écart d'appariement, pas un mouvement des sources.

## Limites connues

- **Non-téléportation :** le test `idle → left ne téléporte pas les particules` impose
  moins de 12 px par pas pour les particules visibles avant et après. Il échoue : certains
  sauts entre frames consécutives atteignent environ 100 px. Le seuil n'a pas été modifié.
  Décision en attente : raffiner l'appariement, ou justifier un seuil à partir des mesures.
- **Cadence :** 60 ms par frame est provisoire ; la validation visuelle n'a pas encore été
  faite.
- **Cadrage :** le personnage est à l'échelle 1:1, donc plus petit que l'idle ; les pixels
  hors cadre sont exclus (voir ci-dessus).
- **Miroir :** `right` retourne le dessin : une asymétrie (œil, gouttes, pattes) est aussi
  inversée.
- **Effectifs :** les effectifs par frame diffèrent légèrement entre `left` et `right`, à
  cause des pixels exclus par le cadre.
- **Navigateur :** aucune vérification visuelle ni mesure de FPS dans un navigateur n'a été
  faite à ce stade.

## Régénération

Les PNG sources ne doivent jamais être modifiés. Procédure :

```bash
# Clip gauche (frames 12 à 34, puis 1 à 13), 60 ms par frame
python tools/export_left_animation.py

# Clip droit : miroir horizontal, pool imposé par left
python tools/export_left_animation.py --mirror --name right \
  --output assets/animations/right-targets.js \
  --shared-pool-from assets/animations/left-targets.js
```

Paramètres utiles : `--frame-duration-ms`, `--name`, `--mirror`, `--shared-pool-from`,
`--next`. Les constantes `START_FRAME` (12) et `HEAD_REPEAT_FRAMES` (13) sont dans le script.

Vérifications :

```bash
node --test tests/*.test.cjs
node --check src/app.js
node --check src/animation/target-animation-player.js
node --check src/controller/behavior-controller.js
node --check src/engine/particle-world.js
```

Résultat actuel : 135 réussites sur 137. Les deux échecs sont décrits ci-dessus :
`docs/PROJECT.md` (fins de ligne CRLF locales, blob committé correct) et le test de
non-téléportation.

## Fichiers modifiés

| Fichier | Rôle |
| --- | --- |
| `tools/export_left_animation.py` | compilation hors navigateur (séquence, ancrage, appariement, miroir) |
| `assets/animations/left-targets.js` | données compilées de `left` (généré) |
| `assets/animations/right-targets.js` | données compilées de `right` (généré) |
| `src/engine/particle-world.js` | pool partagé extensible, extras d'œil, poses typées |
| `src/animation/target-animation-player.js` | clips `loop` et `one-shot`, décodage, complétion, qualité par clip |
| `src/controller/behavior-controller.js` | sélection des clips, passage automatique à idle |
| `src/app.js`, `index.html` | boutons et inspecteur adaptés |
| `tests/left-animation.test.cjs` | tests de l'animation gauche et droite |
| `docs/left-animation-v1.md` | ce document |

Les sources PNG (`assets/animations/left-frames.zip`, `idle-frames.zip`) et les données
idle (`assets/animations/idle-targets.js`) ne sont pas modifiées.
