# Décomposition de la séquence « Aller à gauche puis s'arrêter »

Cette note décrit **ce qui est observé** dans les 34 PNG fournis et distingue
l'intention donnée par le propriétaire des mesures réelles. Elle complète
[le premier analyseur idle](motion-analysis-v1.md) sans modifier
l'architecture de référence immuable `docs/PROJECT.md`.

## Source et méthode

- Source : `assets/animations/left-frames.zip` (34 images ordonnées, 374 × 200).
- Le fichier transmis est **identique octet pour octet** à cette archive déjà
  présente dans le dépôt (SHA-256
  `98618dd7e12816c764c335563437f08eb0ec5402fe5ec748e1d5b83e6ae1127d`).
- **Cadence inconnue** : les PNG n'indiquent pas de durée par image. Le JSON
  laisse `frameDurationMs` et `durationMs` à `null`. Ne pas supposer les
  40 ms de l'idle.
- Seuils de silhouette alignés avec la classification existante : gris
  `<=93` ou `>=139`, sur fond 102.
- Le « corps principal » est le plus grand composant connexe à 8 voisins.
  Les pixels clairs sont des **candidats pour l'œil** et les autres composants
  sont regroupés comme « matière détachée ».
- La correspondance anatomique des **11 régions et les identifiants persistants**
  de l'idle ne sont **pas déduits** de ces PNG : cette étape nécessite un
  appariement dédié lors de la compilation.

## Résultats mesurés

| Mesure | Résultat |
| --- | ---: |
| Centre du corps principal, frame 1 | x = 161,722 px |
| Centre le plus à droite | frame 15 |
| Centre le plus à gauche | frame 31, x = 97,469 px |
| Déplacement maximal vers la gauche depuis le départ | 64,253 px |
| Déplacement net à la frame 34 | -17,149 px |
| Retour depuis la position la plus à gauche | 47,104 px |
| Variation de hauteur du corps principal | 40 px |
| Intervalle de pixels visibles | 16 079–23 311 |
| Déplacement du centre entre frames 33 et 34 | 34,144 px |
| IoU des silhouettes entre frames 33 et 34 | 0,686 |

### Lecture de la séquence

Le premier tiers présente plusieurs poses quasi identiques et des
changements de silhouette. Le corps principal atteint sa position la plus à
droite vers la **frame 15**. Une phase de déplacement vers la gauche domine
ensuite, avec un minimum horizontal à la **frame 31**. Les dernières frames
présentent un **retour partiel vers la droite**.

Les paires et suites quasi identiques sont identifiées dans
`summary.nearIdenticalHolds`. Ce sont des ressemblances de silhouettes,
**pas une preuve de durée d'immobilité**.

### Arrêt final : non démontré

La dernière transition (33 → 34) déplace le centre principal d'environ
34 px et modifie fortement la silhouette (IoU 0,686). La séquence donnée
montre donc le déplacement souhaité mais **ne démontre pas une stabilisation
progressive à sa fin**. Elle peut très bien être suivie d'un arrêt par le
lecteur, mais cet arrêt n'est pas encodé par plusieurs poses finales stables.

Lors de la future compilation, il faudra traiter explicitement le mode
**one-shot + maintien de la pose finale**, ainsi que l'amortissement avant
cette pose, sans altérer les 34 images originales.

## Profil JSON et exécution

Le profil est stocké dans
`assets/animations/analysis/left.motion.json`. Chaque frame conserve
les dimensions, le centre et les limites de la silhouette, du composant
principal, de la matière détachée et des pixels clairs. Les 33 transitions
contiennent l'IoU, le déplacement et les variations de pixels occupés.

```bash
python tools/analyze_source_motion.py
python tools/analyze_source_motion.py --check
python -m unittest discover -s tests -p 'test_source_motion.py' -v
```

Dépendances d'analyse hors navigateur : Python, Pillow, NumPy et SciPy,
déjà utilisés par les outils d'export du projet. Une cadence *documentée*
peut être ajoutée avec `--frame-duration-ms 40`, mais seulement si elle
est confirmée par une source fiable. L'option `--name` et `--intent`
permettent de réutiliser cet analyseur sur un autre ZIP compatible.

## Limite d'intégration

L'archive utilise un canvas **374 × 200**, alors que le lecteur actuel
attend des poses **200 × 200**. Certaines frames ont plus de 23 000 pixels
visibles ; la capacité de l'idle est de 16 162 particules. Injecter ces
pixels tels quels dans le lecteur ferait donc perdre des positions ou
casserait les validations existantes.

**Cette PR ne modifie pas le lecteur ni la simulation.** Une prochaine
étape devra définir un cadre commun fixe, préserver les mouvements hors
corps, apparier des identifiants persistants et proposer un arrêt amorti,
puis vérifier visuellement le résultat.

L'intention `aller à gauche et s'arrêter` est enregistrée comme **intention
fournie par l'utilisateur**, non comme un comportement automatiquement
validé par les mesures.
