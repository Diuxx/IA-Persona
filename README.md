# IA-Persona — POC nuage de pixels vivants

Prototype expérimental remplaçant le lecteur de GIF et spritesheets : **chaque pixel visible du personnage original est un point simulé**.

## Démarrage

Ouvrir `index.html` directement ou lancer un serveur statique :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`. Aucun package npm ni service n'est nécessaire.

## Architecture

- `source.png` : dessin original, conservé intact.
- `tools/export_particle_map.py` : conversion *hors navigateur* en un tableau RLE de pixels colorés de taille 200×200 (Pillow nécessaire pour régénérer).
- `assets/persona-map.js` : carte statique des pixels visibles ; **aucune lecture `getImageData`** ni problème CORS côté navigateur.
- `particle-world.js` : simulation pure des forces, animations et couleurs, sans DOM.
- `app.js` : Canvas 2D, boutons, contrôles et rafraîchissement en pas fixe 60 Hz.
- `tests/particle-world.test.cjs` : tests de la simulation.

La carte est classée en quatre types de pixels : transparent, nuage noir, masses grises et œil clair. Les pixels sont animés individuellement mais partagent un champ de mouvement cohérent. La résolution de la **forme source est 200×200**, au centre d'un Canvas de **400×400** pour laisser de la place à l'explosion.

## Interactions

- **Révéler** : les points colorés apparaissent dispersés, puis retrouvent leur forme et leurs couleurs d'origine.
- **Explosion** : une impulsion radiale disperse les points, qui reviennent sous l'effet d'un ressort amorti.
- **Clic sur la créature / Entrée / Espace** : même explosion que le bouton.
- **Idle** : lévitation et déformations douces, œil unique qui cligne à intervalles variables.
- **Couleur** : teinte appliquée pendant les transitions, puis interpolée vers la palette originale.
- **Élasticité, dispersion, pause, reset** : réglages du moteur en direct.

Les particules ne sont jamais recréées à chaque frame : seuls leurs états et le tampon d'affichage RGBA sont mis à jour. Pour une très grosse quantité de pixels ou des appareils peu puissants, une solution WebGL pourra être évaluée ultérieurement.

## Tests

```bash
node --test tests/*.test.cjs
node --check app.js
node --check particle-world.js
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

Validation : `node --test tests/*.test.cjs`, puis `node --check app.js` et `node --check particle-world.js`. La vérification visuelle peut être effectuée en ouvrant la page et en déclenchant `Explosion`, `Révéler`, `Pause` et un clic sur le personnage en mouvement.

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
node --check cohesion-field.js
node --check particle-world.js
node --check app.js
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
- `cohesion-field.js` ne relie que les voisins de la **même zone anatomique**. Les zones restent déformables ; le rappel vers la position d'origine évite de rompre les raccords du nuage.
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
node --check anatomy.js
node --check particle-world.js
node --check cohesion-field.js
node --check app.js
python -m http.server 8000
```

La génération nécessite **Pillow, NumPy et OpenCV** (uniquement dans les outils Python). Aucun package JavaScript supplémentaire n'est nécessaire pour exécuter la page HTML.

Pour changer la forme du personnage, régénérer **d'abord** `persona-map.js`, puis `persona-anatomy.js`, et vérifier le mode d'inspection : les coordonnées et les composantes déconnectées proviennent du dessin existant, donc les heuristiques d'export doivent être adaptées si l'illustration change fortement.

### Limites et suite

L'anatomie est une segmentation par zones et non un véritable squelette articulé. Les frontières entre zones dépendent du PNG aplati : certaines zones superposées ne peuvent être reconstruites exactement. La cohésion V2.1 reste réutilisée, mais les liaisons transfrontalières sont volontairement absentes ; la physique reste approximative. Les états IA `listening`, `thinking` et `speaking` sont réservés à la V2.3.


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
node --check behavior-controller.js
node --check particle-world.js
node --check app.js
python -m http.server 8000
```

Les nouveaux tests couvrent les états, l'interpolation, le changement d'état en cours de transition, les signaux d'énergie et de parole, les réactions temporaires, les zones ciblées, les champs attractifs/répulsifs, les erreurs de validation, la pause, la reproductibilité et le reset.

### Limites

- Les états produisent des variations de la matière, **pas des expressions faciales dessinées à la main**.
- Le rendu est toujours effectué sur un Canvas 2D de 400×400 : les particules superposées sont mélangées au lieu d'afficher plusieurs points distincts.
- Le signal vocal est manuel dans la démo. Le brancher à une vraie sortie audio demande un adaptateur séparé et des règles de cycle de vie.
