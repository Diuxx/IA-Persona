# Population dynamique des particules — idle V2.5

Cette évolution complète le lecteur de poses cibles documenté dans `docs/TARGET_ANIMATIONS_V2_4.md`. Elle répond à une limite du modèle précédent : la source de chaque frame n'a **pas** exactement 15 886 pixels visibles.

## Constats issus des 43 PNG

Avec le cadrage et la classification de `tools/export_target_animation.py`, le nombre de pixels visibles varie entre **13 623** (frame 20) et **16 103** (frame 32). L'ancien export créait 15 886 destinations à chaque pose, ce qui pouvait provoquer des superpositions forcées ou des pixels manquants.

## Format exporté

- Le générateur analyse **les 43 images sans réduction ni suppression**.
- Chaque pixel cible d'une frame est associé à **un seul identifiant** de particule.
- Un identifiant conserve sa place dans le pool et peut être **actif** (`shade` de 1 à 3) ou **inactif** (`shade = 0`).
- Le format `gzip-particle-major-rgb3-dynamic` conserve trois octets par identifiant et par frame : `(x, y, shade)`. Il demeure compact et vérifiable.
- `frameActiveCounts` est une liste de 43 populations exactes ; `extraSources` décrit uniquement les 276 identifiants supplémentaires créés au chargement à partir de particules du corps existantes.
- La taille du **pool** est de **16 162 emplacements** : 15 886 d'origine et 276 supplémentaires pour les plus fortes expansions des pixels du corps. La capacité est légèrement supérieure au maximum de 16 103 pixels visibles, car la réserve de particules de l'œil reste distincte.

## Correspondance entre poses

L'exporteur effectue un appariement spatial déterministe hors navigateur. D'une frame à la suivante, il privilégie les identifiants **encore actifs** ; si la silhouette s'agrandit, il emprunte des identifiants inactifs ; si elle se contracte, les identifiants excédentaires redeviennent inactifs. Le suivi de l'œil blanc et de la matière foncée se fait séparément.

La présence d'un point est interpolée entre les deux poses. Les points qui apparaissent démarrent près de leur première destination, pour éviter les téléportations et les grandes traînées. Les positions, couleurs, rôles et matériaux du pool persistent entre les frames. **Aucun nouvel objet particule n'est créé dans la boucle de rendu**.

## Mode auto versus limite de qualité

**Automatique** (par défaut) : la population visible suit la pose d'origine ; les 43 frames et leurs destinations restent intactes.

**Plafond manuel** (2 000, 4 000, 8 000, 12 000 ou 15 886) : les identifiants sélectionnés constituent un sous-ensemble **stable pour toute la boucle**. On privilégie les particules visibles le plus souvent et on réserve une part de la sélection aux pixels de l'œil. La qualité visuelle baisse avec un plafond inférieur, mais le nombre d'images et la durée ne changent pas.

Le plafond ne réduit pas la **capacité mémoire préallouée** ; il limite les points visibles et actifs. Les coûts de parcours du tableau complet ne deviennent pas nuls, même avec un petit plafond. Il ne faut donc pas présenter le nombre d'éléments alloués comme la population réellement animée.

## Rendu, sécurité et limites

- L'opacité permet des transitions courtes pour les apparitions/disparitions. Lorsqu'une pose est figée, les pixels sont rendus exactement à leur position cible, sans filtre anti-scintillement ajouté.
- Le filtre hérité de la V2.4 est désactivé **par défaut** : avec les populations variables, il pourrait conserver des points qui doivent réellement disparaître. Il reste activable pour comparer les rendus.
- Le décodeur valide dimensions, checksum de la carte d'origine, population par frame, appartenance des pixels à l'œil et absence de destinations dupliquées. La décompression gzip reste bornée.
- Les forces de cohésion d'origine sont conservées sur le nuage ; en animation cible, le suivi des poses est prioritaire. Les points de réserve ont un ressort individuel et leur matériau/leurs rôles sont hérités de leur source ; ils ne sont pas ajoutés au graphe de cohésion initial, pour éviter de reconstruire ce graphe 43 fois par boucle.
- La fidélité *à l'arrêt* est testée à l'échelle du pixel. À pleine vitesse, des écarts visuels peuvent encore provenir du temps de convergence physique, des fondus et du taux de rafraîchissement de l'écran.

## Commandes

```javascript
window.persona.dispatch({ type: 'animation', action: 'particle-count', count: 'auto' });
window.persona.dispatch({ type: 'animation', action: 'particle-count', count: 8000 });
window.persona.dispatch({ type: 'animation', action: 'speed', value: 1.5 });
window.persona.dispatch({ type: 'animation', action: 'seek', frame: 31 }); // frame 32
window.persona.getSnapshot().animation;
```

## Vérifications

- `node --test tests/*.test.cjs` pour la compatibilité, les 43 populations, les appariements uniques, le pool stable, les plafonds, les naissances et la pause.
- `python tools/export_target_animation.py` pour régénérer l'asset à partir des PNG.
- `python verify_optimizations_browser.py` pour tester les réglages et la frame 43 dans Chromium, avec scripts intégrés (le serveur localhost n'est pas exploité par ce test).

