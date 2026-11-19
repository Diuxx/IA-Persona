# IA-Persona — POC nuage de pixels vivants

Prototype expérimental remplaçant le lecteur de GIF et spritesheets : **chaque pixel visible du personnage original est un point simulé**.

## Démarrage

Ouvrir `index.html` directement ou lancer un serveur statique :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`. Aucun package npm ni service n'est nécessaire.

## Architecture actuelle (V2.5)

`index.html` est le seul fichier d'exécution à la racine. `README.md` et `AGENTS.md` restent à la racine pour GitHub et les agents.

| Répertoire | Responsabilité |
| --- | --- |
| `src/app.js` | Orchestration du Canvas, des commandes et de la boucle à pas fixe 60 Hz |
| `src/engine/` | Simulation des particules, cohésion, anatomie, rôles internes |
| `src/animation/` | Lecture des poses cibles et stabilisation visuelle |
| `src/controller/` | Interprétation, validation et transition des intentions |
| `src/ui/` | Onglets, FPS, population de particules et diagnostics |
| `src/styles/main.css` | Apparence de la page |
| `assets/` | Pixels précompilés, GIF d'exemple et images sources intactes |
| `assets/source/source.png` | Illustration originale, utilisée uniquement hors navigateur |
| `assets/animations/idle-frames.zip` | Les 43 PNG sources, inchangés |
| `assets/animations/idle-targets.js` | Données compilées de l'idle V2.5 |
| `tools/` | Exporteurs Python et test navigateur |
| `tests/` | Tests Node sans dépendance npm |
| `docs/PROJECT.md` | Architecture de référence figée, non modifiable sans autorisation explicite distincte |

L'interface expose uniquement **Animations** et **Réglages**. Les mouvements procéduraux de rôle, les sélecteurs manuels d'état (`idle`, `listening`, `thinking`, `speaking`) et les curseurs d'énergie/voix ont été retirés de l'interface. Le contrôleur d'états reste disponible par l'API `window.persona.dispatch()` en vue d'une intégration IA ultérieure.

La V2.5 conserve **43 frames en 1,72 s à 1×**, une population visible dynamique de **13 623 à 16 103 points** et un **pool réutilisable de 16 162**. Le compteur de particules est affiché à côté des FPS.

> Les sections historiques V2–V2.5 ci-dessous documentent les étapes précédentes : certains anciens chemins et contrôles n'existent plus à l'emplacement indiqué. Utiliser cette section et `docs/PROJECT.md` pour l'architecture courante.

## Interactions

- **Révéler** : les points colorés apparaissent dispersés, puis retrouvent leur forme et leurs couleurs d'origine.
- **Explosion** : une impulsion radiale disperse les points, qui reviennent sous l'effet d'un ressort amorti.
- **Clic sur la créature / Entrée / Espace** : même explosion que le bouton.
- **Idle** : lévitation et déformations douces, œil unique qui cligne à intervalles variables.
- **Couleur** : teinte appliquée pendant les transitions, puis interpolée vers la palette originale.
- **Élasticité, dispersion, pause, reset** : réglages du moteur en direct.

Les particules ne sont jamais recréées à chaque frame : seuls leurs états et le tampon d'affichage RGBA sont mis à jour. Pour une très grosse quantité de pixels ou des appareils peu puissants, une solution WebGL pourra être évaluée ultérieurement.

## Vérifications actuelles

```bash
node --test tests/*.test.cjs
node --check src/app.js
node --check src/engine/particle-world.js
node --check src/animation/target-animation-player.js
node --check src/controller/behavior-controller.js
python tools/verify_optimizations_browser.py  # nécessite Chromium + Playwright
```


## Limites

- Ce POC utilise une palette simplifiée de trois couleurs du dessin original. La silhouette reste reconnaissable mais les anticrénelages sont approximés ; la restitution exacte peut être affinée dans l'exporteur.
- Les pixels sont animés indépendamment ; aux fortes dispersions, l'aspect est volontairement celui d'un nuage de poussière.
- Aucun état LLM `thinking`, `listening` ou `speaking` ni connexion Ollama pour le moment.

## V2 — Lot 0 : stabilisation

Le moteur garde les **15 886 particules** et les animations existantes. Les corrections suivantes sécurisent son fonctionnement avant d'introduire la cohésion dans le lot 1 :

- **Clic sur un nuage déplacé :** `hitTest()` vérifie maintenant les positions vivantes des particules, dans un rayon de 3 pixels, plutôt que la carte de repos. La recherche linéaire ne s'exécute qu'à l'interaction, jamais à chaque frame.
- **Collisions de rendu :** quand plusieurs particules arrivent sur le même pixel, elles mélangent leurs teintes et composent leur opacité, plutôt que d'écraser la dernière valeur. L'œil blanc possède un poids supérieur pour rester lisible. Une collision reste un seul pixel affiché, ce qui constitue une limite du Canvas de résolution fixe.
- **Tests reproductibles :** `new ParticleWorld(map, { seed: 2026 })` fixe la source de hasard ; l'injection de `random()` reste possible pour les tests unitaires. Le navigateur conserve son comportement aléatoire par défaut.
- **Simulation fiabilisée :** pas de temps invalides rejetés ; pas de rattrapage après une pause ou un onglet masqué ; transitions `explode` / `reveal` / retour à `idle` couvertes par des tests.
- **Profilage :** le panneau affiche FPS, temps CPU moyen par frame de la simulation, temps moyen du rendu et nombre de collisions au dernier rendu. Les chiffres sont indicatifs et dépendent de la machine et du navigateur.

Validation : `node --test tests/*.test.cjs`, puis `node --check src/app.js` et `node --check src/engine/particle-world.js`. La vérification visuelle peut être effectuée en ouvrant la page et en déclenchant `Explosion`, `Révéler`, `Pause` et un clic sur le personnage en mouvement.

### Limites conservées

Ce lot ne crée **ni cohésion locale**, ni états `listening` / `thinking` / `speaking` ; ils sont réservés aux prochains lots. La restitution de la silhouette reste pixellisée et le mélange des couleurs lors de collisions est une approximation perceptuelle.

## V2.1 — Physique organique

Les 15 886 points restent indépendants, mais chaque point peut maintenant suivre les
**déplacements de ses voisins directs**. Le moteur ne charge toujours ni GIF ni spritesheet.

### Algorithme

- `cohesion-field.js` construit **une seule fois** un graphe de voisinage à quatre directions
  (gauche, droite, haut, bas), à partir des positions d'origine. Deux pixels ne sont liés
  que s'ils se touchent et appartiennent à la même catégorie œil / corps. Les bords et
  particules isolées restent libres.
- À chaque pas, une force pousse la **différence de déplacement par rapport à l'origine**
  de chaque particule vers la moyenne de ses voisins. L'algorithme ne téléporte aucun pixel,
  ne crée aucun objet par frame et reste linéaire par rapport au nombre de points et de liens.
- `ParticleWorld` conserve le ressort individuel et l'amortissement du lot 0. Il applique
  ensuite un champ d'ondulation lent et une respiration radiale commune à toute la silhouette.
- Pendant `explode` et `reveal`, la cohésion est d'abord relâchée pour laisser les points
  s'écarter. Elle revient progressivement sur environ 1,5 seconde, **avant** le retour à `idle`,
  sans changement brutal de force à la transition.

Ce système est une **approximation de matière souple**, et non une simulation de fluide
ou de tissu physiquement exacte. Les zones anatomiques détaillées viendront dans le lot 2.

### Réglages

| Paramètre | Valeur initiale | Plage | Effet |
| --- | ---: | ---: | --- |
| Élasticité | 30 | 5–70 | Force de rappel de chaque particule vers sa position d'origine |
| Dispersion | 100 % | 30–200 % | Impulsion de l'explosion / distance de révélation |
| Cohésion | 55 | 0–120 | Synchronisation des déplacements des points voisins ; 0 reproduit les ressorts indépendants |
| Respiration organique | 100 % | 0–200 % | Ondulations et dilatation lente autour du centre de la silhouette |

La couleur, le clignement, la pause et le profilage du lot 0 sont conservés.

### Vérifier la V2.1

```bash
node --test tests/*.test.cjs
node --check src/engine/cohesion-field.js
node --check src/engine/particle-world.js
node --check src/app.js
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`, régler la **cohésion à 0 puis à 120** et
comparer le retour après une explosion. Les tests couvrent le graphe de voisinage,
la cohésion désactivée, l'effet du rappel collectif, les transitions, la reproduction
avec une graine, et la pause.

### Performances et limites

La grille ne change pas de taille (200 × 200 pixels au centre d'un Canvas 400 × 400).
Les liaisons sont pré-calculées ; les forces locales sont évaluées à 60 Hz.
Les mesures du panneau restent propres au navigateur et à la machine utilisés.
Lors d'une dispersion importante, le personnage garde un aspect de poussière temporaire :
le maintien permanent de masses ou de volumes nommés est volontairement réservé au lot 2.

## V2.2 — Anatomie du personnage

### Anatomie et pipeline d'assets

L'exécution conserve les **15 886 pixels** indépendants et la physique V2.1. Chaque particule reçoit un identifiant de région et un profil physique au chargement, jamais pendant le rendu. **Aucune image n'est découpée dans le navigateur.**

- `tools/export_anatomy.py` reconnaît hors navigateur les composantes déconnectées du `source.png` (gouttes et éclats), les volumes gris internes et les masques de la zone d'expression et des pattes. Les limites de zone reposent sur les mêmes coordonnées de référence que `tools/split_assets.py` ; elles sont **approximatives**, car le PNG d'origine est aplati.
- `assets/persona-anatomy.js` contient les régions sous forme de segments RLE `[y, x, longueur, zone]` sur la même grille logique **200 × 200** que `persona-map.js`.
- `anatomy.js` vérifie que chaque pixel visible appartient à **une et une seule zone** et associe un profil de mouvement, de cohésion, de rappel, de dissipation et de couleur.
- **Historique V2.2 :** `cohesion-field.js` reliait uniquement les voisins d’une même zone. Cette limitation a été supprimée dans la refonte « Rôles et matériaux » ci-dessous.
- `particle-world.js` module les forces de ressort, l'amortissement, les ondes, l'explosion, la révélation et le changement de couleur en fonction du profil, sans changer le nombre de particules.

### Zones visibles

| Zone | Nombre de points | Rôle physique |
| --- | ---: | --- |
| Corps | 5 978 | Silhouette cohérente, mouvements partagés |
| Œil clair | 375 | Clignement et cohésion renforcée, dispersion limitée |
| Expression | 1 569 | Reste solidaire de l'œil et du visage |
| Volumes haut, gauche, droite | 2 722 / 2 278 / 512 | Respirent légèrement plus que le corps |
| Gouttes gauche / droite | 612 / 544 | Flottent plus librement et réagissent davantage à l'impact |
| Pattes gauche / droite | 575 / 663 | Plus fermes, oscillations réduites |
| Éclats | 58 | Très mobiles, réaction accentuée |

Le bouton **Visualiser les zones** colore provisoirement ces régions, affiche leur effectif et permet de vérifier leur placement. Le rendu normal et les couleurs d'origine sont restaurés immédiatement lorsqu'on désactive la case. Ce mode est **uniquement visuel** : il ne modifie pas la simulation.

### Génération et tests

```bash
python tools/export_particle_map.py
python tools/export_anatomy.py
node --test tests/*.test.cjs
node --check src/engine/anatomy.js
node --check src/engine/particle-world.js
node --check src/engine/cohesion-field.js
node --check src/app.js
python -m http.server 8000
```

La génération nécessite **Pillow, NumPy et OpenCV** (uniquement dans les outils Python). Aucun package JavaScript supplémentaire n'est nécessaire pour exécuter la page HTML.

Pour changer la forme du personnage, régénérer **d'abord** `persona-map.js`, puis `persona-anatomy.js`, et vérifier le mode d'inspection : les coordonnées et les composantes déconnectées proviennent du dessin existant, donc les heuristiques d'export doivent être adaptées si l'illustration change fortement.

### Limites et suite

L'anatomie est une segmentation par zones et non un véritable squelette articulé. Les frontières entre zones dépendent du PNG aplati : certaines zones superposées ne peuvent être reconstruites exactement. La physique est approximative ; la limitation historique sur les liaisons transfrontalières a été levée dans la refonte « Rôles et matériaux » ci-dessous. Les états IA `listening`, `thinking` et `speaking` sont réservés à la V2.3.


## V2.3 — Comportements et commandes physiques

La V2.3 conserve **le même nuage de 15 886 particules et ses 11 régions anatomiques**.
Elle sépare la logique d'état de la simulation et du rendu :

- `behavior-controller.js` interprète les intentions (`idle`, `listening`, `thinking`, `speaking`), maintient les signaux d'énergie et de volume vocal et interpole leurs paramètres sur **420 ms**.
- `particle-world.js` conserve l'autorité sur les forces et les positions. Les comportements modulent l'amplitude des ondes, la respiration, les pulsations, la cohésion et la colorisation, sans ajouter de nouvelles animations pré-calculées.
- `app.js` reste un adaptateur entre l'interface HTML, les commandes du contrôleur et Canvas.
- Les réactions `hit`, `reveal` et `blink` sont **temporaires** : un impact pendant `speaking` ne change pas le comportement durable. La coloration de réaction reste prioritaire sur celle de l'état courant.

### États prédéfinis

| État | Mouvement | Palette |
| --- | --- | --- |
| `idle` | Respiration, flottement et clignement naturel | Originale |
| `listening` | Stabilité accrue, pulsations douces | Bleu |
| `thinking` | Ondulation et vibration interne plus intenses | Violet |
| `speaking` | Pulsations synchronisées avec un signal vocal normalisé | Cyan |

Les curseurs **Énergie** et **Intensité vocale** permettent de simuler des valeurs externes. Le second est activé uniquement en mode `speaking`. Aucun micro, enregistrement ou LLM n'est branché dans cette PR.

### Pilotage programmatique (préparation des futurs agents IA)

La page expose un point d'entrée **limité à des commandes déclaratives validées** :

```javascript
window.persona.dispatch({ type: 'state', value: 'thinking' });
window.persona.dispatch({ type: 'energy', value: 0.8 });
window.persona.dispatch({ type: 'state', value: 'speaking' });
window.persona.dispatch({ type: 'voice', value: 0.6 });

// Envoyer une impulsion sur les points de l'œil uniquement.
window.persona.dispatch({
  type: 'effect',
  name: 'field',
  options: { x: 200, y: 200, radius: 110, strength: 70, region: 'eye' },
});

// Rappels : strength > 0 = répulsion ; strength < 0 = attraction.
window.persona.dispatch({ type: 'effect', name: 'hit' });
window.persona.dispatch({ type: 'effect', name: 'blink' });
const snapshot = window.persona.getSnapshot();
```

La commande `field` est un **champ de force ponctuel** et non un dessin ni un déplacement absolu. Elle est bornée : position dans la scène 400×400, rayon 4–250, intensité −280 à +280, et `region` doit être le nom d'une région connue. Les valeurs non finies ou commandes non répertoriées sont rejetées avec une erreur explicite. `window.persona` ne donne pas accès aux tableaux de particules ni à l'exécution de code arbitraire.

**Vision à terme :** une IA pourrait être reliée par un adaptateur Node.js/WebSocket émettant des commandes de haut niveau ou des champs de forces ciblés. Elle pourrait combiner ces commandes de manière autonome plutôt que simplement choisir un état. Une évolution ultérieure pourra proposer des masques de zones, une modulation continue des champs et un ordonnanceur d'intentions, avec limites de fréquence, budgets d'énergie et validation des messages. **Cette V2.3 n'établit aucune connexion à une IA ni à un service externe.**

### Vérifications

```bash
node --test tests/*.test.cjs
node --check src/controller/behavior-controller.js
node --check src/engine/particle-world.js
node --check src/app.js
python -m http.server 8000
```

Les nouveaux tests couvrent les états, l'interpolation, le changement d'état en cours de transition, les signaux d'énergie et de parole, les réactions temporaires, les zones ciblées, les champs attractifs/répulsifs, les erreurs de validation, la pause, la reproductibilité et le reset.

### Limites

- Les états produisent des variations de la matière, **pas des expressions faciales dessinées à la main**.
- Le rendu est toujours effectué sur un Canvas 2D de 400×400 : les particules superposées sont mélangées au lieu d'afficher plusieurs points distincts.
- Le signal vocal est manuel dans la démo. Le brancher à une vraie sortie audio demande un adaptateur séparé et des règles de cycle de vie.


## Refonte — Rôles, matériaux et matière continue (sur la base de V2.3)

**Décision de conception :** une zone est une façon de sélectionner des pixels, pas une pièce
physique séparée. Chaque particule participe à **une seule simulation**. Son comportement
physique vient d'un matériau et ses capacités sémantiques de rôles configurables.

| Niveau | Fichier | Responsabilité |
| --- | --- | --- |
| Zone logique | `assets/persona-anatomy.js` + `anatomy.js` | Reconnaître les pixels du corps, de l'œil, des gouttes… |
| Matériau | `anatomy.js` → `MATERIAL_PRESETS` | Ressort, amortissement, cohésion, dispersion, teinte |
| Rôles | `anatomy.js` → `REGION_DEFINITIONS`, `role-registry.js` | Capacités multiples attribuées à chaque zone |
| Matière physique | `cohesion-field.js` | Relier **tous** les pixels adjacents, même de régions et matériaux différents |
| Décisions | `behavior-controller.js` | Convertir une intention validée en forces locales / changement d'état |
| Simulation | `particle-world.js` | Appliquer les forces à toutes les particules avec un seul pas de temps |

### Rôles initiaux

- **Œil** : `gaze`, `blink`, `focus` (matériau `optic`).
- **Corps** : `breathe`, `deform`, `express` (matériau `cloud`).
- **Volumes du nuage** : `breathe`, `deform`, `float` (matériau `vapor`).
- **Gouttes** : `float`, `orbit`, `express` (matériau `droplet`).
- **Pattes** : `anchor`, `deform` (matériau `limb`).
- **Éclats** : `float`, `orbit`, `sparkle` (matériau `spark`).

Les rôles représentent actuellement **des capacités de sélection**, pas dix animations
indépendantes. Le clignement utilise désormais le rôle `blink`, et les champs de force
peuvent cibler les rôles `float`, `gaze`, etc. `gaze` et `orbit` ne sont pas encore des
animations spécialisées : c'est une interface pour les développer séparément sans changer
la physique des pixels.

### Commandes déclaratives (console navigateur)

```javascript
// L'IA pourra sélectionner plusieurs zones d'un coup via leur rôle commun.
window.persona.dispatch({
  type: 'effect', name: 'field',
  options: { x: 200, y: 180, radius: 140, strength: -80, role: 'float' },
});

// Requête sémantique vers le même système de forces : strength positif,
// 'attract' oriente automatiquement cette impulsion vers le centre.
window.persona.dispatch({
  type: 'action', role: 'gaze', action: 'attract',
  options: { x: 220, y: 170, radius: 100, strength: 90 },
});

// Une zone peut cumuler plusieurs rôles et être réaffectée à chaud.
window.persona.dispatch({
  type: 'roles', region: 'eye', roles: ['gaze', 'focus', 'express'],
});

// Consultation sans accès en écriture au tableau de particules :
const assignments = window.persona.getRoleAssignments();
```

Les champs acceptent toujours `region` pour la rétrocompatibilité V2.3, et `role` pour
cibler **plusieurs zones**. Les deux peuvent être associés (intersection). Les rôles sont
limités à une liste blanche ; maximum six par zone ; forces, rayon et coordonnées restent
bornés comme en V2.3. Les commandes invalides échouent explicitement.

Le bouton **Réinitialiser** rétablit les rôles d'origine. Le nouveau sélecteur **Rôle
ciblé par les forces** sert de démonstration aux boutons Attirer / Repousser. La légende
anatomique indique les rôles de chaque région et se met à jour lors des réaffectations.

### Choix et limites

- Un pixel a **un matériau** et peut posséder **plusieurs rôles via sa zone**. Des zones
  différentes peuvent partager un matériau ou un rôle. Changer un rôle ne coupe aucune
  liaison physique ni ne change les coefficients du matériau.
- Les liens locaux entre pixels adjacents sont précompilés une fois. Les zones
  disjointes ne sont pas artificiellement raccordées : la physique reste géométrique.
- Les anciens `profile` / `ANATOMY_PROFILES` restent disponibles pour compatibilité
  pendant la migration, mais ne sont plus utilisés par le solveur physique.
- Cette PR **ne connecte aucune IA** et n'autorise aucune exécution arbitraire. Les
  sélections dynamiques de *sous-ensembles de pixels indépendants de toute zone* et
  les comportements `lookAt` / `orbit` seront des évolutions séparées.

### Vérifications

```bash
node --test tests/*.test.cjs
node --check src/engine/anatomy.js
node --check src/engine/role-registry.js
node --check src/engine/cohesion-field.js
node --check src/engine/particle-world.js
node --check src/controller/behavior-controller.js
node --check src/app.js
```

## V2.4 — Animations par frames cibles : `idle`

L'animation idle est désormais compilée depuis les **43 PNG fournis dans
`idle-frames.zip`**. **Les 43 frames sont toutes conservées dans l’ordre**, même
lorsque certaines poses se ressemblent. L’animation utilise **43 poses sur 1,72 s**
(40 ms par pose). La transition de la frame 43 à la frame 1 est interpolée sans
remplacer ni supprimer la dernière pose. Les **15 886 particules** conservent leurs identités, rôles et matériaux.
Les volumes, gouttes, pattes et teintes noir/gris/blanc suivent directement les
poses d'origine, sans seconde ondulation ou clignement procédural.

- `assets/animations/idle-frames.zip` : **source active**, 43 PNG numérotés, non altérés.
- `assets/animations/idle-reference.gif` : ancienne référence conservée pour l'historique.
- `tools/export_target_animation.py` : cadrage commun à toutes les poses pour
  préserver les gouttes supérieures et les pattes, exclusion du texte `IDLE`,
  correspondance temporelle et export GZIP (Pillow, NumPy et SciPy hors navigateur).
- `assets/animations/idle-targets.js` : poses précompilées et compressées.
- `target-animation-player.js` : décodage, horloge, interpolation, boucle, arrêt.
- `particle-world.js` : suit les positions cibles dans le solveur physique.
- `behavior-controller.js` : commandes d'animation sur liste blanche.

Pour lancer l'animation, appeler
`window.persona.dispatch({ type: 'animation', name: 'idle' })` ; pour l'arrêter,
`window.persona.dispatch({ type: 'animation', action: 'stop' })`.

**Guide détaillé, limites et procédure de régénération :**
[`docs/TARGET_ANIMATIONS_V2_4.md`](docs/TARGET_ANIMATIONS_V2_4.md).

### Vérifier les dépendances du navigateur

Le prototype charge ses modules par balises `<script>` depuis `index.html`. **Tous les fichiers référencés doivent exister dans la même arborescence** : notamment `role-registry.js`, utilisé par `particle-world.js`. Un fichier absent provoque un `404`, parfois renvoyé en `text/html` par un serveur statique, puis une erreur `LocalRoleRegistry is not a constructor`.

La commande `node --test tests/*.test.cjs` inclut un contrôle des chemins de scripts, des feuilles CSS et des importations locales afin de détecter ce type de régression avant la publication. Pour utiliser Live Server, ouvrir le dossier racine du dépôt, démarrer `index.html`, puis recharger la page après la mise à jour des fichiers.


### V2.4 — Inspecteur de frames idle

L'animation source contient 43 poses cibles sur 1,72 s (40 ms par pose).
La page permet maintenant de **figer la frame actuelle**, d'avancer ou reculer
image par image et de choisir la **dernière frame** de la boucle sans modifier
l'asset. Les numéros affichés vont de **1 à 43** ; l'API JavaScript utilise des
indices **0 à 42**. La sélection affiche la pose de référence **exacte**, sans
attendre le retour élastique des particules. La simulation est temporairement
figée pendant l'inspection mais elle reprend normalement après « Reprendre ».

Exemples depuis la console :

```js
window.persona.dispatch({ type: 'animation', action: 'seek', frame: 17 }); // affiche la frame 18/43
window.persona.dispatch({ type: 'animation', action: 'loop-end', frame: 17 }); // boucle de 18 frames / 0,72 s à vitesse 1×
window.persona.dispatch({ type: 'animation', action: 'resume' });
```

Ces réglages sont **temporaires**, enregistrés uniquement pendant la session.
Ils permettent de choisir le bon point d'arrêt avant de demander une correction.
Quand la boucle est raccourcie, son retour de la dernière frame vers la première
peut ne pas être fluide si ces silhouettes diffèrent : la version finale pourra
ré-exporter un raccord artistique adapté au numéro choisi.

### Corrections de la source idle (PNG)

Pour régénérer exactement le même asset :

```bash
python -m pip install Pillow numpy scipy
python tools/export_target_animation.py
node --test tests/*.test.cjs
```

Le crop fixe `(0, 8, 190, 225)` est appliqué à toutes les images (et non un
recentrage propre à chaque frame). Le texte sous le personnage est exclu,
mais les petites gouttes en haut sont conservées. Les points sont affectés
aux cibles de la frame suivante, en maximisant d'abord le nombre de pixels
visibles couverts : cela évite les « trous » causés par plusieurs points
convergeant inutilement vers le même pixel. La dernière pose reste distincte de la première : la boucle interpole entre
les deux sans supprimer ni réécrire de frame. La continuité visuelle
dépend néanmoins de la proximité des silhouettes source.

Les effets temporaires de type `hit` / `reveal` gardent leurs forces physiques
et prennent momentanément le dessus sur le suivi de pose. La physique et la
palette procédurales du comportement libre ne sont pas superposées au clip
idle : l'animation de référence est prioritaire.

Le ZIP ne contient pas de durée par PNG : **40 ms par image est un réglage
d'export choisi pour cette version**, et non une information extraite du ZIP.
Il peut être ajusté via `--frame-duration-ms`, sans changer les images.


### V2.4 — Vitesse, densité et stabilisation visuelle

- **43 frames conservées** (aucune déduplication). Vitesse réglable de **0,25× à 3×** ; la vitesse modifie le temps de lecture, et non le nombre de poses. Une boucle normale reste de 1,72 s à 1×.
- **Nombre de particules simulées** : 2 000, 4 000, 8 000, 12 000 ou 15 886. Le moteur réduit effectivement le tableau des particules actives, reconstruit les liaisons de cohésion et réindexe les cibles des 43 frames depuis leurs identités sources. Un changement de densité repositionne la forme sur la pose actuelle et réinitialise les impulsions physiques. Le moteur conserve la source de 15 886 points en mémoire pour revenir au niveau de qualité initial.
- **Filtre de stabilisation** : un pixel absent temporairement à cause de l'arrondi et du croisement des particules s'estompe sur environ 35 ms, au lieu de disparaître brutalement. Les couleurs des pixels présents sont légèrement stabilisées. La physique et les 43 poses originales restent inchangées. L'inspecteur de frames et le diagnostic anatomique affichent le rendu non filtré. Un interrupteur dans les réglages permet de comparer le filtre au rendu brut. À vitesse élevée, une courte traîne peut subsister.

Console :

```js
window.persona.dispatch({ type: 'animation', action: 'speed', value: 1.5 });
window.persona.dispatch({ type: 'animation', action: 'particle-count', count: 8000 });
```

- À **3×** sur un écran 60 Hz, les 43 poses demeurent dans l’asset mais certaines peuvent ne pas être affichées individuellement : le lecteur avance en temps réel et interpole entre les poses disponibles.


## V2.5 — Population dynamique par frame

Le lecteur `idle` conserve les **43 frames et leurs 40 ms par image**. Chaque pose affiche maintenant autant de particules qu'elle possède de pixels visibles : **13 623 à 16 103** sur les assets actuels. Un **pool réutilisable de 16 162 points** évite les allocations par image. Les identifiants, rôles et matériaux persistent lorsque des points disparaissent puis réapparaissent.

Le menu **« Limite de particules visibles »** offre le mode **Automatique** (fidélité aux poses d'origine) et des plafonds de qualité. Un plafond conserve les mêmes points sélectionnés pendant toute la boucle, y compris ceux de l'œil ; il ne raccourcit ni les frames ni leur durée. Le compteur indique les points effectivement visibles plutôt que la capacité du pool. L'anti-scintillement est désactivé par défaut pour ne pas réintroduire de pixels qui doivent légitimement disparaître.

Détails d'algorithme, format, validation et limites : [docs/technical-information/dynamic-particle-population.md](docs/technical-information/dynamic-particle-population.md).
