'use strict'
// Prépare le dossier de distribution (CLIENT_DIST_DIR du serveur) : copie les installateurs de dist/ et écrit latest.json (version, taille, SHA-256).
//   node scripts/publish.js <dossier_de_sortie>
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const out = process.argv[2]
if (!out) { console.error('Usage : node scripts/publish.js <dossier_de_sortie>'); process.exit(1) }
const pkg = require('../package.json')
const dist = path.join(__dirname, '..', 'dist')
const KINDS = [
  [/\.AppImage$/, 'linux', 'Linux (AppImage — fonctionne partout, aucun droit administrateur)'],
  [/\.deb$/, 'linux', 'Linux (paquet .deb : Ubuntu, Debian, Mint)'],
  [/-win.*\.zip$/i, 'win32', 'Windows (archive ZIP à extraire puis lancer « CEI Examen.exe »)'],
  [/\.dmg$/, 'darwin', 'macOS (image disque)'],
]
fs.mkdirSync(out, { recursive: true })
const files = []
for (const f of fs.readdirSync(dist)) {
  const k = KINDS.find(([re]) => re.test(f))
  if (!k) continue
  const src = path.join(dist, f), dst = path.join(out, f)
  fs.copyFileSync(src, dst)
  files.push({ name: f, platform: k[1], label: k[2], sha256: crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex') })
}
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({ version: pkg.version, files, notes: '' }, null, 2))
console.log(`${files.length} fichier(s) publiés dans ${out} (version ${pkg.version}).`)
