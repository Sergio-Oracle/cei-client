#!/bin/bash
# Construit CEI Examen pour macOS (.dmg + .zip) SUR UN MAC, d'une seule commande :
#     bash scripts/build-mac.sh            (depuis le dossier du client)
#     bash scripts/build-mac.sh --check    (vérifie seulement les prérequis, ne construit rien)
#
# - installe Node.js tout seul (dans ~/cei-build-tools, sans droits administrateur) s'il manque ou s'il est trop ancien ;
# - refuse de construire sans src/secret.json (sinon un NOUVEAU secret serait créé et toutes les applications déjà installées deviendraient invalides) ;
# - produit dist/CEI Examen-<version>-universal.dmg et .zip (Mac Intel ET Apple Silicon).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != "Darwin" ]; then echo "✘ Ce script se lance sur un Mac (ici : $(uname -s))."; exit 1; fi
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1

echo "== Prérequis =="
MACOS="$(sw_vers -productVersion)"; MAJOR="${MACOS%%.*}"; ARCH="$(uname -m)"
echo "macOS $MACOS ($ARCH), dossier : $PWD"

if [ ! -s src/secret.json ]; then
  echo "✘ src/secret.json est absent : il vient avec le paquet reçu (ne le régénérez pas : toutes les applications installées seraient invalidées)."; exit 1
fi
echo "secret embarqué : présent"

# Les outils de construction (electron-builder 26) demandent Node 18, qui ne tourne que sur macOS 10.15 ou plus
MINOR="$(echo "$MACOS" | cut -d. -f2)"
if [ "$MAJOR" -eq 10 ] && [ "${MINOR:-0}" -lt 15 ]; then
  echo "✘ macOS $MACOS est trop ancien : il faut macOS 10.15 (Catalina) ou plus récent pour construire."
  echo "  Alternative sans Mac récent : GitHub Actions (voir README, « Sans Mac »)."
  exit 1
fi

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then
  # Node 20 demande macOS 11 ou plus ; Node 18 fonctionne dès macOS 10.15
  if [ "$MAJOR" -ge 11 ]; then NODE_V="20.20.0"; else NODE_V="18.20.8"; fi
  case "$ARCH" in arm64) NA="arm64" ;; *) NA="x64" ;; esac
  DEST="$HOME/cei-build-tools/node-v$NODE_V-darwin-$NA"
  if [ ! -x "$DEST/bin/node" ]; then
    echo "Node.js absent ou trop ancien : téléchargement de la version $NODE_V…"
    mkdir -p "$HOME/cei-build-tools"
    curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_V/node-v$NODE_V-darwin-$NA.tar.gz" | tar -xz -C "$HOME/cei-build-tools"
  fi
  export PATH="$DEST/bin:$PATH"
fi
node_ok || { echo "✘ Node.js 18 ou plus est introuvable."; exit 1; }
echo "node $(node -v), npm $(npm -v)"
command -v hdiutil >/dev/null || { echo "✘ hdiutil introuvable (nécessaire pour fabriquer le .dmg)."; exit 1; }
FREE_GB="$(df -g . | awk 'NR==2{print $4}')"
echo "espace libre : ${FREE_GB} Go (il en faut environ 3)"
[ "${FREE_GB:-0}" -ge 3 ] || { echo "✘ Espace disque insuffisant."; exit 1; }
if [ "$CHECK" = 1 ]; then echo "✔ Prérequis OK — rien n'a été construit (--check)."; exit 0; fi

echo; echo "== Installation des dépendances (1 à 3 minutes, Internet requis) =="
npm ci --no-audit --no-fund

echo; echo "== Construction macOS (universel : Intel + Apple Silicon) =="
npm run build:mac

echo; echo "== Résultat =="
ls -lh dist/*.dmg dist/*.zip 2>/dev/null || { echo "✘ Aucun fichier produit dans dist/."; exit 1; }
echo
echo "✔ Terminé. Pour les récupérer depuis votre PC Windows (PowerShell) :"
echo "   scp \"$(id -un)@<adresse-du-mac>:$PWD/dist/*.dmg\" ."
echo "Premier lancement sur un Mac : clic droit sur l'application → Ouvrir (application non signée),"
echo "ou dans le Terminal : xattr -cr \"/Applications/CEI Examen.app\""
