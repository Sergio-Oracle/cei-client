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
  const pt = await c.ports()
  rep('ports : écrans branchés et disques USB fournis à la page (nombre, liste)', pt && typeof pt.displays === 'number' && pt.displays >= 1 && Array.isArray(pt.usb), JSON.stringify(pt))
  rep('signature : le nombre d\\'écrans et de disques USB est fourni au serveur (refus du démarrage si branchés)', sg && typeof sg.displays === 'number' && typeof sg.usb_storage === 'number', JSON.stringify(sg && [sg.displays, sg.usb_storage]))
  rep('signature : l\\'indicateur « session à distance » est fourni au serveur (booléen)', sg && typeof sg.remote === 'boolean', JSON.stringify(sg && sg.remote))
  window.addEventListener('keydown', e => { if (e.key === 'Escape') window.__gotEsc = true; if (e.key === 'F2') window.__gotF2 = true })
  const en = await c.enterExamMode({ maxMinutes: 60, examId: 7, userId: 42, allowedSites: [location.origin + '/assist/', 'http://pas-https.example/'], allowedApps: [] })
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
  await window.__testKeys({ type: 'keyDown', keyCode: 'Escape' }); await window.__testKeys({ type: 'keyDown', keyCode: 'F2' }); await wait(400)
  rep('ÉCHAP n\\'atteint jamais la page pendant l\\'examen (plus de « Revenir à l\\'examen »)', !window.__gotEsc)
  rep('les touches de fonction (F2…) n\\'atteignent pas la page non plus', !window.__gotF2)
  rep('F12 bloqué et signalé (devtools_attempt)', has('devtools_attempt'))
  rep('Ctrl+W bloqué et signalé', has('client_shortcut_blocked'))
  await window.__testClose(); await wait(300)
  rep('fermeture refusée pendant l\\'examen', has('client_close_attempt'))
  await wait(3500)
  rep('outil de contrôle à distance (TeamViewer) détecté, signalé ET arrêté', events.some(e => e.type === 'client_forbidden_app' && /teamviewer/.test(e.data.name) && e.data.remote_tool && e.data.killed), JSON.stringify(events.filter(e=>e.type==='client_forbidden_app')))
  // ── fenêtre d'assistance : seuls les sites choisis pour l'examen, https obligatoire, contenue dans l'application ──
  const bad1 = await c.openAssist('https://evil.example/'); const bad2 = await c.openAssist('http://pas-https.example/')
  rep('site non autorisé refusé pour l\\'assistance (et http refusé)', bad1 && !bad1.ok && bad2 && !bad2.ok, JSON.stringify([bad1, bad2]))
  const as1 = await c.openAssist(location.origin + '/assist/salle'); await wait(1500)
  const st3 = await c.status()
  rep('assistance : site autorisé ouvert dans une fenêtre de l\\'application', as1 && as1.ok && st3.assist && has('client_assist_opened'), JSON.stringify([as1, st3.assist]))
  for (let i = 0; i < 8 && !events.some(e => e.type === 'client_navigation_blocked' && e.data.where === 'assistance'); i++) await wait(500)
  rep('assistance : la fenêtre ne peut pas aller ailleurs (navigation bloquée et signalée)', events.some(e => e.type === 'client_navigation_blocked' && e.data.where === 'assistance'))
  const cl2 = await c.closeAssist(); await wait(500); const st4 = await c.status()
  rep('assistance : fermée à la demande', cl2.ok && !st4.assist && has('client_assist_closed'))
  await c.openAssist(location.origin + '/assist/salle'); await wait(800)
  await window.__testBlur(); await wait(1200)
  // applications : une fenêtre étrangère apparaît pendant l'examen → fermée aussitôt et signalée
  for (let i = 0; i < 20 && !events.some(e => e.type === 'client_app_closed'); i++) await wait(1000)
  rep('application étrangère ouverte pendant l\\'examen : fermée et signalée', events.some(e => e.type === 'client_app_closed' && /xeyes/.test(e.data.name)), JSON.stringify(events.filter(e => e.type === 'client_app_closed')))
  rep('perte de focus signalée puis premier plan repris', has('window_blur'))
  // ── Médias : caméra, micro, partage d'écran, WebRTC, notifications — dans l'application, en mode examen ──
  try {
    const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true })
    const v = cam.getVideoTracks()[0], a = cam.getAudioTracks()[0]
    rep('caméra : flux vidéo actif', v && v.readyState === 'live' && (v.getSettings().width || 0) >= 320, JSON.stringify(v && v.getSettings()))
    rep('micro : flux audio actif', a && a.readyState === 'live')
    window.__cam = cam
  } catch (e) { rep('caméra et micro', false, e.name + ' ' + e.message) }
  try {
    const ss = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always', displaySurface: 'monitor' }, preferCurrentTab: false, audio: false })
    const t = ss.getVideoTracks()[0], st = t.getSettings()
    rep('partage d\\'écran complet : flux actif, surface acceptée par l\\'examen', t.readyState === 'live' && (st.displaySurface === undefined || st.displaySurface === 'monitor'), JSON.stringify(st))
    const ended = new Promise(r => t.addEventListener('ended', () => r(true)))
    t.stop()
    rep('partage d\\'écran : arrêt détectable', t.readyState === 'ended')
  } catch (e) { rep('partage d\\'écran complet', false, e.name + ' ' + e.message) }
  try {
    const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection()
    pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate)
    pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate)
    ;(window.__cam ? window.__cam.getTracks() : []).forEach(t => pc1.addTrack(t, window.__cam))
    const got = new Promise(r => { pc2.ontrack = () => r(true); setTimeout(() => r(false), 9000) })
    await pc1.setLocalDescription(await pc1.createOffer()); await pc2.setRemoteDescription(pc1.localDescription)
    await pc2.setLocalDescription(await pc2.createAnswer()); await pc1.setRemoteDescription(pc2.localDescription)
    const ok = await got
    await wait(1500)
    let sent = 0; (await pc1.getStats()).forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') sent = r.bytesSent || 0 })
    rep('WebRTC : flux vidéo transmis entre deux connexions (comme vers le serveur de visioconférence)', ok && sent > 1000, 'octets envoyés : ' + sent)
    pc1.close(); pc2.close()
  } catch (e) { rep('WebRTC', false, e.name + ' ' + e.message) }
  rep('notifications autorisées', (await Notification.requestPermission()) === 'granted')
  rep('WebAssembly disponible (détection du visage)', typeof WebAssembly === 'object')
  // ── sortie d'urgence : vérifiée par le serveur, jamais en local ──
  const q1 = await window.__testQuit('00000000')
  rep('mauvais code : refusé par le serveur, l\\'application reste verrouillée', q1 && !q1.ok && /Code incorrect/.test(q1.message) && (await c.status()).examMode, JSON.stringify(q1))
  const q0 = await window.__testQuit('')
  rep('code vide : refusé sans appel au serveur', q0 && !q0.ok)
  const lv = await c.leaveExamMode(); await wait(300)
  const st2 = await c.status()
  rep('mode examen quitté', lv.ok && st2 && !st2.examMode && !st2.kiosk, JSON.stringify(st2))
  rep('la sortie du mode examen ferme aussi la fenêtre d\\'assistance', !st2.assist, JSON.stringify(st2))
  // le dernier essai (bon code) ferme l'application : le rapport part AVANT
  await fetch('/report', { method: 'POST', body: JSON.stringify(out) })
  await c.enterExamMode({ maxMinutes: 60, examId: 7, userId: 42 })
  await window.__testQuit('1234-5678')
})().catch(e => { console.log('ERREUR page: ' + e.message); fetch('/report', { method: 'POST', body: JSON.stringify([{ n: 'erreur page', ok: false, d: e.message }]) }) })
</script>`

let seenSig = null
let exitSeen = null, exitBad = 0
const SECRET = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'secret.json'), 'utf8')).clientSecret } catch { return 'dev-secret-non-securise' } })()
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/assist')) {                       // page d'assistance d'essai : tente de partir ailleurs
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>assist</title>assistance<script>setTimeout(()=>{location.href="https://evil.example/"},600)</script>'); return
  }
  if (req.method === 'POST' && req.url === '/api/exam-client/exit') {     // même contrôle que le serveur de production
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b); const want = crypto.createHmac('sha256', SECRET).update(`exit|${j.exam_id}|${j.user_id}|${j.code}|${j.ts}|${j.version}|${j.platform}`).digest('hex')
      const good = want === j.sig && Math.abs(Date.now() - j.ts) < 120000 && /CEIExamClient\/1\./.test(req.headers['user-agent'] || '')
      res.setHeader('content-type', 'application/json')
      if (good && String(j.code).replace(/\D/g, '') === '12345678') { exitSeen = j; res.end(JSON.stringify({ ok: true })) }
      else { exitBad += 1; res.statusCode = 403; res.end(JSON.stringify({ error: good ? 'Code incorrect' : 'Demande refusée.', tries_left: 4 })) }
    }); return
  }
  if (req.method === 'POST' && req.url === '/sig') { let b = ''; req.on('data', d => b += d); req.on('end', () => { seenSig = JSON.parse(b); res.end('ok') }); return }
  if (req.method === 'POST' && req.url === '/report') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => { res.end('ok'); reported = JSON.parse(b); setTimeout(() => finish(reported), 9000) })
  } else { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE) }
})
let child, fake, done = false, reported = null, childExited = false
function finish(results) {
  if (done) return; done = true
  let fails = 0
  results.push({ n: 'bon code : signature valide, accepté par le serveur, usage unique côté essai', ok: !!exitSeen && exitBad >= 1, d: JSON.stringify({ exitSeen: !!exitSeen, refusés: exitBad }) })
  results.push({ n: 'bon code : l\'application se ferme', ok: childExited, d: 'toujours ouverte' })
  let faked = true; try { process.kill(fake.pid, 0) } catch { faked = false }
  results.push({ n: 'l\'outil de contrôle à distance a bien été arrêté (processus disparu)', ok: !faked, d: 'toujours en cours' })
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
  child = spawn('xvfb-run', ['-a', 'sh', '-c', sh, 'cei', ...bin, '--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  child.stdout.on('data', d => { const t = String(d); if (/PAGE>|Error|Uncaught/.test(t)) process.stdout.write(t) })
  child.stderr.on('data', d => { const s = String(d); if (/Error|Uncaught/i.test(s) && !/dbus|gpu|vaapi|Fontconfig/i.test(s)) process.stderr.write(s) })
  child.on('exit', () => { childExited = true; if (reported && !done) setTimeout(() => finish(reported), 500) })
  setTimeout(() => { if (!done) { console.log('  ✘ délai dépassé (le client ne répond pas)'); finish([{ n: 'délai', ok: false, d: 'timeout' }]) } }, 120000)
})
