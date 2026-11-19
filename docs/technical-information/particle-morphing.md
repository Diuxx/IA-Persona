# Morphing de particules — retour d'étude

Étude technique du 19 novembre 2026, destinée à IA-Persona. Cette note est une référence d'implémentation, **pas une nouvelle source de vérité produit**.

## Source consultée

Projet externe : [ocinpp/particle-morph-tool](https://github.com/ocinpp/particle-morph-tool), branche master au commit [dd034f0](https://github.com/ocinpp/particle-morph-tool/tree/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a).

Fichiers examinés :
- [README : fonctionnalités et limites annoncées](https://github.com/ocinpp/particle-morph-tool/blob/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a/README.md)
- [src/core/particles.js : buffers typés persistants](https://github.com/ocinpp/particle-morph-tool/blob/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a/src/core/particles.js)
- [src/shaders/vertex.glsl : interpolation et forces procédurales](https://github.com/ocinpp/particle-morph-tool/blob/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a/src/shaders/vertex.glsl)
- [src/core/animation.js : lecture, rendu conditionnel et visibilité](https://github.com/ocinpp/particle-morph-tool/blob/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a/src/core/animation.js)
- [src/image/processor.js : conversion alpha vers particules](https://github.com/ocinpp/particle-morph-tool/blob/dd034f03886a2ffec06ff0b5bc30d51b800bbf6a/src/image/processor.js)

## Fonctionnement observé du projet externe

Le projet utilise Three.js, BufferGeometry et THREE.Points avec des attributs réutilisables pour les positions et couleurs de départ et d'arrivée. Le vertex shader interpole les attributs avec une progression uniforme, une courbe d'easing et des délais individuels ; il ajoute divers effets (tourbillon, explosion, gravité, interaction souris). Le fragment shader gère la présentation des points et les transformations colorimétriques.

Le README revendique **100 000 particules**, également déclarées dans src/core/constants.js. C'est une **configuration**, pas une mesure de FPS transposable à IA-Persona.

Le traitement de l'image utilise les pixels dont l'alpha dépasse 128. Les particules inutilisées sont placées hors champ ; les images sont préparées dans des tampons de taille fixe. Cette stratégie simplifie le passage entre images quelconques, mais **ne résout pas à elle seule la correspondance d'identité** entre points de deux poses.

La boucle gère un indicateur needsRender et évite le dessin lorsque l'onglet est masqué. À l'inverse, ses incréments uTime += 0.01 et progress += morphSpeed dépendent du nombre de frames rendues : il ne faut pas copier cette partie pour IA-Persona.

## Comparaison et décisions IA-Persona

| Propriété | Choix retenu | Motif |
| --- | --- | --- |
| Identité des points | Conserver 15 886 particules et les correspondances entre frames pré-calculées | Préserver anatomie, rôles, matériaux et mouvement reconnaissable |
| Animation | Conserver la lecture des frames cibles du GIF idle | Recomposer des poses de référence plutôt que passer entre deux images arbitraires |
| Physique | Conserver ressort, cohésion et champs de forces sur CPU | Les interactions physiques et la libre manipulation des pixels restent essentielles |
| Couleur des états | **Pas de couleur automatique** | L'expression doit venir du mouvement, conformément au choix artistique du projet |
| Temps | Conserver le pas fixe de simulation à 1/60 seconde | Stabilité indépendante des variations de FPS |
| Affichage | Conserver Canvas 2D pour l'instant | Aucun benchmark CPU/GPU comparatif ne justifie une migration vers Three.js |
| Rendu conditionnel | Adapter le principe de needsRender | Une pose figée ne nécessite pas 60 reconstructions du tampon 400 × 400 par seconde |
| Assets compressés | Renforcer la limite de décompression | Une taille de gzip limitée ne garantit pas une taille décompressée limitée |

## Corrections réalisées dans cette branche

### Dessin uniquement lorsqu'il est nécessaire

Dans app.js, le moteur continue son pas de simulation fixe lors de la lecture, mais évite writePixels + putImageData quand la simulation est **en pause** ou une frame est **figée** et qu'aucune modification visuelle n'est demandée. Le mode anatomique, l'inspection de frame, les commandes publiques, le reset et les réglages qui touchent l'image marquent explicitement le rendu à mettre à jour.

Quand document.hidden vaut vrai, ni simulation ni dessin ne sont exécutés. Au retour, le temps accumulé est réinitialisé pour éviter un rattrapage brusque, puis un rendu est demandé. requestAnimationFrame reste utilisé pour relancer simplement la boucle.

### Décompression gzip bornée avant allocation

Dans target-animation-player.js, les métadonnées source et la taille théorique sont validées. Le flux de décompression est lu par morceaux ; dès que la somme des octets dépasse la taille attendue, la lecture s'arrête avec une erreur explicite. Le tableau final n'est créé **qu'après** cette vérification. Les autres validations (positions, palette, checksum source) restent intactes.

## À étudier plus tard (non implémenté ici)

1. Mesurer précisément les coûts du solveur CPU, de putImageData et des allocations, sur PC **et mobile**, avant de changer de backend.
2. En cas de véritable goulot côté dessin, étudier un rendu GPU **hybride** : simulation physique CPU conservée, transfert des positions/couleurs vers des buffers GPU réutilisés.
3. Évaluer facultativement easing et stagger sur une animation de test, mais jamais au détriment de la fidélité aux poses et à leur cadence.
4. Pour de nouveaux GIFs ou des données d'IA, maintenir des limites strictes : nombre de points, frames, coordonnées, couleur, intensité et fréquence des commandes.

## Vérification et limites

Exécuter les tests Node, les vérifications de syntaxe puis contrôler dans Chromium : inspection d'une frame, diagnostic anatomique pendant la pause, retour à la lecture et masquage de l'onglet. Les mesures de performance restent propres au navigateur testé. **Aucun benchmark comparatif avec le projet Three.js n'a été réalisé**.

Ne pas recopier ses shaders, ses presets de couleur ou sa boucle basée sur le nombre de frames sans adaptation ; le projet externe sert ici de source d'idées techniques, pas de dépendance ni de code réutilisé.
