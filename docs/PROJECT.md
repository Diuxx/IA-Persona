# IA-Persona — référence de projet et architecture figée

> **Document de référence immuable — créé le 19 novembre 2026.**
> Ce fichier fixe la vision, les contraintes et l'architecture validée pour la V2.5.
> **Ne pas modifier, renommer, déplacer, supprimer, générer à nouveau ni reformater ce document lors d'une évolution courante.**
> Seule une autorisation explicite et distincte du propriétaire, mentionnant précisément `docs/PROJECT.md`, permettrait une exception. Les propositions futures doivent aller dans des notes séparées et modifiables.

## 1. Vision

IA-Persona est une matière numérique organique, expressive et fluide : un personnage constitué de milliers de particules indépendantes. La fidélité des silhouettes, la présence et la continuité des mouvements priment sur les effets décoratifs et l'accumulation de contrôles.

Les animations par poses cibles ne sont **pas** un affichage successif de sprites. Le moteur simule de véritables particules dont les objectifs proviennent d'images compilées hors navigateur.

Les états d'assistant (idle, listening, thinking, speaking) existent comme intentions. L'animation idle est pilotée par des données de frames ; les autres états disposent de réglages physiques et pourront recevoir leurs propres sources d'animation plus tard. Aucune connexion à un agent IA n'est présente dans cette référence.

## 2. Socle technique

- HTML sémantique, CSS, JavaScript natif, Canvas 2D.
- Aucune dépendance npm et aucun framework à l'exécution.
- Chargement statique à partir de `index.html`, sans build JavaScript obligatoire ; serveur HTTP local facultatif.
- Simulation physique isolée du DOM : ressorts, cohésion locale, amortissement, forces de réaction, suivi des cibles, comportements.
- Pas fixe de simulation de 1/60 seconde ; horloge de lecture cohérente avec le temps écoulé.
- Tampons et identités de particules persistants pour limiter les allocations dans la boucle.
- Entrées et commandes validées explicitement. Aucune exécution arbitraire en provenance d'un acteur externe.

## 3. Garanties de l'animation idle V2.5

- **43 frames sources conservées**, sans suppression ni déduplication.
- **40 ms par frame à 1×**, durée normale de boucle **1,72 seconde**.
- Interpolation entre poses, y compris de la 43e vers la première.
- Population visible selon les poses : **13 623 à 16 103 particules** pour les assets V2.5.
- Capacité du pool : **16 162 identifiants persistants**, actifs ou non suivant la pose.
- Les cibles, couleurs et correspondances proviennent de `assets/animations/idle-targets.js`, calculé depuis les 43 PNG de `assets/animations/idle-frames.zip`.
- Limite de qualité : automatique ou plafond manuel, en conservant les mêmes identifiants sélectionnés à travers les frames.
- L'anti-scintillement reste optionnel, désactivé par défaut ; l'inspecteur de frames doit rester fidèle à la pose de référence.
- Les diagnostics et l'optimisation ne doivent pas modifier les sources graphiques, le nombre de frames ou la continuité temporelle.

## 4. Arborescence de référence

```text
IA-Persona/
├── index.html
├── README.md
├── AGENTS.md
├── src/
│   ├── app.js
│   ├── engine/
│   │   ├── particle-world.js
│   │   ├── cohesion-field.js
│   │   ├── anatomy.js
│   │   └── role-registry.js
│   ├── animation/
│   │   ├── target-animation-player.js
│   │   └── pixel-stabilizer.js
│   ├── controller/
│   │   └── behavior-controller.js
│   ├── ui/
│   │   ├── controls.js
│   │   └── metrics.js
│   └── styles/
│       └── main.css
├── assets/
│   ├── source/source.png
│   ├── reference/example.gif
│   ├── persona-map.js
│   ├── persona-anatomy.js
│   └── animations/
│       ├── idle-frames.zip
│       ├── left-frames.zip
│       └── idle-targets.js
├── tools/
│   ├── export_particle_map.py
│   ├── export_anatomy.py
│   ├── export_target_animation.py
│   ├── split_assets.py
│   └── verify_optimizations_browser.py
├── tests/
│   └── *.test.cjs
└── docs/
    ├── PROJECT.md
    ├── TARGET_ANIMATIONS_V2_4.md
    └── technical-information/
```

