# Motion Reconstruction V1

Expérience indépendante, inspirée par les champs de vitesse de
[Wassersplines](https://arxiv.org/abs/2201.11940), sans implémenter son solveur
neuronal ni son transport optimal. Objectif : établir un banc de comparaison
reproductible, pas créer une animation de production.

## Lancer

Depuis la racine, avec l'environnement décrit dans [Motion Lab](../README.md) :

```sh
research/.venv/bin/python research/reconstruct.py
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Windows : utiliser research/.venv/Scripts/python.exe.
Ouvrir research/output/reconstruction/index.html (aucun serveur nécessaire).
Le dossier complet doit rester ensemble : index.html, viewer.css, viewer.js
et data.js. Le rapport détaillé est report.json. Modifier --cell (4 px par
défaut) ou --radius (12 px) pour une expérience explicitement distincte.
Ne pas ajuster ces paramètres sur les scores masqués pour prétendre mesurer
ensuite une généralisation : il faudra un ensemble de validation séparé.

## Protocole

Le décodeur existant fournit les 43 poses. Elles sont immédiatement
rasterisées en cartes de teintes ; les identités exportées et les coordonnées
inactives ne sont pas utilisées pour reconstruire les trajectoires. Ensuite,
seules les images sélectionnées sont transmises à reconstruct().
La référence complète reste dans le code d'évaluation et le visualiseur.
Les paramètres sont fixés avant chaque expérience.

| Intervalle | Poses connues | Poses masquées |
| --- | ---: | ---: |
| 2 | 22 | 21 |
| 3 | 15 | 28 |
| 4 | 12 | 31 |

La première et la dernière pose sont toujours fournies. Ce test interpole
dans le cycle enregistré ; il ne prédit pas son futur et ne valide pas le raccord
43 → 1. Chaque score spatial moyen porte exclusivement sur les poses masquées.

Appariement commun : candidats proches (8 maximum, rayon de 12 px),
tri par distance, affectation gloutonne unique, œil et corps séparés.
Cette méthode privilégie les pixels déjà superposés et peut sous-estimer
le déplacement réel d'une matière homogène. Elle ne prétend pas retrouver
l'identité physique des pixels. Les correspondances non satisfaites sont
traitées comme apparitions/disparitions, selon une sélection spatiale
déterministe commune aux méthodes. Pas de masse conservée artificiellement.

- Linéaire : interpolation directe.
- Cubique : Hermite, pentes déduites des intervalles observés adjacents, limitées
  composante par composante pour réduire les dépassements.
- Champ : grille de déplacements lissés, séparée pour l'œil et le corps,
  intégration midpoint en quatre sous-pas depuis les deux extrémités,
  mélange temporel des chemins pour respecter les extrémités.
  Faute de support local, déplacement linéaire individuel.

Rasterisation commune par arrondi et priorité de teinte (œil > corps)
en cas de collision. Mesure indépendante de la population prévue, des
collisions et des points hors cadre. Les pixels perdus ainsi ne sont pas
artificiellement remplis. Les changements de teinte sont discrets.

## Évaluation

IoU silhouette et œil (1 = recouvrement exact), distance moyenne symétrique
au pixel occupé le plus proche (px), différence absolue de population,
collisions et sorties de cadre. Le jerk comparé est celui du centroïde de la
silhouette (px/s³), pour les fenêtres affectées par les poses masquées.
Ce n'est pas une mesure de trajectoire individuelle : les identités ne sont
pas observables dans les images et les aligner sur la référence créerait un biais.
Le temps rapporté concerne l'expérience entière, appariement inclus, pas les
FPS ni un benchmark isolé de chaque méthode.

Le visualiseur affiche les quatre suites synchronisées, permet de changer
d'échantillonnage, de lire/pauser et d'inspecter une frame avec ses scores.
Ce sont des rasters de diagnostic, pas la simulation Canvas du personnage.
La palette est illustrative ; les indices de teinte et l'occupation sont exacts.

## Limites et suite

Une reconstruction peut être médiocre et le champ peut être moins performant
que l'interpolation linéaire : c'est un résultat scientifique recevable.
Les pixels d'une silhouette uniforme ne permettent pas d'identifier un
mouvement interne unique. Cette expérience ne démontre pas un apprentissage
du style, une extrapolation, ni un gain de performance du moteur.
Avant de passer à la prédiction : examiner les collisions, les correspondances
et les écarts par frame ; tester une autre animation validée et un protocole
chronologique séparé. Le runtime, les assets sources et PROJECT.md restent intacts.
