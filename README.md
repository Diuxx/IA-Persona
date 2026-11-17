# Nuage — premier idle en JavaScript

Démo HTML/CSS/Canvas 2D construite à partir du PNG de référence fourni.
Pas de bibliothèque à installer.

## Démarrer

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur statique :

```bash
cd nuage-idle-js
python -m http.server 8000
```

Puis accéder à `http://localhost:8000`.

## Structure

- `index.html` : interface de démonstration.
- `styles.css` : présentation responsive.
- `app.js` : chargement et animation continue des calques sur Canvas 2D.
- `assets/*.png` : 13 couches PNG transparentes, **alignées sur le repère d'origine**. Elles ont toutes la même taille (724 × 820 px, source multipliée par quatre). Cette méthode évite d'avoir à repositionner chaque couche au pixel près.
- `assets/cropped/*.png` : les mêmes calques, recadrés pour les réutiliser dans un autre moteur.
- `assets/manifest.json` : position et dimensions de chaque calque recadré, exprimées en pixels de l'image d'origine.
- `source.png` : capture de référence originale (181 × 205 px).
- `tools/split_assets.py` : script de découpage avec Pillow, NumPy et OpenCV.

## Comportement idle

Les animations sont superposées plutôt que remplacées :

- flottement vertical sur environ 3,8 s ;
- très légère respiration et inclinaison du corps ;
- faible oscillation indépendante des trois volumes gris ;
- animation douce des pattes et du sourire ;
- gouttelettes et particules avec périodes différentes ;
- micro-contraction ponctuelle et effet de profondeur limité au survol.

Contrôles : intensité de 0 à 150 %, pause et vue éclatée des calques.

## Limites

La source est une capture **aplatie de seulement 181 × 205 pixels**. Les volumes séparés ne disposent pas de dessin sous les zones cachées. Les transformations restent donc volontairement discrètes ; des mouvements plus amples exigeraient de redessiner le personnage en vectoriel ou de compléter les zones occultées.

La démo n'est pas encore connectée à Ollama et ne contient pas les états `thinking`, `listening` ou `speaking`.

Le réglage de réduction des mouvements du système désactive l'animation idle automatiquement.
