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
| Touches | Échap, toutes les touches de fonction (F1–F24) et Alt+Espace n'atteignent jamais la page : plus de « Revenir à l'examen » provoqué par une touche |
| Bureau / contrôle à distance | TeamViewer, AnyDesk, RustDesk, VNC, Bureau à distance Windows (mstsc, rdpclip), Assistance rapide, partage d'écran macOS… **arrêtés dès leur détection** ; session à distance (RDP, xrdp, partage d'écran) **refusée à l'entrée** de l'examen |
| Assistance technique | sites choisis par l'enseignant pour CET examen (ex. Teranga Meet, Jokko Meet), ouverts dans une fenêtre de l'application qui ne peut pas aller ailleurs ; chaque ouverture est signalée |
| Sortie d'urgence | uniquement par un code **aléatoire, à usage unique**, généré pour CET étudiant par le surveillant (bouton clé de l'écran de surveillance), **vérifié par le serveur** (Ctrl+Maj+Alt+Q) |
| Poignée de main | signature HMAC avec un secret embarqué ; le serveur refuse le démarrage sans elle (`require_client`) |

**Limites assumées** : aucune application ne peut intercepter Ctrl+Alt+Suppr ni la coupure de courant ; l'extraction du secret embarqué par un
étudiant très déterminé reste possible (comme pour SEB) ; les événements sont tracés côté serveur pour que le surveillant décide.

## Générer une version vous-même (commandes)

Prérequis une seule fois : Node.js 20+, puis `cd /root/cei-client && npm install`.

| Je veux… | Commande |
|---|---|
| Construire pour Linux | `npm run build:linux` |
| Construire pour Windows (installateur .exe + ZIP, depuis Linux ou Windows) | `npm run build:win` |
| Construire pour macOS (**sur un Mac uniquement**) | `npm run build:mac` |
| Tout ce que cette machine sait construire | `npm run build:all` |
| Nouvelle version corrective (1.0.0 → 1.0.1) puis construire | `npm run release:patch` |
| Nouvelle version avec nouveautés (1.0.1 → 1.1.0) | `npm run release:minor` |
| Version majeure (1.1.0 → 2.0.0) | `npm run release:major` |
| Construire ET mettre à disposition des étudiants | `node scripts/build.js all --bump patch --publish /home/serge/cei-client-dist` |
| Seulement mettre à disposition ce qui est déjà construit | `node scripts/publish.js /home/serge/cei-client-dist` |
| Lancer les essais automatiques | `npm test` (écran virtuel Xvfb requis pour la 2e partie) |
| Essayer l'application sans l'installer | `CEI_URL=https://preprod-cei.unchk.sn npm start` |

Les fichiers construits sont dans `dist/`. `node scripts/build.js --help` rappelle toutes les options.

**Code de sortie d'urgence (depuis 1.2.0).** Il n'y a plus de code unique embarqué dans l'application : un surveillant (affecté à l'étudiant), l'enseignant ou un administrateur
génère un code de 8 chiffres pour un étudiant précis (`POST /api/exam_attempts/<id>/client_exit_code`) ; l'application l'envoie au serveur (`POST /api/exam-client/exit`, signé du secret et horodaté)
qui compare une empreinte, détruit le code à la première réussite (usage unique), le détruit aussi après 5 essais ratés ou 15 minutes, et journalise tout (`client_exit_code_issued`,
`client_quit_code_used`, `client_quit_code_failed`). Sans connexion au serveur le code ne peut pas être vérifié : le verrouillage se lève alors de lui-même à la fin de l'examen (durée + 15 min).
Pour retirer toute possibilité de sortie par l'ancien code des versions 1.1.x, montez `CEI_CLIENT_MIN_VERSION=1.2.0` dans le `.env` de l'API.

**Réglages par examen** (création de l'examen ou *Paramètres*, quand l'application est exigée) : sites d'assistance (https, 5 au plus), applications tolérées (noms de programmes ; jamais un outil de
contrôle à distance), refus des machines virtuelles. Ils sont validés par le serveur (`services/exam_settings.py`) et transmis à l'application au démarrage de l'examen.

**Le secret** (`src/secret.json`) est créé une seule fois et **conservé** : le régénérer (`node scripts/make-secret.js --force`) rend INVALIDES toutes
les applications déjà installées, qu'il faudrait réinstaller. La même valeur doit être sur le serveur (`CEI_CLIENT_SECRET`, voir `build/server.env`).

**Version minimale** : en montant `CEI_CLIENT_MIN_VERSION` dans le `.env` de l'API, les anciennes versions sont refusées et l'étudiant est invité à télécharger la nouvelle.

## Sans Mac : obtenir le paquet macOS

Un paquet macOS ne peut être produit que par un Mac. Trois façons de l'obtenir sans en posséder un :

1. **GitHub Actions (recommandé, gratuit ou presque)** : GitHub prête une machine macOS le temps de la construction.
   Le fichier `.github/workflows/build.yml` construit Windows, macOS et Linux d'un coup.
   Une fois : poussez ce dossier sur un dépôt GitHub, ajoutez les deux secrets `CEI_CLIENT_SECRET` et `CEI_QUIT_HASH` (conservé pour la compatibilité du fichier, plus utilisé par l'application depuis 1.2.0) (explications en tête du fichier).
   À chaque version : onglet *Actions* → *Construire CEI Examen* → *Run workflow*, puis téléchargez les fichiers dans *Artifacts*.
   Les dépôts publics sont gratuits ; les dépôts privés consomment le quota mensuel (une construction macOS compte environ 10 fois sa durée).
2. **Mac loué à l'heure** (MacStadium, AWS EC2 Mac, MacinCloud) : vous vous connectez, lancez `npm run build:mac`, récupérez le `.dmg`.
3. **Le Mac d'un collègue ou d'un étudiant** : `git clone`, `npm install`, `npm run build:mac` (5 minutes).

**Signature (important pour macOS et Windows)** : sans certificat, macOS affiche « développeur non identifié » (clic droit → *Ouvrir*, ou
`xattr -cr "/Applications/CEI Examen.app"` dans le Terminal) et Windows affiche l'écran SmartScreen (*Informations complémentaires* → *Exécuter quand même*).
Pour les supprimer : compte Apple Developer (99 USD/an, signature + notarisation) et certificat de signature de code Windows (environ 100 à 400 USD/an).
Ni l'un ni l'autre n'est nécessaire pour que l'application fonctionne.

## Installateur Windows

`npm run build:win` produit **deux fichiers** : l'archive ZIP et un **installateur** `CEI-Examen-<version>-win-setup.exe` (installation sans droits administrateur,
raccourcis Bureau et menu Démarrer, désinstallation dans « Applications installées », lien `ceiexamen://`, assistant en français).
L'installateur est fabriqué par `scripts/make-installer.js` avec **NSIS** (`apt install nsis` sous Linux, `brew install nsis` sous macOS) : l'outil
habituel d'electron-builder exigerait Wine, inutile ici. Sans `makensis`, seule l'archive ZIP est produite (avec un message).
Il est vérifié à la construction (contenu, fichiers) mais n'a pas encore été exécuté sur un vrai Windows : l'essayer avant de le diffuser.
