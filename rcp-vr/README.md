# RCP en VR — Arrêt cardiaque sur un terrain de sport (Meta Quest 2)

Application WebXR (three.js) qui simule un arrêt cardiaque en plein match, dans l'esprit du cas
survenu lors de l'Euro 2020 (juin 2021). Elle s'exécute **directement dans le navigateur du Quest 2**,
sans installation d'APK.

## Scénario et gestes évalués (recommandations ERC 2021, adulte)

1. Le joueur s'effondre → **vérifier la conscience** (secouer les épaules, parler fort)
2. **Appeler à l'aide**, libérer les voies aériennes (bascule de la tête), **respiration** ≤ 10 s
   (des gasps ne sont pas une respiration normale)
3. **Alerter les secours + demander un DAE**
4. **Compressions** : centre de la poitrine, 5–6 cm, 100–120/min, relâchement complet, métronome 110/min
5. **2 insufflations** (maintien ~1 s sur la bouche, < 10 s) toutes les 30 compressions
6. Arrivée du **DAE** : un coéquipier prend le relais → dénuder le thorax → allumer → 2 électrodes →
   analyse (ne pas toucher) → « Écartez-vous ! » → **choc** → reprise immédiate de la RCP
7. **Débriefing noté /100** (chaîne de survie, délai, fréquence, profondeur, relâchement, interruptions,
   ventilations, DAE) avec conseils personnalisés. Meilleur score mémorisé sur l'appareil.

Deux modes : **Entraînement guidé** (étapes, cadran de fréquence, jauge de profondeur, métronome) et
**Évaluation** (aucune aide, indices à −3 points).

## Lancer sur le Quest 2

WebXR exige **HTTPS ou localhost**. Deux solutions :

**A. Hébergement gratuit (le plus simple)** — déposez le dossier sur GitHub Pages, Netlify Drop
(app.netlify.com/drop) ou Cloudflare Pages. Ouvrez l'URL dans le **navigateur Meta** du casque,
puis « 🥽 Entrer en VR ». (Le casque doit avoir accès à Internet : three.js est chargé depuis jsDelivr.)

**B. Réseau local avec câble USB (développeur)** :
```bash
cd rcp-vr
python3 -m http.server 8000
adb reverse tcp:8000 tcp:8000       # Quest en mode développeur, branché en USB
# Dans le navigateur du Quest : http://localhost:8000
```
Pour fonctionner hors-ligne, téléchargez `three.module.js` (v0.160.0) dans `vendor/` et changez l'URL
de l'`importmap` de `index.html` en `./vendor/three.module.js`.

## Utilisation en VR

- **Calibrage** : à genoux (ou debout/assis), posez vos deux manettes l'une sur l'autre à l'endroit où la
  poitrine du joueur doit apparaître, puis gâchette. Le terrain se recale sur vos mains (vous pouvez
  rester debout : le monde s'abaisse).
- **Rayon bleu** + **gâchette** pour cliquer (sphères colorées, boutons du panneau, DAE, électrodes).
- **Compressions** : mains/manettes empilées au-dessus de la poitrine, poussez vers le bas de 5–6 cm.
  Mode « Gâchette » disponible pour jouer assis. Retour haptique à chaque compression.
- **B / Y** : recentrer le panneau d'information devant vous.

## Aperçu sur ordinateur (sans casque)

Bouton « Aperçu sur écran » : clic = gâchette, **Espace** = compression, clic maintenu sur la bouche = insufflation.

## Fichiers

```
index.html        menu (français) + importmap three.js
js/app.js         scène, interactions, HUD, audio, déroulé de l'exercice
js/logic.js       détecteur de compressions, fréquence, calcul du score (testable)
tests/logic.test.mjs   node tests/logic.test.mjs
```

## Limites connues (à lire)

- La profondeur est mesurée par le **déplacement des manettes** : c'est une approximation, sans résistance
  physique du thorax. Les seuils sont tolérants (4,5–6,8 cm).
- Sur le Quest, la synthèse vocale du navigateur peut être indisponible : tous les messages restent affichés.
- Les contrôleurs sont recommandés ; le suivi des mains n'est pas supporté pour les compressions.
- Application testée en logique (Node) et en exécution complète du scénario sur navigateur de bureau ;
  **le rendu 3D réel sur Quest 2 n'a pas pu être testé ici** : prévoyez un premier essai de réglage
  (position du panneau, performances).
- **Outil pédagogique** : il ne remplace pas une formation certifiée aux premiers secours.
  En situation réelle : 112 (ou numéro d'urgence local), compressions immédiates, DAE.
