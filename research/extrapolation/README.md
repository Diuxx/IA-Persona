# Motion Extrapolation V1 — prédire sans destination

Première étude de prédiction causale. Le laboratoire ne connaît plus les
poses à venir, contrairement aux expériences de reconstruction. Il ne
produit pas encore de nouveaux clips runtime et n'entraîne aucun réseau
neuronal. Les assets, les identités compilées et le moteur ne changent pas.

## Lancer

Depuis la racine, réutiliser le venv de recherche existant :

```sh
research/.venv/bin/python research/extrapolate.py
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Windows : remplacer research/.venv/bin/python par
research/.venv/Scripts/python.exe. Pour un seul clip : --clip idle, left ou
right. Ouvrir le fichier généré research/output/extrapolation/idle/index.html
(ou left/index.html, right/index.html), pas le modèle source.
Les artefacts CI contiennent les mêmes fichiers et s'ouvrent hors ligne.

## Protocole chronologique

Fenêtre de cinq poses passées consécutives, origine = dernière pose connue.
Le prédicteur reçoit une copie de ces cinq rasters et les paramètres fixes.
Il génère huit poses futures à la fois, sans correction par une vraie pose
intermédiaire et sans identifiants compilés. Les horizons correspondent à
40–320 ms pour idle, 60–480 ms pour left/right. On évalue les fenêtres
décalées de quatre poses et on ajoute la dernière origine possible si
nécessaire. Pas de retour forcé à la première pose ni de bouclage de
l'idle pendant la prédiction. À chaque nouvelle origine, les observations
réelles deviennent disponibles : c'est une nouvelle expérience distincte.

Les fenêtres se recouvrent : ce ne sont pas des exemples statistiquement
indépendants. Right est le miroir de left et ne démontre pas une généralisation
à un nouvel usage. La cadence est celle des poses compilées, pas la courbe
temporelle de lecture du moteur. --horizon (1 à 31) et --stride modifient
explicitement le protocole ; ne pas optimiser sur les résultats puis
prétendre évaluer la généralisation sur ces mêmes fenêtres.

## Méthodes comparées

- hold : répète la dernière pose (référence immobile).
- centroid : translation globale à vitesse constante, mesurée entre la
  première et la dernière pose de la fenêtre.
- particle_velocity : appariements gloutons entre les deux poses observées
  distantes de deux intervalles ; prolonge leur déplacement moyen par
  intervalle. Les points non appariés restent immobiles.
- transport_velocity : même extrapolation, avec l'affectation partielle
  optimale V1 à coût spatial. Ni future correspondance, ni coût temporel.
- damped_field : lisse les vitesses issues du transport sur une grille de
  4 px (œil et corps séparés), évaluées aux dernières positions observées.
  Repli sur la vitesse du centroïde si le support local est insuffisant.
  Chaque point conserve sa direction initiale ; sa vitesse décroît
  exponentiellement (constante quatre intervalles). Ce n'est pas un
  champ réévalué pendant l'advection ni un modèle appris.
- shape_trend : extrapole l'évolution des cartes de distance signée de
  l'œil et du corps entre première et dernière observation, variation
  limitée à 3 px par intervalle et même amortissement. Le seuil zéro
  détermine l'occupation. La population peut augmenter ou diminuer.
  Il s'agit d'un modèle de forme raster, pas d'un suivi d'identités.
  L'œil reste prioritaire ; la teinte grise est conservée seulement sur
  les pixels déjà gris de la dernière observation.

Les cinq premiers modèles partent de tous les points visibles de la
dernière pose et ne modélisent pas encore les naissances/disparitions ;
leur nombre prévu reste fixe, mais les collisions et sorties de cadre
modifient le nombre réellement affiché. Les positions sont extrapolées
depuis les points initiaux à chaque horizon, donc un pixel arrondi ou
superposé ne détruit pas leur état mathématique. Le modèle de forme
teste séparément un mécanisme de variation de population. Les coûts
fixes de transport (rayon 12 px, 12 voisins) sont réutilisés.

## Mesures et visualiseur

IoU silhouette/œil, distance symétrique, erreur de centroïde, écart
absolu et signé de population, collisions et sorties de cadre
(null pour ces deux dernières dans le modèle raster de forme).
Les résultats sont agrégés par horizon et sur l'ensemble des fenêtres.
Le gain d'IoU vs hold mesure si le mouvement prédit apporte un bénéfice
par rapport à une pose immobile ; un gain négatif est un résultat valide.
Les moyennes de distance excluent les cas où la mesure est indéfinie.
forecastSeconds mesure le calcul conjoint des six variantes, pas le
rendu ni les performances temps réel.

Le visualiseur synchronise la vérité et les six prévisions, sélectionne
l'origine et le temps relatif, et permet de masquer le vrai futur.
Les rasters de diagnostic sont encodés sans perte sur deux bits par pixel.
Aucun affichage de trajectoire ne doit être interprété comme une mesure
de la véritable identité des points. Le rapport conserve les hashes
des sources et les versions des bibliothèques.

## Suite de recherche

Si les méthodes ne dépassent pas hold, étudier le mouvement prévisible
en fonction de l'horizon et les erreurs de population avant d'ajouter
de la complexité. Préparer un corpus de mouvements indépendants
(saut, arrêt, rotation, clignement), puis séparer entraînement, validation
et test par clip, pas par fenêtre. Toute génération future sera
évaluée par sa qualité visuelle en plus des scores de reconstruction.
