# Motion Estimation V2

Objectif : expliquer pourquoi le champ V1 améliore peu la reconstruction et
tester si une estimation indépendante de l'appariement spatial aide.
Cette étape reste une interpolation offline, pas une extrapolation ni une IA.

## Exécuter

Depuis la racine, dans le venv existant :

```sh
research/.venv/bin/python -m pip install -r research/requirements.txt
research/.venv/bin/python research/estimate.py
research/.venv/bin/python -m unittest discover -s research/tests -v
```

Windows : remplacer research/.venv/bin/python par research/.venv/Scripts/python.exe.
Pour un seul clip : ajouter --clip idle, --clip left ou --clip right.
Ouvrir le fichier **généré** research/output/estimation/idle/index.html
(ou left/index.html, right/index.html) et non le modèle dans estimation/viewer.
Chaque dossier contient aussi report.json et data.js. Les artefacts CI peuvent
être décompressés et ouverts directement, sans Python. La visualisation est
comparative et n'utilise pas le moteur principal.

## Méthodes et protocole

Les trois méthodes V1 (linéaire, Hermite cubique, champ local) restent intactes.
Deux méthodes additionnelles permettent une comparaison par ablation :

1. guided_linear : flux optique dense de Farneback entre les deux poses
   observées, estimation de l'arrivée de chaque pixel, appariement glouton
   unique autour de cette arrivée, puis trajectoire linéaire.
2. guided_flow : même appariement et même calendrier d'apparitions/disparitions,
   mais mélange des trajectoires guidées par le flux avant et arrière.
   Les extrémités observées sont respectées.

L'œil et le corps sont appariés séparément. Le flux est calculé sur une carte
de teintes (0,110,170,255), paramètres fixes : pyramide 0.5/4 niveaux,
fenêtre 21, 5 itérations, poly_n 7, sigma 1.5. Le déplacement est exprimé en
pixels par intervalle observé. Un contrôle aller-retour à 2 px et un contrôle
de cadre rejettent les déplacements incohérents. Le repli pour l'appariement
est la position initiale, et pour la trajectoire le déplacement apparié.
Ce contrôle n'est pas une probabilité de correspondance correcte : un flux
nul dans une zone uniforme peut être cohérent et faux.

Les paramètres restent fixes pour les échantillonnages 1/2, 1/3, 1/4.
Les identités exportées et coordonnées invisibles ne sont jamais utilisées.
Seuls les rasters observés entrent dans les algorithmes ; les frames masquées
servent à l'évaluation. Les clips left/right à coordonnées signées sont
rasterisés dans le repère scène 400x400 par le codec runtime existant, sans
simulation physique ni troncature. Idle conserve son repère V1 200x200.
Les clips non bouclés sont évalués sur leur séquence compilée sans retour
à idle ; le viewer boucle uniquement pour la comparaison.
Right est un miroir de left et ne constitue donc pas une référence indépendante.

## Lire les résultats

Le JSON contient les mêmes métriques V1 et, par intervalle et groupe œil/corps :
couverture des appariements, nombre de déplacements nuls V1/guidés, magnitude
moyenne du flux accepté (les rejets comptent pour zéro), résidu aller-retour
moyen et nombre de déplacements acceptés.
baselineSeconds mesure le bloc V1 ; guidedSeconds le bloc guidé avec ses
diagnostics supplémentaires (dont un recalcul de l'appariement V1).
Ces temps ne sont ni des FPS ni des mesures isolées de chaque méthode.
Les versions NumPy/OpenCV et SHA-256 des sources sont consignés.

Le test synthétique de translation texturée vérifie que le flux peut retrouver
un déplacement connu. Le test de masquage contrôle que les données cachées
ne changent pas les prédictions. Les trois clips réels sont contrôlés pour
leurs dimensions, cadence, teintes et populations.

## Limites et prochaines expériences

Un flux optique ne révèle que le déplacement apparent observable dans les
images. Les zones uniformes et les changements d'apparence restent ambigus ;
les collisions/réapparitions peuvent dégrader les résultats. Ni la cohérence
aller-retour ni les scores de silhouette ne prouvent la trajectoire physique.
Le modèle ne suit pas encore temporellement les identités sur plusieurs
intervalles. L'appariement par transport optimal (non équilibré) et la
régularisation temporelle sont des expériences distinctes, à comparer après
lecture des résultats V2. Une meilleure métrique ou un autre clip peut
révéler un compromis différent. Aucun réseau neuronal, aucun serveur,
aucun changement du runtime ni de PROJECT.md.
