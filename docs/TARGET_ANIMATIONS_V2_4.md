# V2.4 — Animations par convergence vers des frames cibles

## Objectif et contrat

Conserver les **15 886 pixels vivants**, leurs rôles, leurs matériaux et le graphe
physique, tout en leur faisant reconstruire les poses de PNG de référence. Le
GIF n'est **jamais affiché** dans le navigateur et ne sert qu'à la compilation.

**Une frame PNG devient une distribution cible de positions et de teintes.**
Les particules existantes suivent cette distribution au moyen de la physique,
avec interpolation entre les poses. Aucun objet particule n'est recréé par frame.

## Périmètre de cette PR

Seule l'animation `idle` est intégrée. La nouvelle référence est
`idle-frames.zip`, avec **43 PNG de 190 × 286 pixels**. L'examen des masques
montre deux cycles quasi identiques, décalés de 21 frames : la frame 22
retrouve presque exactement la frame 1. L'asset est donc construit à partir
des **22 premières poses**, sur **1,76 seconde** (80 ms/pose, valeur choisie
pour l'export ; le ZIP ne comporte pas de métadonnées de temps).
Cela évite de faire tourner deux fois l'animation `idle` dans une boucle.

### 1. Préparation de la référence

`assets/animations/idle-frames.zip` est la **source active** fournie par
l'utilisateur, conservée sans modification. L'ancien `idle-reference.gif`
reste dans le dépôt pour l'historique et ne sert plus à l'export.

`tools/export_target_animation.py` applique à chaque image un **cadrage
fixe `(0, 8, 190, 225)`** : il préserve les petites gouttes supérieures
et les pattes, tout en excluant l'inscription `IDLE`.
Les pixels deviennent des classes noir / gris / blanc sur un masque 200 × 200.
Aucune frame n'est recentrée indépendamment des autres.

La première et la dernière pose de la boucle contiennent la même disposition
de particules (fermeture explicite des destinations) pour empêcher une
permutation d'identités au raccord. Toutes les poses intermédiaires sont
interpolées à leur cadence originale choisie.

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
de pixels visibles que le dessin d'origine. Le rendu fusionne ces collisions.

**Correction importante** : le transport glouton initial laissait des pixels
sans particule lorsque des correspondances résiduelles pointaient vers les mêmes
cibles. Le dernier passage répartit désormais les points restants sur les cibles
encore disponibles dans un ordre spatial stable (courbe de Hilbert). Les poses
mesurées couvrent plus de 99,7 % des pixels visibles ; l'identité des
15 886 particules est conservée.

### 3. Asset compact et chargement

Le résultat contient un triplet `(x, y, teinte)` par particule et par pose, en
ordonnancement *particle-major* pour favoriser la compression GZIP. La carte
de cibles générée occupe environ **130 Ko compressés**,
contre plus de **1 Mo** brut. Elle est décompressée **une seule fois** en navigateur à l'aide de
l'API native `DecompressionStream('gzip')`, puis validée : dimensions, nombre
et teintes des points, empreinte de la carte source.

Cela n'ajoute aucune bibliothèque JavaScript externe. Le navigateur doit prendre
en charge `DecompressionStream` ; un échec est explicitement affiché.

### 4. Lecture et convergence

`target-animation-player.js` gère le temps, la frame courante, la suivante,
l'interpolation, la boucle et l'arrêt. `particle-world.js` accepte une pose
optionnelle ; il dirige alors les points vers les nouveaux objectifs par un
ressort et un suivi amorti. **Pendant la lecture du clip, les forces de
cohésion vers l'ancien dessin et les ondulations procédurales ne sont plus
superposées aux destinations cibles**. Le clignement automatique de l'ancien
idle est également désactivé : le visage est celui des frames PNG.
Ces effets redeviennent disponibles hors clip ; `hit` et `reveal`
peuvent temporairement interrompre le suivi physique.

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

**Limites** : l'extraction de la référence repose sur un seuil de gris et un
crop spécifiques aux PNG reçus. Le parcours entre deux poses reste une
correspondance géométrique approximative, pas un flux optique parfait.
Le clip ne définit ni un squelette, ni des contraintes anatomiques animées.
Le rythme de 80 ms/frame est une **hypothèse explicite** ; il peut être changé
par `--frame-duration-ms`. L'import multi-animation et le pilotage libre
par une IA restent des évolutions ultérieures.
