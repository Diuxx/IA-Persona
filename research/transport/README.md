# Optimal Transport V1 — appariement global partiel

Expérience hors moteur, sur les 43 poses idle et les 36 poses compilées de
chacun des déplacements left/right. Elle ne modifie ni les identités du
moteur ni les sources graphiques. Right étant le miroir de left, ce n'est
pas un deuxième mouvement indépendant.

## Lancer

Avec le venv existant (et ses dépendances, inchangées) :

```sh
research/.venv/bin/python research/optimal_transport.py
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Windows : remplacer research/.venv/bin/python par research/.venv/Scripts/python.exe.
Ajouter --clip idle, left ou right pour une seule animation.
Ouvrir **research/output/transport/idle/index.html** (ou left/right).
Les dossiers générés contiennent report.json, data.js et les trois fichiers
du visualiseur. Le ZIP CI s'ouvre directement après décompression.

## Formulation

Chaque pixel visible fournit une unité de masse. On cherche une correspondance
partielle injective entre les points p_i et q_j minimisant :

    somme des ||q_j - p_i||² sur les correspondances
    + lambda * (nombre de naissances + nombre de disparitions)
    + w * somme des ||q_j - p_i - v_i||² lorsque v_i est connu

lambda = rayon²/2 (72 px² au rayon 12), w = 0 pour la méthode spatiale
et 0,5 pour la variante temporelle. v_i est le déplacement précédent
rééchelonné par le rapport des durées d'intervalle. Il provient uniquement
d'une correspondance estimée dans les poses observées précédentes. Il est
absent pour une nouvelle identité. Cette régularisation est séquentielle,
pas une optimisation globale de toute la vidéo.

Les arêtes candidates sont l'union des 12 plus proches voisins dans chaque
direction, dans un rayon de 12 px. Chaque source possède une destination
fictive privée représentant sa disparition ; les destinations réelles
non affectées représentent des naissances. La pénalité totale d'une naissance
et d'une disparition est identique au coût du dummy après soustraction
de la constante des naissances. Ajouter 1 à tous les coûts évite les zéros
ignorés par le solveur creux SciPy sans changer l'optimum.

Le solveur min_weight_full_bipartite_matching trouve l'optimum exact sur
ce graphe de candidats. Ce n'est pas un solveur OT continu, ni un optimum
garanti sur tous les couples de pixels. C'est une forme discrète de transport
partiel à pénalités linéaires de masse, utile ici pour le pool de population
variable. Pas de matrice dense N x M, pas de nouvelle dépendance.

## Comparaisons

Les cinq méthodes V1/V2 sont conservées. Trois nouvelles variantes :

- transport_linear : appariement global partiel, interpolation linéaire.
- transport_temporal : même graphe, coût de continuité supplémentaire.
- transport_cubic : mêmes appariements temporels, interpolation Hermite V1.

L'œil et le corps ne sont jamais mélangés. Les autres régions anatomiques
(gouttes, pattes) n'ont pas de labels indépendants dans les rasters observés ;
les récupérer à partir des identités compilées introduirait un biais. Une
segmentation anatomique indépendante et la régularisation multi-frames
globale sont donc des expériences futures, pas des capacités de cette V1.

La même rasterisation et le même calendrier d'apparition/disparition V1
sont utilisés. Évaluation seulement sur les poses masquées (1/2, 1/3, 1/4,
première et dernière toujours observées). Tous les paramètres sont fixés
avant le benchmark ; ne pas sélectionner un modèle sur ces mêmes scores
puis prétendre mesurer sa généralisation.

## Mesures

Les indicateurs V1/V2 sont conservés (IoU, œil, population, distance,
collisions, jerk du centroïde). Le rapport ajoute, par groupe et intervalle,
le coût de transport et de masse non appariée, le coût temporel, la couverture
et le nombre d'arêtes. Les coûts des deux objectifs ne sont pas strictement
comparables, puisque le second contient une pénalité supplémentaire.
transportSeconds inclut les deux solveurs et les trois reconstructions.

Les tests incluent un contre-exemple glouton, une comparaison exhaustive
sur de petits problèmes, une variation de population, une ambiguïté levée
par le coût temporel, des poses exactes et l'absence de fuite des frames
masquées. Le transport peut encore privilégier des pixels immobiles au sein
d'un corps uniforme, et minimiser son coût ne garantit ni l'IoU ni la fluidité.
L'objectif suivant sera une évaluation chronologique de la prédiction,
incluant une référence immobile et une extrapolation à vitesse constante,
sans pose future. Aucun apprentissage neuronal n'est réalisé ici.
