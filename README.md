# Nuage — premier idle en JavaScript

Démo HTML/CSS/Canvas 2D construite à partir du PNG de référence fourni.
Pas de bibliothèque à installer.

## Démarrer

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur statique :

```bash
cd IA-Persona
python -m http.server 8000
```

Puis accéder à `http://localhost:8000`.

## Structure

- `index.html` : interface de démonstration.
- `styles.css` : présentation responsive.
- `app.js` : chargement et animation continue des calques sur Canvas 2D.
- `eye-blink-controller.js` : clignement naturel de l’œil unique, indépendant de la lévitation et testé sans navigateur.
- `hit-controller.js` : chronologie exacte des huit images de référence, au rythme de 120 ms/image, avec fondus d’entrée et de sortie et tests.
- `assets/hit-explosion-sprite.png` : huit images exactes de l’animation validée, extraites sur fond transparent pour le Canvas.
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
- animation douce des pattes et de l’œil unique ;
- clignement par compression verticale du calque original en une fine fente, toutes les 3,8 à 7,5 secondes ;
- quelques doubles clignements, et un regard très légèrement mobile ;
- suivi très discret du pointeur, avec amortissement à l’entrée et au départ, sans saut ni remise à zéro de la lévitation ;
- gouttelettes et particules avec périodes différentes ;
- micro-contraction ponctuelle et effet de profondeur limité au survol.

Contrôles : intensité de 0 à 150 %, pause, vue éclatée des calques et clignement manuel.

Tester le contrôleur : `node --test tests/*.test.cjs`.

## Limites

La source est une capture **aplatie de seulement 181 × 205 pixels**. Le calque historique `assets/mouth.png` représente en réalité **un seul œil**, pas une bouche ni deux yeux. On conserve ce nom de fichier pour ne pas casser le découpage existant. Les volumes séparés ne disposent pas de dessin sous les zones cachées. Les transformations restent donc volontairement discrètes ; des mouvements plus amples exigeraient de redessiner le personnage en vectoriel ou de compléter les zones occultées.

La démo n'est pas encore connectée à Ollama et ne contient pas les états `thinking`, `listening` ou `speaking`.

Le réglage de réduction des mouvements du système désactive l'animation idle automatiquement.

## Interaction « Hit »

Cliquez sur les pixels visibles du nuage (ou focalisez le Canvas puis appuyez sur Entrée/Espace). Une animation de 0,96 seconde rejoue les huit images de la référence : impact, œil surpris, explosion des masses, retour à l’idle. Les clics pendant la réaction sont ignorés. La pause et les préférences « réduire les animations » sont respectées. Le GIF fourni sert de référence visuelle : la réaction utilise les images originales de la référence, au lieu de reproduire les poses par calcul. Le fond gris a été isolé pour préserver la transparence et l’apparence sur le Canvas.

Tests : `node --test tests/*.test.cjs`.

### Origine des images Hit

Le sprite provient du GIF généré et validé dans cette conversation pour cette mascotte. Huit images de 437 × 439 pixels ont été redimensionnées en 250 × 251, détachées de leur fond gris puis assemblées horizontalement. Cette conversion entraîne de très légères différences aux contours, mais les poses sont celles du GIF validé.
