#!/usr/bin/env node
'use strict'
/**
 * Générer l'application CEI Examen.
 *
 *   node scripts/build.js <cible> [options]
 *
 *   cible          linux | win | mac | all     (all = tout ce que CETTE machine sait construire)
 *   --bump <p>     patch | minor | major | 1.2.3   monte le numéro de version avant de construire
 *   --publish <d>  copie les installateurs + latest.json dans ce dossier (celui que lit le serveur : CLIENT_DIST_DIR)
 *   --skip-tests   n'exécute pas les essais automatiques
 *   --help
 *
 * Exemples :
 *   node scripts/build.js linux                       # AppImage Linux
 *   node scripts/build.js win                         # archive ZIP Windows (construite depuis Linux ou Windows)
 *   node scripts/build.js mac                         # macOS : UNIQUEMENT sur un Mac (ou via GitHub Actions, voir README)
 *   node scripts/build.js all --bump patch --publish /home/serge/cei-client-dist
 */
const { spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const args = process.argv.slice(2)
if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(fs.readFileSync(__filename, 'utf8').split('/**')[1].split('*/')[0].replace(/^ \*\s?/gm, '')); process.exit(0) }

const target = args[0]
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const run = (cmd, a, o = {}) => { console.log(`\n$ ${cmd} ${a.join(' ')}`); const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, ...o }); if (r.status !== 0) { console.error(`\n✘ Échec : ${cmd} ${a.join(' ')}`); process.exit(r.status || 1) } }

if (!['linux', 'win', 'mac', 'all'].includes(target)) { console.error('Cible inconnue : ' + target + ' (linux | win | mac | all)'); process.exit(1) }
const here = process.platform
// Ce que cette machine sait construire (limites réelles des outils : le .app/.dmg n'existe que sous macOS)
const can = { linux: true, win: true, mac: here === 'darwin' }
const wanted = target === 'all' ? ['linux', 'win', 'mac'].filter(t => can[t]) : [target]
if (target === 'mac' && !can.mac) {
  console.error("✘ Le paquet macOS ne peut être construit que sur un Mac.\n  Sans Mac : utilisez GitHub Actions (fichier .github/workflows/build.yml, voir README « Sans Mac »).")
  process.exit(1)
}
if (target === 'all' && !can.mac) console.log('ℹ  macOS ignoré (cette machine n\'est pas un Mac) — voir README « Sans Mac ».')

const bump = opt('--bump')
if (bump) run('npm', ['version', bump, '--no-git-tag-version'])
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version

run('node', ['scripts/make-secret.js'])                      // ne fait rien si le secret existe déjà
if (!args.includes('--skip-tests')) run('node', ['test/unit.js'])

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
for (const t of wanted) {
  const flags = { linux: ['--linux', 'AppImage', 'deb'], win: ['--win', 'zip'], mac: ['--mac', 'dmg', 'zip'] }[t]
  run('npx', ['electron-builder', ...flags])
  if (t === 'win') {                                          // installateur Windows (raccourcis, désinstallation) : NSIS direct, sans Wine
    if (spawnSync('makensis', ['-VERSION']).status === 0) run('node', ['scripts/make-installer.js'])
    else console.log('ℹ  makensis absent : seule l\'archive ZIP Windows est produite (apt install nsis pour l\'installateur).')
  }
}

const out = opt('--publish')
if (out) run('node', ['scripts/publish.js', out])
console.log(`\n✔ Version ${version} construite pour : ${wanted.join(', ')}.  Fichiers : ${path.join(root, 'dist')}`)
if (!out) console.log('  Pour les mettre à disposition des étudiants : node scripts/publish.js /home/serge/cei-client-dist')
