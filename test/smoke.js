'use strict'
// Essai de bout en bout du client sous un écran virtuel (Xvfb) : une page de test pilote le client et rend compte.
const http = require('http')
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PAGE = `<!doctype html><meta charset=utf-8><title>t</title><body>test<script>
const out = []; const rep = (n, ok, d) => out.push({ n, ok: !!ok, d: d === undefined ? '' : String(d) })
const events = []
window.addEventListener('cei-client-event', e => events.push(JSON.parse(e.detail)))
const wait = ms => new Promise(r => setTimeout(r, ms))
const has = t => events.some(e => e.type === t)
;(async () => {
  const c = window.ceiClient
  rep('pont ceiClient exposé', c && c.isCEIClient)
  rep('agent utilisateur marqué CEIExamClient', /CEIExamClient\\/1\\./.test(navigator.userAgent), navigator.userAgent.slice(-40))
  const info = await c.info()
  rep('info : client, version, plateforme', info && info.client === 'CEIExamClient' && info.version && info.platform, JSON.stringify(info))
  const before = await c.listApps()
  rep('avant l\\'examen : l\\'application ouverte (xmessage) est listée', before && before.apps.some(a => /xmessage/.test(a.name)), JSON.stringify(before))
  const cl = await c.closeApps()
  rep('« Fermer ces applications » : fermée, plus rien ne reste', cl && cl.remaining.length === 0, JSON.stringify(cl))
  const after = await c.listApps()
  rep('après fermeture : plus aucune application étrangère', after && !after.apps.some(a => /xmessage/.test(a.name)), JSON.stringify(after))
  const sg = await c.sign('NONCE123', 42, 7)
  rep('signature de la poignée de main', sg && /^[0-9a-f]{64}$/.test(sg.sig), JSON.stringify(sg))
  await fetch('/sig', { method: 'POST', body: JSON.stringify({ sig: sg.sig, version: sg.version, platform: sg.platform }) })
  const en = await c.enterExamMode({ maxMinutes: 60 })
  rep('mode examen activé', en && en.ok, JSON.stringify(en))
  await wait(300)
  const st = await c.status()
  rep('kiosque actif', st && st.examMode && st.kiosk, JSON.stringify(st))
  rep('nouvelle fenêtre refusée', window.open('https://example.org') === null)
  location.href = 'https://evil.example/'
  await wait(800)
  rep('navigation hors site refusée + signalée', location.hostname === '127.0.0.1' && has('client_navigation_blocked'))
  // essais pilotés par le processus principal
  const ti = (spec) => window.__ti(spec)
  await window.__test('F12'); await window.__test('ctrl-w'); await wait(300)
  rep('F12 bloqué et signalé (devtools_attempt)', has('devtools_attempt'))
  rep('Ctrl+W bloqué et signalé', has('client_shortcut_blocked'))
  await window.__testClose(); await wait(300)
  rep('fermeture refusée pendant l\\'examen', has('client_close_attempt'))
  await wait(3500)
  rep('logiciel interdit détecté', events.some(e => e.type === 'client_forbidden_app' && /teamviewer/.test(e.data.name)), JSON.stringify(events.filter(e=>e.type==='client_forbidden_app')))
  await window.__testBlur(); await wait(1200)
  // applications : une fenêtre étrangère apparaît pendant l'examen → fermée aussitôt et signalée
  for (let i = 0; i < 20 && !events.some(e => e.type === 'client_app_closed'); i++) await wait(1000)
  rep('application étrangère ouverte pendant l\\'examen : fermée et signalée', events.some(e => e.type === 'client_app_closed' && /xeyes/.test(e.data.name)), JSON.stringify(events.filter(e => e.type === 'client_app_closed')))
  rep('perte de focus signalée puis premier plan repris', has('window_blur'))
  const lv = await c.leaveExamMode(); await wait(200)
  const st2 = await c.status()
  rep('mode examen quitté', lv.ok && st2 && !st2.examMode && !st2.kiosk, JSON.stringify(st2))
  await fetch('/report', { method: 'POST', body: JSON.stringify(out) })
})().catch(e => { console.log('ERREUR page: ' + e.message); fetch('/report', { method: 'POST', body: JSON.stringify([{ n: 'erreur page', ok: false, d: e.message }]) }) })
</script>`

let seenSig = null
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/sig') { let b = ''; req.on('data', d => b += d); req.on('end', () => { seenSig = JSON.parse(b); res.end('ok') }); return }
  if (req.method === 'POST' && req.url === '/report') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => { res.end('ok'); finish(JSON.parse(b)) })
  } else { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE) }
})
let child, fake, done = false
function finish(results) {
  if (done) return; done = true
  let fails = 0
  for (const r of results) { if (!r.ok) fails++; console.log((r.ok ? '  ✔ ' : '  ✘ ') + r.n + (r.ok ? '' : '  — ' + r.d)) }
  // Vérification de la signature comme le fait le serveur (même secret que celui embarqué : src/secret.json en essai local)
  if (seenSig) {
    let secret = 'dev-secret-non-securise'
    try { secret = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'secret.json'), 'utf8')).clientSecret } catch {}
    const want = crypto.createHmac('sha256', secret).update(`NONCE123|42|${seenSig.version}|${seenSig.platform}`).digest('hex')
    const ok = want === seenSig.sig
    results.push({ n: 'signature identique à celle que calcule le serveur (HMAC-SHA256)', ok, d: ok ? '' : 'signatures différentes' }); if (!ok) fails++
    console.log((ok ? '  ✔ ' : '  ✘ ') + 'signature identique à celle que calcule le serveur (HMAC-SHA256)')
  }
  console.log(`\n${results.length - fails}/${results.length} vérifications réussies`)
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
  try { process.kill(fake.pid) } catch {}
  server.close(); process.exit(fails ? 1 : 0)
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  fs.copyFileSync('/bin/sleep', '/tmp/teamviewer'); fs.chmodSync('/tmp/teamviewer', 0o755)
  fake = spawn('/tmp/teamviewer', ['120'], { stdio: 'ignore', detached: true }); fake.unref()
  const base = { ...process.env }; delete base.ELECTRON_RUN_AS_NODE     // l'éditeur peut l'imposer : Electron se lancerait alors comme un simple Node
  const env = { ...base, CEI_URL: `http://127.0.0.1:${port}/`, CEI_ALLOWED_HOSTS: '127.0.0.1', CEI_TEST: '1', CEI_USERDATA: fs.mkdtempSync('/tmp/cei-smoke-'), CEI_SCAN_MS: '1000', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  const bin = process.env.CEI_BIN ? [process.env.CEI_BIN] : [path.join(__dirname, '..', 'node_modules', '.bin', 'electron'), path.join(__dirname, '..')]   // CEI_BIN : essai du binaire EMPAQUETÉ
  const sh = `xmessage -timeout 300 bonjour & (sleep 14; xeyes) & exec "$@"`
  child = spawn('xvfb-run', ['-a', 'sh', '-c', sh, 'cei', ...bin, '--no-sandbox', '--disable-gpu'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  child.stdout.on('data', d => { const t = String(d); if (/PAGE>|Error|Uncaught/.test(t)) process.stdout.write(t) })
  child.stderr.on('data', d => { const s = String(d); if (/Error|Uncaught/i.test(s) && !/dbus|gpu|vaapi|Fontconfig/i.test(s)) process.stderr.write(s) })
  setTimeout(() => { if (!done) { console.log('  ✘ délai dépassé (le client ne répond pas)'); finish([{ n: 'délai', ok: false, d: 'timeout' }]) } }, 90000)
})
