# Note d'évolution — retrait des états manuels de l'interface

Date : 19 novembre 2026

## Décision d'interface

La démo IA-Persona ne présente plus le sélecteur « État du personnage » ni les curseurs d'énergie et d'intensité vocale. Ces contrôles ne pilotent pas de clips d'animation par frames équivalents à l'idle et rendent le panneau moins lisible.

Seul le DOM de la démo et son adaptateur `src/app.js` sont concernés. `src/controller/behavior-controller.js` conserve les intentions et leurs commandes `state`, `energy` et `voice`, utilisables par `window.persona.dispatch()`. Le lecteur idle et les assets restent inchangés.

## Écart documentaire volontaire

La section « Interface de référence » de `docs/PROJECT.md` énumère les états et signaux dans le panneau Animations. **Ce document est immuable conformément à `AGENTS.md`** : il n'a pas été modifié pour refléter cette évolution postérieure. Toute synchronisation de cette section nécessite une demande explicite distincte du propriétaire mentionnant `docs/PROJECT.md`.

## Option d'export des animations (à étudier)

Les 43 poses sont déjà pré-calculées dans `assets/animations/idle-targets.js`. Il serait possible d'introduire un `idle.json` contenant les métadonnées (version, dimensions, cadence, capacités, frameActiveCounts) et de placer le tableau dense (x, y, shade) dans un fichier binaire gzip. Le lecteur décoderait les mêmes données, sans recalculer les correspondances de particules dans le navigateur. Cette migration de format **n'est pas implémentée** : elle nécessitera la mise à jour de l'exporteur, du chargement et des tests.
