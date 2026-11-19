# Analyse des mouvements — V1 (hors navigateur)

Cette étape prépare l'apprentissage du style d'IA-Persona sans ajouter de
fonctionnalité ni de coût à la boucle Canvas. Elle analyse les **poses cibles**
exportées de l'animation idle ; elle **ne mesure pas** les trajectoires finales
des ressorts pendant l'affichage.

## Exécution

```bash
node tools/analyze_motion.cjs
node tools/analyze_motion.cjs --check
node --test tests/motion-analysis.test.cjs
```

La commande écrit `assets/animations/analysis/idle.motion.json`. Le mode
`--check` compare le profil à une régénération déterministe et renvoie un code
d'erreur s'il manque ou diffère.

Pour une future animation déjà compilée au format
`gzip-particle-major-rgb3-dynamic` compatible avec la carte et l'anatomie :

```bash
node tools/analyze_motion.cjs \
  --animation assets/animations/another-targets.js \
  --output assets/animations/analysis/another.motion.json
```

Le programme requiert Node.js 22 ou une version compatible, sans npm ni
dépendance additionnelle. Les animations transmises par `--animation` doivent
être des modules JavaScript **de confiance** : `require()` exécute leur code.
Les nouvelles séquences d'images devront d'abord être compilées avec un
exporteur adapté ; cet analyseur ne transforme pas directement un ZIP de PNG.

## Méthode

- **Source** : `assets/animations/idle-targets.js`, non modifié.
- **Cadence** : 43 poses / 1 720 ms, soit 40 ms entre deux poses à 1×.
- **Pool** : 16 162 identifiants persistants ; 13 623–16 103 visibles suivant
  la frame. La présence est définie par `shade !== 0`.
- **Régions** : les 11 zones de `assets/persona-anatomy.js`. Chaque identifiant
  conserve sa région de la carte source et les 276 nouveaux identifiants
  héritent de la région de leur source.
- **Géométrie, par frame** : centre moyen, rectangle englobant, population,
  ratio de couverture, centre et dimensions par région, position régionale
  relative au centre du corps.
- **Trajectoires, par transition** : vitesses des particules actives dans les
  deux frames, vitesse vectorielle du centroïde, accélération discrète,
  apparitions/disparitions et vitesses par région. Toutes les valeurs
  représentent des distances en pixels par seconde, sauf les déplacements
  bruts du centroïde en pixels.
- **Silhouette** : IoU des pixels occupés et IoU après compensation arrondie de
  la translation des centres pour distinguer translation et déformation.
- **Temporalité** : pics/creux de la moyenne des vitesses, après lissage
  circulaire sur trois transitions ; déphasage des vitesses régionales par
  corrélation circulaire avec la vitesse du corps. Valeur `null` si peu fiable.
- **Bouclage** : la dernière transition analyse explicitement la frame 43
  vers la frame 1.

Aucune classification subjective (« doux », « joyeux », « hésitant »)
n'est déduite automatiquement. Les champs `annotations` commencent sans
étiquette et devront être validés par une personne avant tout entraînement.

## Limites connues

1. L'appariement spatial des identifiants est issu de l'exporteur. Il peut
   produire un grand déplacement d'ID même lorsque la silhouette évolue peu.
   Comparer la vitesse des IDs avec la vitesse du centre et l'IoU.
2. Une région est attachée à l'identité de particule initiale ; ce n'est pas
   une segmentation de chaque frame. Vérifier visuellement avant de conclure
   à un déplacement anatomique important.
3. Les vitesses sont échantillonnées à 25 Hz, pas au FPS réel du Canvas.
   Une accélération numérique élevée n'implique pas à elle seule un clignotement.
4. La corrélation de phase sur **un seul cycle** n'établit pas une relation
   causale entre régions. Elle peut être `null`.
5. Une animation idle ne suffit pas à apprendre un style de mouvement complet.
   La prochaine animation validée enrichira le jeu de références.

## Contrat d'intégration ultérieure

L'analyseur est un outil de préparation **offline**. Une IA peut lire les
résumés et séries temporelles du JSON et formuler des propositions ou des
annotations. Aucune IA ne génère ni ne pilote d'animation dans cette version.
Un générateur/compilateur futur devra produire des poses compatibles et les
faire valider, tout en conservant les sources et les 43 frames originales.

`docs/PROJECT.md` et `docs/technical-information/particle-morphing.md`
restent intacts.
