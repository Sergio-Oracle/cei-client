'use strict'
// Mise à jour automatique de bout en bout (Linux, écran virtuel Xvfb) : l'application démarre, trouve une version plus récente sur un faux serveur
// CEI, la télécharge, contrôle somme + signature, REMPLACE son propre fichier AppImage, se ferme et le nouveau fichier est relancé.
// Trois scénarios : version valide / signature falsifiée / contenu qui ne correspond pas à la somme annoncée (les deux derniers ne doivent RIEN modifier).
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto')
const { spawn } = require('child_process')
const u = require('../src/updater')
let SECRET = 'dev-secret-non-securise'
try { SECRET = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'secret.json'), 'utf8')).clientSecret } catch { /* secret de développement */ }

let ok = 0, ko = 0
const t = (n, c, d) => { c ? ok++ : ko++; console.log((c ? '  ✔ ' : '  ✘ ') + n + (c ? '' : '  — ' + (d || ''))) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function scenario(name, { badSig = false, wrongBytes = false }, expectInstalled) {
  return new Promise(resolve => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cei-updtest-'))
    const marker = path.join(work, 'relance.txt'), target = path.join(work, 'CEI-Examen.AppImage')
    const OLD = '#!/bin/sh\necho ancienne-version\n'
    const NEW = `#!/bin/sh\necho "nouvelle-version" > "${marker}"\n`
    fs.writeFileSync(target, OLD, { mode: 0o755 })
    const claimed = crypto.createHash('sha256').update(NEW).digest('hex')
    const entry = { name: 'CEI-Examen-9.9.9-linux-x86_64.AppImage', platform: 'linux', arch: 'x64', mode: 'appimage', size: NEW.length, sha256: claimed, url: '/static/downloads/CEI-Examen-9.9.9-linux-x86_64.AppImage',
      sig: badSig ? 'f'.repeat(64) : u.signUpdate(SECRET, '9.9.9', 'CEI-Examen-9.9.9-linux-x86_64.AppImage', claimed) }
    let downloads = 0
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/exam-client/releases')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: '9.9.9', files: [], updates: [entry] })) }
      if (req.url.startsWith('/static/downloads/')) { downloads++; res.setHeader('content-type', 'application/octet-stream'); return res.end(wrongBytes ? '#!/bin/sh\necho piege\n' : NEW) }
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>login</title>connexion')
    })
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const env = { ...process.env, CEI_URL: `http://127.0.0.1:${port}/`, CEI_ALLOWED_HOSTS: '127.0.0.1', CEI_UPDATE_TEST: '1', APPIMAGE: target, CEI_USERDATA: path.join(work, 'profil'), ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
      delete env.ELECTRON_RUN_AS_NODE; delete env.CEI_TEST
      const bin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron')
      const child = spawn('xvfb-run', ['-a', bin, path.join(__dirname, '..'), '--no-sandbox', '--disable-gpu'], { env, stdio: 'ignore', detached: true })
      let exited = false; child.on('exit', () => { exited = true })
      ;(async () => {
        for (let i = 0; i < 40 && !fs.existsSync(marker) && !(exited && i > 5); i++) await sleep(1000)
        if (expectInstalled) { for (let i = 0; i < 12 && !fs.existsSync(marker); i++) await sleep(1000) }   // la relance se fait 2 s après la fermeture
        else await sleep(4000)
        const now = fs.readFileSync(target, 'utf8')
        console.log(`\n— ${name}`)
        if (expectInstalled) {
          t('le fichier AppImage a été remplacé par la nouvelle version', now === NEW, now.slice(0, 60))
          t('la nouvelle version a été relancée toute seule', fs.existsSync(marker) && /nouvelle-version/.test(fs.readFileSync(marker, 'utf8')))
          t('l\'ancienne application s\'est fermée', exited)
          t('l\'état de la tentative est mémorisé (pas de boucle de mise à jour)', fs.existsSync(path.join(work, 'profil', 'update-state.json')))
        } else {
          t('fichier refusé : l\'application n\'a PAS été modifiée', now === OLD, now.slice(0, 60))
          t('aucune relance', !fs.existsSync(marker))
          t(wrongBytes ? 'le fichier a bien été téléchargé puis rejeté (somme différente)' : 'rien n\'a même été téléchargé (signature invalide)', wrongBytes ? downloads >= 1 : downloads === 0, 'téléchargements : ' + downloads)
        }
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* déjà terminé */ }
        server.close(); fs.rmSync(work, { recursive: true, force: true }); resolve()
      })()
    })
  })
}

;(async () => {
  await scenario('mise à jour valide (signée, somme correcte)', {}, true)
  await scenario('signature falsifiée', { badSig: true }, false)
  await scenario('contenu différent de la somme annoncée', { wrongBytes: true }, false)
  console.log(`\n${ok}/${ok + ko} vérifications réussies`)
  process.exit(ko ? 1 : 0)
})()
