# V2.4 — Animations par convergence vers des frames cibles

## Objectif et contrat

Conserver les **15 886 pixels vivants**, leurs rôles, leurs matériaux et le graphe
physique, tout en leur faisant reconstruire les poses d'un GIF de référence. Le
GIF n'est **jamais affiché** dans le navigateur et ne sert qu'à la compilation.

**Une frame du GIF devient une distribution cible de positions et de teintes.**
Les particules existantes suivent cette distribution au moyen de la physique,
avec interpolation entre les poses. Aucun objet particule n'est recréé par frame.

## Périmètre de cette PR

Seule l'animation `idle` est intégrée. L'image fournie est un GIF de 190 × 292
pixels contenant **80 frames de 40 ms**, soit une boucle de **3,2 secondes**.
Le mouvement comprend les variations des volumes, les masses détachées, le
visage et les pattes ; il ne se résume pas à un changement de couleur.

### 1. Préparation de la référence

`assets/animations/idle-reference.gif` est conservé dans le dépôt.
`tools/export_target_animation.py` retire le fond gris et le texte `IDLE` en
utilisant un rectangle fixe `(0, 25, 190, 235)`, puis produit un masque logique
**200 × 200** sans recentrage entre les frames. Les noirs, gris et blancs de
l'illustration sont conservés comme familles de couleurs.

Une frame sur deux est retenue : **40 poses cibles sur les 80 frames**, à
intervalles de 80 ms. Le lecteur reconstitue les instants intermédiaires en
interpolant les destinations. Les 3,2 secondes sont conservées.

### 2. Correspondance persistante

L'exporteur commence par une correspondance spatiale de la première pose selon
une courbe de Hilbert, puis applique un transport local de chaque particule vers
les pixels de la pose suivante (`scipy.spatial.cKDTree`, recherche à passes
successives). Cela évite de refaire une affectation indépendante à chaque
frame, ce qui provoquerait des croisements importants dans la matière.

Les 375 particules blanches de l'œil sont associées à des pixels blancs ; les
pixels noirs et gris peuvent échanger leur famille de teinte au cours de
l'animation. Les catégories de matériaux, les rôles et l'anatomie restent
strictement inchangées.

Une destination peut accueillir plusieurs particules si la pose contient moins
de pixels visibles que le dessin d'origine. Le rendu fusionne ces collisions,
comme dans le lot 0.

### 3. Asset compact et chargement

Le résultat contient un triplet `(x, y, teinte)` par particule et par pose, en
ordonnancement *particle-major* pour favoriser la compression GZIP. La carte
de cibles générée fait environ **301 Ko**, contre presque **1,9 Mo** avant
compression. Elle est décompressée **une seule fois** en navigateur à l'aide de
l'API native `DecompressionStream('gzip')`, puis validée : dimensions, nombre
et teintes des points, empreinte de la carte source.

Cela n'ajoute aucune bibliothèque JavaScript externe. Le navigateur doit prendre
en charge `DecompressionStream` ; un échec est explicitement affiché.

### 4. Lecture et convergence

`target-animation-player.js` gère le temps, la frame courante, la suivante,
l'interpolation, la boucle et l'arrêt. `particle-world.js` accepte une pose
optionnelle ; il dirige alors les points vers les nouveaux objectifs par un
ressort et un suivi amorti. Les champs organiques deviennent secondaires
pour respecter la silhouette dessinée.

L'impact et la révélation gardent la priorité pendant leur déclenchement : la
force de suivi de pose s'atténue au début, puis revient pendant la récupération.
Le comportement `idle` peut être interrompu par `thinking`, `speaking` ou
`listening` : cela arrête l'animation cible, sans casser l'API existante.

### 5. API et contrôles

L'animation se joue par défaut (sauf si la réduction des mouvements est activée
par le système), et les commandes suivantes sont autorisées :

```javascript
window.persona.dispatch({ type: 'animation', name: 'idle' });
window.persona.dispatch({ type: 'animation', name: 'idle', loop: false });
window.persona.dispatch({ type: 'animation', action: 'stop' });
window.persona.getSnapshot().animation;
```

Des boutons « Jouer l'idle » et « Arrêter l'idle », plus un compteur de poses,
permettent de vérifier visuellement le parcours. Les anciennes interactions
explosion, pause, attraction, répulsion et inspection des zones sont conservées.

### 6. Vérifications et limitations

```bash
python -m pip install Pillow numpy scipy
python tools/export_target_animation.py
node --test tests/*.test.cjs
node --check target-animation-player.js
node --check particle-world.js
node --check behavior-controller.js
node --check app.js
python -m http.server 8000
```

Les tests vérifient l'asset, la continuité du mouvement, les états, les
transitions, les pauses, l'identité des particules, les couleurs, le bornage
des commandes et la répétabilité. Le rendu doit être vérifié visuellement dans
le navigateur : les performances sont dépendantes de la machine.

**Limites** : l'extraction de la référence repose sur un seuil de gris et un crop
spécifiques à ce GIF ; certains pixels peuvent se superposer ou manquer sur
les grandes déformations. Une pose cible n'est pas un squelette ni un flux
optique parfait. L'import multi-GIF, la sélection d'animations contextuelles
et le pilotage direct par une IA restent des lots ultérieurs.
