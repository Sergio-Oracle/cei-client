# CEI Examen — client d'examen sécurisé (équivalent de Safe Exam Browser)

Application Electron qui ouvre la plateforme CEI et, pendant un examen, **prend le contrôle du poste** :

| Mécanisme | Effet |
|---|---|
| Mode kiosque + toujours au premier plan | plein écran, impossible à réduire, déplacer, redimensionner ou fermer |
| Perte de focus (Alt+Tab, menu Démarrer…) | la fenêtre reprend aussitôt le premier plan ; l'événement est signalé au serveur (`window_blur`) |
| Raccourcis | F5, F11, F12, Ctrl+W/R/T/N/P/S/U…, Alt+F4, Alt+Tab, Super, outils de développement : bloqués, signalés |
| Un seul site | navigation hors plateforme refusée, aucune nouvelle fenêtre |
| Écrans multiples | chaque écran supplémentaire est recouvert d'un fond noir (`client_second_display`) |
| Presse-papiers | vidé toutes les 1,5 s |
| Capture d'écran | protection du contenu activée (fenêtre noire sur les captures / enregistrements) |
| Logiciels interdits | contrôle toutes les 20 s : contrôle à distance, partage / enregistrement d'écran, messageries (`client_forbidden_app`) |
| Machine virtuelle | détectée au démarrage (`client_vm_detected`) |
| Sortie d'urgence | uniquement par un code donné par le surveillant (Ctrl+Maj+Alt+Q) |
| Poignée de main | signature HMAC avec un secret embarqué ; le serveur refuse le démarrage sans elle (`require_client`) |

**Limites assumées** : aucune application ne peut intercepter Ctrl+Alt+Suppr ni la coupure de courant ; l'extraction du secret embarqué par un
étudiant très déterminé reste possible (comme pour SEB) ; les événements sont tracés côté serveur pour que le surveillant décide.

## Construire
```
npm install
node scripts/make-secret.js          # secret.json (client) + build/server.env (serveur) + build/quit-code.txt
npx electron-builder --linux AppImage deb --win zip      # macOS : à construire sur un Mac (npm run dist:mac)
node scripts/publish.js /home/serge/cei-client-dist      # dossier lu par le serveur (CLIENT_DIST_DIR)
```
Sur le serveur : `CEI_CLIENT_SECRET=<contenu de build/server.env>` dans le `.env` de l'API, puis redémarrage.
**Le même secret doit être dans le client et sur le serveur** ; à chaque nouveau secret, republier le client.
Version minimale acceptée : `CEI_CLIENT_MIN_VERSION=1.0.0` (variable facultative du serveur).

## Essai automatique
`npm test` lance le client sous un écran virtuel (Xvfb) et vérifie kiosque, raccourcis, navigation, fermeture, logiciel interdit, focus.
