# Neural Motion V1 — premier modèle appris

Prototype de recherche indépendant du moteur. Il prédit huit cartes de
teinte futures à partir de cinq poses passées. Il n'est pas encore un
générateur de trajectoires physiques ni un agent pilotant IA-Persona.

## Installation CPU

Depuis la racine, réutiliser le venv de recherche :

```sh
research/.venv/bin/python -m pip install -r research/requirements.txt
research/.venv/bin/python -m pip install -r research/neural/requirements.txt --index-url https://download.pytorch.org/whl/cpu
research/.venv/bin/python research/build_dataset.py
research/.venv/bin/python research/train_neural.py
```

Windows : remplacer research/.venv/bin/python par research/.venv/Scripts/python.exe.
PyTorch reste optionnel pour les autres expériences ; aucun paquet JS,
serveur ou nouvelle dépendance runtime. CUDA peut être utilisé avec une
installation PyTorch compatible et --device cuda. Par défaut CPU, deux
threads, largeur 24, six epochs, batch 1, AdamW à 0,001, graine 2026.
Une expérience rapide peut utiliser --epochs 1 --sanity-steps 4.
Les valeurs sont définies avant évaluation et ne résultent pas
d'une recherche d'hyperparamètres sur development.

## Architecture

Les cinq rasters [5,400,400] sont convertis en trois canaux de teintes
visibles et réorganisés en patches 4x4 par pixel_unshuffle. Ce n'est pas
une réduction de résolution : les 16 positions d'un patch restent
distinctes. On concatène les densités, les nombres de correspondances,
apparitions et disparitions, les vitesses moyennes, la validité des
transitions et le temps relatif. Les quantités sont divisées par 16
(comptages), 300 px/s (vitesses, limitées à +/-4 après normalisation)
et 0,32 seconde (temps). Aucune statistique du split development/test
n'est utilisée pour la normalisation.

Quatre convolutions locales, dont deux dilatées, apprennent des motifs
spatiaux et temporels. Une tête 1x1 produit les corrections de logits
des huit horizons et quatre teintes. Pixel_shuffle reconstruit des cartes
400x400 sans interpolation de résolution. Une priorité de 2 logits
est donnée à la dernière teinte observée ; la tête de correction
est initialisée à zéro. Ainsi argmax avant entraînement = pose figée.
Le réseau doit apprendre à modifier cette pose pour améliorer la prévision.
La fonction de coût est une entropie croisée pondérée : poids 1/2/2/6
par classe, facteur 4 sur les pixels dont la teinte change. Les poids
favorisent les gouttes/bords changeants et l'œil plutôt que le grand fond
vide. La perte n'est pas une mesure directe de fluidité.

Les huit horizons sont prédits conjointement, sans vraie frame future
en entrée ni teacher forcing. La population est libre de changer via
les classes vide/visible. Les champs de déplacement sont des entrées
estimées du dataset ; le réseau ne prédit pas des identités ni des vitesses
physiques. Il prédit des rasters, à comparer avant de développer un
convertisseur en poses de particules. Ce V1 n'est pas conditionné par
une commande (saut/gauche/etc.) ni par un modèle de langage.

## Protocole

1. Sanity check : entraîner un modèle jetable sur deux fenêtres de train
   fixes pendant 24 pas. Vérifier si la perte sur ces mêmes fenêtres baisse.
   Ce test démontre seulement une capacité à apprendre/mémoriser.
2. Réinitialiser complètement le modèle et entraîner sur les 31 fenêtres
   idle du split train, avec mélange reproductible. Pas de sélection
   de checkpoint sur development.
3. Enregistrer les poids finaux avant d'évaluer.
4. Comparer à hold sur les mêmes fenêtres et tous les horizons (IoU
   silhouette et œil, erreur de population, centroïde et distance).
   Les résultats train sont des mesures de mémorisation ; development
   (24 fenêtres left, 24 right) est un test exploratoire de transfert.
   Le rapport donne aussi le sous-ensemble des origines du benchmark
   Extrapolation V1, pour une comparaison à fenêtres identiques.
5. Le split test est réservé et n'est évalué qu'avec --evaluate-test ;
   il est vide dans le corpus actuel. Les fenêtres se chevauchent et
   right est le miroir de left. Aucune conclusion de généralisation
   statistique n'est possible avec seulement deux familles.

## Sorties

research/output/neural/ :
- model.pt : state_dict de tenseurs CPU, pas un modèle Python picklé ;
- model.json : architecture, largeur, SHA-256 des poids et du manifest,
  paramètres d'entraînement et version PyTorch ;
- report.json : sanity check, courbe de perte, scores par split/clip/horizon,
  métriques à origines comparables et diagnostics de l'évaluation ;
- train/idle/index.html, development/left/index.html,
  development/right/index.html : visualiseurs hors ligne, avec
  vérité, pose figée et prévision neuronale.

Les artefacts CI contiennent les mêmes fichiers. L'application principale
n'est pas modifiée et tous les fichiers générés restent hors Git.
Les collisions/sorties de cadre sont null dans les scores de raster,
car elles ne sont pas observables comme événements d'identités physiques.

Pour recharger un checkpoint provenant de ce pipeline :

```python
# Depuis research/ ou avec PYTHONPATH=research.
from neural.checkpoint import load_model
from neural.model import predict, INPUT_KEYS
from dataset.reader import MotionDataset
import torch

model, metadata = load_model("output/neural")
sample = MotionDataset("output/dataset", "development")[0]
observed = {k: torch.from_numpy(sample["inputs"][k])[None] for k in INPUT_KEYS}
raster = predict(model, observed)  # 1,8,400,400, uint8
```

Le chargeur vérifie l'intégrité des poids et utilise weights_only=True.
Ne charger que des checkpoints de provenance fiable.

## Tests

```sh
research/.venv/bin/python -m unittest discover -s research/neural/tests -v
```

Tests de dimensions, initialisation hold, apprentissage synthétique,
séparation entrées/cibles, score comparatif et rechargement des poids.
Le pipeline CI entraîne également le modèle réel avec la configuration
par défaut et publie le rapport. Les tests existants restent indépendants
de PyTorch.

## Limites et prochaine étape

Une amélioration sur idle peut être uniquement une mémorisation.
Une dégradation sur left/right est plausible car ce mouvement n'a pas
été appris. Un mouvement inédit doit être évalué sur de vraies
familles réservées ; notre priorité est d'ajouter des prises de saut,
rotation, clignement, arrêt et changement de direction. Après cela,
on pourra étudier un modèle de déplacements locaux et d'apparitions/
disparitions, un conditionnement par action et un export de cibles
compatibles avec les particules du moteur. Ne pas intégrer les rasters
de ce prototype au runtime comme des sprites.
