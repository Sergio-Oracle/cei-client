'use strict'
// Prépare le dossier de distribution (CLIENT_DIST_DIR du serveur) : copie les installateurs de dist/ et écrit latest.json (version, taille, SHA-256).
//   node scripts/publish.js <dossier_de_sortie>
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const out = process.argv[2]
if (!out) { console.error('Usage : node scripts/publish.js <dossier_de_sortie>'); process.exit(1) }
const pkg = require('../package.json')
const dist = path.join(__dirname, '..', 'dist')
const KINDS = [
  [/\.AppImage$/, 'linux', 'Linux 64 bits (AppImage portable, sans installation)', 'x64', 'portable'],
  [/\.deb$/, 'linux', 'Linux 64 bits (paquet .deb : Ubuntu, Debian, Linux Mint — installation avec raccourci et menu)', 'x64', 'installer'],
  [/-win-installateur\.zip$/i, 'win32', 'Windows 10 / 11 (installateur dans une archive ZIP — recommandé avec Microsoft Edge)', 'x64', 'installer-zip'],
  [/-win.*\.exe$/i, 'win32', 'Windows 10 / 11 (installateur avec raccourcis)', 'x64', 'installer'],
  [/-win.*\.zip$/i, 'win32', 'Windows 10 / 11 (archive ZIP, sans installation)', 'x64', 'archive'],
  [/\.dmg$/, 'darwin', 'macOS (Intel et Apple Silicon)', 'universal', 'installer'],
]
fs.mkdirSync(out, { recursive: true })
// Edge retient un .exe peu connu (« n'est pas fréquemment téléchargé ») mais pas une archive : le même installateur est donc aussi livré dans un ZIP.
{
  const setup = fs.readdirSync(dist).find(f => /-win.*-setup\.exe$/i.test(f))
  if (setup) {
    const zipPath = path.join(dist, setup.replace(/-setup\.exe$/i, '-installateur.zip'))
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cei-inst-'))
    fs.copyFileSync(path.join(dist, setup), path.join(tmp, 'Installer CEI Examen.exe'))
    fs.rmSync(zipPath, { force: true })
    require('child_process').execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.write(sys.argv[2],"Installer CEI Examen.exe");z.close()', zipPath, path.join(tmp, 'Installer CEI Examen.exe')])
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
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
