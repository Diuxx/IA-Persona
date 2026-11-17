# IA-Persona — animations 2D en spritesheets

Un compagnon nuage noir à **œil unique**, animé exclusivement image par image sur Canvas 2D.
Aucun framework ni étape de build JavaScript n'est nécessaire. Les spritesheets idle et blink sont générées **une seule fois au chargement** depuis la référence Hit, puis mises en cache en mémoire.

## Démarrer

Ouvrir `index.html` dans un navigateur ou lancer un serveur statique :

```bash
python -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Architecture

| Fichier | Rôle |
|---|---|
| `animation-player.js` | Machine à états, vitesse, clignements et transitions. Ne manipule aucun pixel. |
| `app.js` | Chargement, rendu de frames complètes et événements UI. |
| `sprite-atlas.js` | Prépare au démarrage les frames idle/blink depuis la pose de référence, puis les met en cache. |
| Atlas `idle` en mémoire | 24 frames complètes, 12 FPS, boucle de 2 s. |
| Atlas `blink` en mémoire | 8 frames, 30 FPS, clignement naturel et doubles clignements occasionnels. |
| `assets/hit-explosion-sprite.png` | 8 frames de l'explosion approuvée, 120 ms chacune. |

Chaque frame mesure **250 × 251 pixels**. Les spritesheets ont un fond transparent. Les atlases idle/blink sont préparés **une seule fois**, et le moteur ne les recalcule jamais ensuite. L'application lit la frame complète via `drawImage` ; **aucune reconstruction des calques, déformation ni dessin du visage pendant le `requestAnimationFrame`**.

Les anciens `assets/body.png`, `assets/mouth.png`, etc. restent conservés comme **sources historiques** mais ne sont plus utilisés pour le rendu.

## Fonctionnement

- `idle` : lévitation/respiration en boucle ; `blink` automatique après un intervalle variable de 3,8 à 7,5 s.
- `blink` : 8 frames, avec parfois un deuxième clignement.
- `hit` : clic sur la créature, bouton « Déclencher l'explosion », ou Entrée/Espace sur le Canvas ; retourne à `idle` après 0,96 s.
- Transitions : fondu court entre deux **frames complètes** quand l'état change.
- Pause : l'horloge s'arrête ; les événements Hit/Blink sont bloqués.
- Préférence système « réduire les animations » : affiche une pose idle fixe et bloque les réactions animées.
- Réglage de vitesse : 50 à 150 %, partagé par toutes les animations.

## Ajouter de nouvelles séquences

Une nouvelle animation peut être chargée directement comme spritesheet complète via une entrée dans `ANIMATION_CLIPS`. Les états déjà présents sont construits à partir du même dessin pour rester cohérents.

## Tests

```bash
node --test tests/*.test.cjs
node --check app.js
node --check animation-player.js
```

## Limites

- Les idle/blink sont des frames dérivées de la pose finale de l'animation Hit. Pour une animation traditionnelle encore plus riche, on peut ultérieurement les remplacer par une séquence dessinée à la main.
- Les sources historiques demeurent présentes pour ne pas perdre les éléments d'origine. Elles ne participent pas au moteur de rendu.
- Aucun état `listening`, `thinking` ou `speaking`, ni connexion à Ollama pour le moment.

## Compatibilité Canvas et origine des fichiers

Le générateur de spritesheets ne lit plus les pixels des images chargées : il utilise uniquement `drawImage` et `globalCompositeOperation`. La zone de clic sur le nuage est estimée géométriquement, sans `getImageData`. Ainsi, l’application ne dépend plus de la lecture d’un Canvas potentiellement *tainted*.

Pour éviter les restrictions propres à `file://`, utiliser de préférence un serveur statique : `python -m http.server 8000`.
