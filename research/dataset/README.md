# Motion Dataset V1 — préparer l'apprentissage

Corpus de poses compilées, hors moteur. Aucun réseau neuronal entraîné.
La V1 de prédiction est validée techniquement mais n'a pas battu la
référence immobile en IoU moyen. Ce dataset prépare une autre approche :
apprendre à prévoir la forme et les déplacements à partir d'observations.

## Construire et consulter

Depuis la racine, avec l'environnement Python de recherche existant :

```sh
research/.venv/bin/python research/build_dataset.py
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Windows : remplacer research/.venv/bin/python par research/.venv/Scripts/python.exe.
Ouvrir **research/output/dataset/index.html** pour l'audit visuel.
Le dossier contient manifest.json, idle.npz, left.npz, right.npz et les
aperçus PNG. Aucun fichier généré n'est commité. Les artefacts CI
fournissent le corpus hors ligne, sans dépendance runtime.

## Corpus et séparation

115 poses compilées : idle 43 (40 ms), left 36 (60 ms), right 36 (60 ms).
Deux familles indépendantes seulement : idle et locomotion.
Right dérive de left ; les deux ne doivent jamais être répartis entre splits.
La V1 affecte idle à train (31 fenêtres), locomotion à development
(48 fenêtres), et laisse test vide. Le développement est exploratoire :
ces clips ont déjà été examinés par nos benchmarks et ne sont pas
des échantillons de test indépendants. Les fenêtres chevauchantes
ne multiplient pas le nombre de mouvements indépendants.
La séparation est faite par famille avant toute construction des fenêtres,
et les duplications exactes ou miroir exact dans le repère commun sont
rejetées entre familles. D'autres dérivations nécessitent une déclaration
correcte de la famille ; ce contrôle ne détecte pas tous les doublons proches.

## Format V1

Chaque clip possède une archive NumPy compressée (NPZ sans pickle),
dans le repère scène 400 x 400, x positif vers la droite, y vers le bas.
Idle est centré par un décalage fixe (+100,+100), sans redimensionnement.
Left/right restent dans leur repère original de scène.
Cadences natives préservées : les temps en secondes sont fournis.
Les rasters ont les teintes 0 vide, 1/2 corps, 3 œil.

| Champ | Forme | Type / unité |
| --- | --- | --- |
| rasters | T,400,400 | uint8, teinte exacte |
| density | T,2,100,100 | uint8, points/cellule 4x4 |
| velocity | T,2,100,100,2 | float32, px/s, (vx, vy) |
| matched | T,2,100,100 | uint8, support du déplacement |
| births | T,2,100,100 | uint8, points non appariés apparus |
| deaths | T,2,100,100 | uint8, points non appariés disparus |
| transition_valid | T | bool |
| time_seconds | T | float64, secondes depuis la première pose |

Axe des groupes : corps (0), œil (1). La densité est mesurée directement.
La vitesse est une moyenne de déplacements gloutons V1 sur chaque cellule
d'arrivée, estimée entre t-1 et t ; matched indique le nombre de paires
qui la soutiennent. Une vitesse nulle sans support est inconnue, pas une
mesure d'immobilité. Les naissances sont comptées dans la cellule d'arrivée,
les disparitions dans la cellule de départ. Les appariements sont recalculés
sur les rasters (rayon 12 px, huit voisins), sans réutiliser les identités
compilées. Ce sont des pseudo-étiquettes, pas une vérité de trajectoire
physique ni des annotations anatomiques fines. Les 3 classes de teinte
sont conservées intégralement dans les rasters. La première transition
est invalide, pas de raccord à la fin de la boucle.

manifest.json conserve provenance et SHA-256, dimensions sources,
décalages, cadence, actions déclaratives, familles, splits, fenêtres et
checksums NPZ. Les fenêtres sont indexées (start zéro-based) sans copier
les images dans chaque exemple.

## Utiliser un exemple en Python

```python
# Depuis research/ ou avec research/ dans PYTHONPATH.
from dataset.reader import MotionDataset

dataset = MotionDataset("output/dataset", "train")
sample = dataset[0]
observations = sample["inputs"]  # 5 poses
expected = sample["targets"]     # 8 futures, uniquement pour la loss
print(observations["rasters"].shape)  # (5, 400, 400)
print(expected["rasters"].shape)      # (8, 400, 400)
```

Chaque sample contient aussi metadata (clip, famille, action, cadence,
origine 1-based). Les temps de fenêtre sont relatifs à la dernière pose
connue. La transition qui arrive à la première observation est masquée
pour ne pas exposer le passé extérieur à la fenêtre. Les quatre autres
transitions ne dépendent que des observations. Les cibles futures sont
séparées explicitement ; un futur entraîneur ne devra jamais les injecter
dans les entrées. Normalisation éventuelle à ajuster uniquement sur train,
pas sur le corpus complet. Les NPZ sont chargés une fois par clip et
les fenêtres retournées sont copiées pour éviter les mutations.

## Ajouter une animation

Le registre clips.json décrit les sources existantes. Pour une nouvelle
source raster validée, créer une archive NPZ locale avec :
- rasters : tableau uint8 T,H,W, teintes 0..3, H/W <= 400, T >= 13 ;
- frame_duration_ms : scalaire positif ;
- loop : booléen scalaire optionnel (défaut false).

Copier le registre, ajouter une entrée id, family, action, source
("npz:chemin/vers/saut.npz" relatif au registre), mirrorOf (null ou id),
puis affecter la famille à un split unique. Lancer
`python research/build_dataset.py --registry chemin/clips.json`.
Les archives proviennent d'un prétraitement explicite des sources artistiques,
pas d'images prédites. Les nouvelles sources ne sont pas importées dans
le moteur automatiquement. Un mouvement dérivé ou augmenté conserve
la famille de son original. Ne pas utiliser un clip de test pour choisir
les hyperparamètres.

## Étape suivante

Un prototype neuronal peut être testé pour sa capacité à sur-apprendre
quelques fenêtres (sanity check) et à dépasser la référence immobile sur
le développement. Un véritable résultat de généralisation exige plus
de mouvements indépendants et un jeu de test réservé. Priorité : plusieurs
prises de saut, arrêt, rotation, clignement et changements de direction.
