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
