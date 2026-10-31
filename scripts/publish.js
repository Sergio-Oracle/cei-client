'use strict'
// Prépare le dossier de distribution (CLIENT_DIST_DIR du serveur) : copie les installateurs de dist/ et écrit latest.json (version, taille, SHA-256).
//   node scripts/publish.js <dossier_de_sortie>
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const out = process.argv[2]
if (!out) { console.error('Usage : node scripts/publish.js <dossier_de_sortie>'); process.exit(1) }
const pkg = require('../package.json')
const dist = path.join(__dirname, '..', 'dist')
const KINDS = [
  [/\.AppImage$/, 'linux', 'Linux 64 bits (AppImage — aucun droit administrateur requis)', 'x64', 'portable'],
  [/\.deb$/, 'linux', 'Linux 64 bits (paquet .deb : Ubuntu, Debian, Mint)', 'x64', 'installer'],
  [/-win.*\.exe$/i, 'win32', 'Windows 10 / 11 (installateur avec raccourcis)', 'x64', 'installer'],
  [/-win.*\.zip$/i, 'win32', 'Windows 10 / 11 (archive ZIP, sans installation)', 'x64', 'archive'],
  [/\.dmg$/, 'darwin', 'macOS (Intel et Apple Silicon)', 'universal', 'installer'],
]
fs.mkdirSync(out, { recursive: true })
const files = []
for (const f of fs.readdirSync(dist)) {
  const k = KINDS.find(([re]) => re.test(f))
  if (!k) continue
  const safe = f.replace(/\s+/g, '-')                          // pas d'espaces dans les adresses de téléchargement
  const src = path.join(dist, f), dst = path.join(out, safe)
  fs.copyFileSync(src, dst)
  files.push({ name: safe, platform: k[1], arch: k[3] || '', kind: k[4] || '', label: k[2], sha256: crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex') })
}
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({ version: pkg.version, files, notes: '' }, null, 2))
console.log(`${files.length} fichier(s) publiés dans ${out} (version ${pkg.version}).`)