`index.html` est le seul fichier de l'application à la racine. `README.md` et `AGENTS.md` demeurent à la racine en tant que fichiers de gestion du dépôt. Les ressources supplémentaires et sous-dossiers existants de `assets/`, `tests/`, `tools/` et `docs/` sont conservés selon leurs responsabilités.

**Responsabilités :** `engine/` possède les forces et l'état physique ; `animation/` pilote les poses et le lissage visuel ; `controller/` traduit les intentions validées ; `ui/` gère les interactions et mesures ; `app.js` compose ces éléments et effectue le rendu Canvas. Les outils Python préparent les données hors navigateur. Les tests restent indépendants du moteur graphique.

Les scripts chargés par `index.html` suivent l'ordre nécessaire aux dépendances globales actuelles. Aucun système de compilation ni migration vers ES Modules n'est introduit dans cette phase.

## 5. Interface de référence

Deux panneaux principaux : **Animations** et **Réglages**.

- Animations : lecture/arrêt idle, inspection de la frame, avance/recul, pause/reprise, vitesse, plafond de particules, point de bouclage, états et signaux.
- Réglages : révélation, explosion, remise à zéro, pause, anti-scintillement, élasticité, dispersion, cohésion, respiration, couleur des effets manuels, diagnostic anatomique et temps de simulation/rendu.
- En haut du Canvas : statut, **FPS** et **nombre réel de particules visibles**, ce dernier synchronisé avec l'état du lecteur.

L'onglet expérimental « Rôles / forces » et le lecteur de pulsation/ondulation/rotation de rôle ne font pas partie de cette interface. Les rôles et matériaux **internes** restent utilisés pour l'anatomie et le ciblage, sans recréer des mouvements imprécis.

## 6. API publique

`window.persona.dispatch(command)` reçoit des commandes déclaratives autorisées : états, énergie, niveau vocal, effets bornés, animation et options de lecture, rôles/affectations et actions ciblées. `getSnapshot()` et `getRoleAssignments()` exposent des lectures sans donner l'accès aux buffers bruts.

Les entrées invalides échouent explicitement. Les commandes expérimentales `role-motion` ont été retirées ; les commandes d'animation cible constituent la voie prioritaire pour obtenir des mouvements précis.

## 7. Fiabilité, performance et maintenance

- Préserver toute identité de particule et les 43 données sources.
- Éviter de créer des objets, buffers ou allocations inutiles à chaque frame.
- Mesurer FPS, temps de simulation, temps de rendu et population visible avant/après les optimisations.
- Pas de modification de mouvement sans contrôle de la forme et de la continuité visuelle.
- Test Node : `node --test tests/*.test.cjs`.
- Vérification syntaxique : `node --check` sur les scripts concernés sous `src/`.
- Vérification navigateur : `python tools/verify_optimizations_browser.py` si Chromium et Playwright sont installés.
- Conserver la compatibilité du mode lecture direct / serveur statique, sous réserve des API navigateur disponibles.
- Appliquer KISS, DRY et SOLID avec pragmatisme ; ne pas ajouter de framework, d'abstraction ou de dépendance sans nécessité mesurée.

## 8. Évolutions futures, hors du périmètre établi

Des animateurs de nouveaux états, une optimisation GPU hybride **si mesurée nécessaire**, un adaptateur d'agent IA, ou des commandes de haut niveau plus expressives peuvent être proposés séparément. Ils ne sont ni implémentés ni autorisés par défaut dans ce document.

**Gouvernance :** les évolutions et décisions postérieures doivent être consignées dans de nouveaux documents éditables. `AGENTS.md` doit conserver et appliquer la règle d'immuabilité de `docs/PROJECT.md`.
