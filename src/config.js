'use strict'
// Réglages du client. Valeurs de production par défaut ; l'environnement ne sert qu'aux essais (préproduction, tests).
const fs = require('fs')
const path = require('path')
const pkg = require('../package.json')

let secret = {}
try { secret = JSON.parse(fs.readFileSync(path.join(__dirname, 'secret.json'), 'utf8')) } catch { /* dev : pas de secret généré */ }

const url = process.env.CEI_URL || 'https://cei.unchk.sn'
const host = new URL(url).hostname
const extra = (process.env.CEI_ALLOWED_HOSTS || 'sfu-cei.unchk.sn').split(',').map(s => s.trim()).filter(Boolean)

module.exports = {
  version: pkg.version,
  url,
  // Page d'ouverture de l'application installée : la connexion (comme la version web installable), pas la vitrine publique.
  startUrl: new URL(process.env.CEI_START || '/login', url).toString(),
  // Seuls ces hôtes (et leurs sous-domaines directs) peuvent être ouverts dans la fenêtre d'examen.
  allowedHosts: [host, ...extra],
  // Secret partagé avec le serveur (variable CEI_CLIENT_SECRET) : signe la poignée de main « je suis bien le client officiel ».
  clientSecret: secret.clientSecret || process.env.CEI_CLIENT_SECRET || 'dev-secret-non-securise',
  // Plus de code de sortie embarqué (depuis 1.2.0) : le code est généré par le serveur pour un étudiant et un examen, à usage unique, vérifié en ligne.
  // Applications autorisées à rester ouvertes pendant l'examen (en plus du bureau du système) : accessibilité, besoins particuliers…
  allowApps: (process.env.CEI_ALLOW_APPS || '').split(',').map(s => s.trim()).filter(Boolean),
  appsMs: parseInt(process.env.CEI_APPS_MS || '4000', 10),
  devtools: process.env.CEI_DEVTOOLS === '1',
  test: process.env.CEI_TEST === '1',
  scanMs: parseInt(process.env.CEI_SCAN_MS || '20000', 10),
  // Mise à jour automatique (jamais pendant un examen) : liste des versions publiée par le serveur, vérifiée au démarrage puis toutes les 30 min
  releasesUrl: new URL('/api/exam-client/releases', url).toString(),
  updateEveryMs: parseInt(process.env.CEI_UPDATE_EVERY_MS || String(30 * 60 * 1000), 10),
  updateJitterMs: parseInt(process.env.CEI_UPDATE_JITTER_MS || '15000', 10),
  portsMs: parseInt(process.env.CEI_PORTS_MS || '10000', 10),   // contrôle des ports (écrans externes, disques USB) pendant l'examen
  noPorts: process.env.CEI_NO_PORTS === '1',                      // essais / dépannage uniquement
  noUpdate: process.env.CEI_NO_UPDATE === '1',
  updateTest: process.env.CEI_UPDATE_TEST === '1',       // essais : autorise la mise à jour d'une application non empaquetée
}
