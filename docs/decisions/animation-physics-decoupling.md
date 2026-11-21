# Expérience : découplage animation et physique

La reconstruction scientifique affiche directement des rasters, tandis que
la simulation historique poursuit des cibles mouvantes par ressorts. Ce
retard peut dégrader la silhouette. Cette expérience n'importe aucune pose
reconstruite et ne modifie ni les sources ni le lecteur.

## Comportement

Dans Animations, choisir « Suivi des particules » :
- Physique historique : comportement par défaut conservé.
- Animation + physique découplées : la cible interpolée devient une ancre
  mobile par identité ; le ressort et l'amortissement agissent uniquement
  sur l'écart à l'ancre. Une particule sans écart ni impulsion suit directement
  la cible, sous réserve de la limite de vitesse.

La position affichée = ancre + écart. Les vitesses sont alors relatives à
l'ancre. Les points visibles restent limités à 690 px/s (11,5 px par pas
à 60 Hz en lecture normale). Un écart causé par le bridage est récupéré
progressivement, pas effacé par téléportation. Les effets reveal/hit
conservent la possibilité de disperser les points ; les champs utilisent
les positions réelles et ajoutent une impulsion. Comme auparavant, les
effets explicites et l'inspection exacte ne sont pas limités par le cap
de lecture normale. La transition de mode conserve positions et vitesses,
les ancres sont recalées sur la cible actuelle pour préserver les écarts. Les points invisibles
n'imposent pas d'identité visible continue ; une apparition peut être
initialisée à la cible. Stop/reset libèrent les ancres.
Le réglage reste valable pendant la session, y compris après reset.

Commande API : `window.persona.dispatch({ type: 'animation', action: 'tracking', value: 'decoupled' })`
(ou 'legacy'). Aucun changement du nombre de frames, du pool, du temps de
lecture, des contrôles de densité, de l'inspecteur et de la palette cible.

## Comparaison

Réglages : écart moyen/max en px par rapport à la cible interpolée,
points bridés au dernier pas, collisions, FPS et temps CPU. Les mesures
sont échantillonnées environ une fois par seconde ; FPS/temps sont des
moyennes de la fenêtre, les autres valeurs sont instantanées. Comparer
à vitesse 1x, densité automatique, filtre anti-scintillement désactivé
et sans effets, puis tester une explosion et le retour à idle.

`node tools/compare_animation_tracking.cjs` compare les deux modes sur
idle, gauche et droite depuis une phase initiale identique. La référence
directe est le raster des cibles interpolées (pas le PNG source ni le
résultat du laboratoire). IoU mesure l'occupation, y compris les pixels
partiellement visibles, pas la fidélité des couleurs. La simulation et
l'écriture RGBA sont chronométrées hors calcul des diagnostics ; ce ne
sont pas des FPS navigateur. Le max est un maximum sur tous les pas,
les autres valeurs sont moyennées. Le retour automatique à idle est
vérifié séparément par les tests. Aucun objectif d'amélioration chiffré
n'est fixé avant mesure.

Limites : les mauvaises correspondances, l'arrondi, la visibilité et les
collisions lors de l'interpolation restent possibles même sans retard
physique. Ce mode ne doit pas être adopté par défaut sans observation
visuelle. Il ne modifie pas PROJECT.md ni les autres documents immuables.
