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
  // Seuls ces hôtes (et leurs sous-domaines directs) peuvent être ouverts dans la fenêtre d'examen.
  allowedHosts: [host, ...extra],
  // Secret partagé avec le serveur (variable CEI_CLIENT_SECRET) : signe la poignée de main « je suis bien le client officiel ».
  clientSecret: secret.clientSecret || process.env.CEI_CLIENT_SECRET || 'dev-secret-non-securise',
  // Empreinte SHA-256 du code de sortie d'urgence (donné par le surveillant). Vide = sortie d'urgence désactivée.
  quitHash: secret.quitHash || process.env.CEI_QUIT_HASH || '',
  devtools: process.env.CEI_DEVTOOLS === '1',
  test: process.env.CEI_TEST === '1',
  scanMs: parseInt(process.env.CEI_SCAN_MS || '20000', 10),
}
