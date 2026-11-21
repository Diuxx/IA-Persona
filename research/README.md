# Motion Lab V1 — observer la matière numérique

Expérience indépendante du moteur Canvas. Référence scientifique :
[Wassersplines for Neural Vector Field-Controlled Animation](https://arxiv.org/abs/2201.11940).
Le laboratoire n'implémente pas Wassersplines : il établit une référence descriptive
pour de futurs essais d'interpolation et de prédiction.

## Exécution

Depuis la racine, Python 3.10+ et Node.js 22 recommandé :

```sh
python -m venv research/.venv
# Linux / macOS :
research/.venv/bin/python -m pip install -r research/requirements.txt
research/.venv/bin/python research/run.py --frame 20
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Sous Windows PowerShell, remplacer research/.venv/bin/python par
research/.venv/Scripts/python.exe. Aucun paquet npm ni serveur n'est nécessaire.
--cell 4 (défaut) règle la résolution spatiale ; --frame sélectionne la pose
(1 à 43) du graphique. Les mesures portent toujours sur toutes les poses.

## Résultats locaux

- output/idle.motion-lab.json : unités, provenance SHA-256, populations,
  statistiques de vitesse, accélération, jerk et résidus par région ;
  divergence, rotation et déformation par transition.
- output/idle.fields.npz : tableaux NumPy des 43 poses, identités implicites
  (axe particule), teintes, visibilité, régions, dérivées, champs et masques.
  Les champs ont les axes (frame, y, x) ; les trajectoires (frame, id, xy).
- output/idle.fields.png : silhouette, flèches de vitesse, densité et cartes
  du champ pour la pose demandée. Les cases sans support restent vides.

Ces sorties générées sont ignorées par Git. Les sources et le profil Node V1
ne sont pas modifiés. Le pont Node charge uniquement les assets de confiance
du dépôt et réutilise leur décodeur validé.

## Méthode et limites

Les différences finies sont calculées à 40 ms, y compris le raccord 43 → 1.
Une dérivée nécessite des échantillons visibles consécutifs (2 pour la vitesse,
3 pour l'accélération, 4 pour le jerk). Les valeurs absentes sont NaN dans NPZ
et null pour les statistiques JSON sans échantillons.

La grille agrège les vitesses au départ de chaque transition, avec un filtre
gaussien normalisé (sigma = une cellule) et un seuil de support documenté dans
le code. Les dérivées spatiales centrées ne sont évaluées qu'avec quatre voisins
valides. Le taux de déformation est la norme de Frobenius du gradient de
vitesse symétrisé : ce n'est pas une mesure directe d'élasticité.
Le repère image possède un axe y vers le bas : curl positif correspond à une
rotation horaire. La densité compte les points visibles dans chaque cellule.

Le résidu compare une vitesse d'identité à l'estimation locale (incluant
cette même identité). Un résidu élevé peut signaler un appariement suspect
ou un mouvement réel ; ce n'est ni une probabilité ni une preuve d'erreur.
Les grandes déformations, le choix de grille et le lissage peuvent biaiser
les mesures. Le modèle n'infère pas de trajectoire pendant une invisibilité.
Les trajectoires sont des cibles exportées, pas des mesures de la simulation
physique. Une seule boucle ne suffit pas pour apprendre un style généralisable.

## Suite expérimentale

1. Inspecter les cartes à plusieurs résolutions et comparer les résidus aux
   silhouettes originales ; vérifier notamment l'œil et les gouttes.
2. Reconstruire des poses masquées en comparant interpolation linéaire,
   cubique et champ de vitesse, sans utiliser les frames masquées pour
   l'appariement ou l'ajustement (éviter la fuite de données).
3. Évaluer IoU, population, erreurs spatiales et temporelles avant toute IA.
4. Adapter le contrat aux clips gauche/droite (leur format de pool diffère),
   puis tester la prédiction sur des séquences distinctes.

Pas de réseau neuronal, serveur, modification du runtime ni changement de
docs/PROJECT.md. Toute intégration ultérieure fera l'objet d'une décision
séparée.

## Reconstruction V1

Voir [le banc de comparaison des poses masquées](reconstruction/README.md).
