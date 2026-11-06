'use strict'
/**
 * CEI Examen — client d'examen sécurisé (équivalent de Safe Exam Browser pour la plateforme CEI).
 *
 * Hors examen : la plateforme s'ouvre comme dans un navigateur sobre (connexion, tableau de bord).
 * Pendant l'examen (la page demande « mode examen ») le client prend le contrôle de la machine :
 *   • plein écran kiosque, toujours au premier plan, impossible à fermer, à réduire ou à déplacer ;
 *   • raccourcis de sortie bloqués, outils de développement absents, un seul site autorisé, aucune nouvelle fenêtre ;
 *   • perte de focus (Alt+Tab, menu Démarrer…) : la fenêtre reprend aussitôt le premier plan et l'événement est signalé ;
 *   • écrans supplémentaires recouverts, presse-papiers vidé en continu, capture d'écran masquée (protection du contenu) ;
 *   • logiciels interdits (prise de contrôle à distance, partage/enregistrement d'écran, messageries) et machine virtuelle détectés et signalés ;
 *   • outils de bureau / contrôle à distance arrêtés dès leur détection, session à distance refusée à l'entrée ;
 *   • sortie d'urgence uniquement par un code ALÉATOIRE, À USAGE UNIQUE, généré pour cet étudiant par le surveillant et vérifié EN LIGNE par le serveur ;
 *   • fenêtre d'assistance (sites choisis par l'enseignant pour cet examen) : seul canal extérieur toléré, contenu dans l'application.
 * Limite assumée : aucune application ne peut intercepter Ctrl+Alt+Suppr ni la coupure de courant ; tout ce qui peut être fait
 * est fait, et le reste est détecté et tracé côté serveur.
 */
const { app, BrowserWindow, session, globalShortcut, screen, clipboard, ipcMain, Menu, desktopCapturer, systemPreferences, net, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const cfg = require('./config')
const guard = require('./guard')
const updater = require('./updater')
const { spawn } = require('child_process')

app.userAgentFallback = `${app.userAgentFallback} CEIExamClient/${cfg.version}`
// AppImage sur Ubuntu 23.10+ / systèmes restreignant les espaces de noms utilisateurs : le bac à sable de Chromium ne peut pas démarrer
// (« SUID sandbox helper… »). On le désactive alors UNIQUEMENT dans ce cas ; le paquet .deb, lui, règle le bac à sable à l'installation.
if (process.platform === 'linux' && process.env.APPIMAGE) {
  const rd = f => { try { return fs.readFileSync(f, 'utf8').trim() } catch { return '' } }
  if (rd('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' || rd('/proc/sys/kernel/unprivileged_userns_clone') === '0') app.commandLine.appendSwitch('no-sandbox')
}
if (process.env.CEI_USERDATA) app.setPath('userData', process.env.CEI_USERDATA)      // essais : profil jetable
if (process.platform === 'win32') app.setAppUserModelId('sn.unchk.cei.examen')   // icône et regroupement corrects dans la barre des tâches
if (!cfg.test && !app.requestSingleInstanceLock()) { app.quit() }

let win = null
let quitWin = null
let allowQuit = false
let vmInfo = { vm: false, hint: '' }
const covers = []
const pending = []                       // événements en attente tant que la première page n'est pas chargée
let pageReady = false
const timers = []
let globalOk = []
const exam = { active: false, since: 0, maxTimer: null, blurAt: 0, lastShortcutAt: 0, forbiddenSeen: new Map(), remoteSeen: false, lastFocus: 'main',
  examId: 0, userId: 0, allowedSites: [], allowedApps: [] }
let assistWin = null

// Lien « Ouvrir dans l'application » depuis la plateforme : ceiexamen://exam/<id>
const PROTO = 'ceiexamen'
function openDeepLink(u) {
  try {
    const x = new URL(u)
    if (x.protocol === PROTO + ':' && x.hostname === 'exam' && /^\/\d+$/.test(x.pathname) && win && !win.isDestroyed()) win.loadURL(`${cfg.url.replace(/\/$/, '')}/exam${x.pathname}`)
  } catch { /* lien illisible : ignoré */ }
}
const selfIdentity = () => {
  const names = new Set(['cei examen', 'cei-examen', 'ceiexamen', 'electron', path.basename(process.execPath).toLowerCase().replace(/\.(exe|app)$/, '')])
  const pids = new Set([process.pid, process.ppid])
  try { for (const m of app.getAppMetrics()) pids.add(m.pid) } catch { /* avant ready */ }
  return { names, pids }
}
// Sites d'assistance : https obligatoire (http seulement vers 127.0.0.1 pour les essais automatiques)
const okAssistUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' || (cfg.test && x.protocol === 'http:' && x.hostname === '127.0.0.1') } catch { return false } }
const sameHost = (a, b) => { try { return new URL(a).hostname === new URL(b).hostname } catch { return false } }
const assistAllowedHost = h => exam.allowedSites.some(s => { try { return new URL(s).hostname === h } catch { return false } })
/** Réglages de l'examen donnés par la page (identité, sites d'assistance, applications tolérées) : validés ici, jamais crus tels quels. */
function applyExamConfig(o = {}) {
  if (Number.isInteger(o.examId) && o.examId > 0) exam.examId = o.examId
  if (Number.isInteger(o.userId) && o.userId > 0) exam.userId = o.userId
  if (Array.isArray(o.allowedSites)) exam.allowedSites = o.allowedSites.map(String).filter(okAssistUrl).slice(0, 5)
  if (Array.isArray(o.allowedApps)) exam.allowedApps = o.allowedApps.map(x => String(x).slice(0, 60)).slice(0, 10)
  guard.setExtraAllow([...cfg.allowApps, ...exam.allowedApps])
}
const isAllowed = u => { try { const h = new URL(u).hostname; return cfg.allowedHosts.some(a => h === a || h.endsWith('.' + a)) } catch { return false } }
const logFile = () => path.join(app.getPath('userData'), 'client.log')
const log = (...a) => { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${a.join(' ')}\n`) } catch { /* journal local facultatif */ } }

/** Signale un événement à la page (qui le journalise côté serveur) et au journal local. */
function report(type, data = {}) {
  const evt = { type, data, ts: Date.now() }
  log('EVT', type, JSON.stringify(data))
  if (win && !win.isDestroyed() && pageReady) win.webContents.send('cei:event', evt)
  else pending.push(evt)
}

// ── Fenêtre principale ────────────────────────────────────────────────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null)
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#0f172a', title: 'CEI Examen',
    autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      devTools: cfg.devtools, spellcheck: false, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
    },
  })
  win.setMenu(null)
  if (cfg.test) win.webContents.on('console-message', (_e, _l, msg, line) => console.log('PAGE>', msg, line))
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))                 // aucune nouvelle fenêtre, jamais
  // Hors examen : la connexion (SSO UNCHK, Moodle…) passe par d'autres sites, seuls les liens https sont permis.
  // Pendant l'examen : un seul site, rien d'autre.
  const guardNav = (e, url) => {
    const ok = exam.active ? isAllowed(url) : /^https?:/i.test(String(url))
    if (!ok) { e.preventDefault(); report('client_navigation_blocked', { url: String(url).slice(0, 200) }) }
  }
  win.webContents.on('will-navigate', guardNav)
  win.webContents.on('will-redirect', guardNav)
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: cfg.startUrl } })
  })
  win.webContents.on('did-finish-load', () => { pageReady = true; while (pending.length) win.webContents.send('cei:event', pending.shift()) })
  win.webContents.on('render-process-gone', () => { log('CRASH renderer'); setTimeout(() => win && !win.isDestroyed() && win.loadURL(cfg.startUrl), 800) })
  win.on('unresponsive', () => setTimeout(() => win && !win.isDestroyed() && win.reload(), 20000))
  win.webContents.on('before-input-event', onInput)
  win.on('close', e => { if (exam.active && !allowQuit) { e.preventDefault(); report('client_close_attempt') } })
  win.on('closed', () => { win = null })
  win.loadURL(cfg.startUrl)
}

// ── Raccourcis : bloqués pendant l'examen ──────────────────────────────────────────────────────────────────────────────
function onInput(event, input) {
  if (!exam.active || input.type !== 'keyDown') return
  const k = (input.key || '').toLowerCase()
  const ctrl = input.control || input.meta
  const devtools = k === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(k))
  const block = devtools
    || /^f([1-9]|1[0-9]|2[0-4])$/.test(k)                       // toutes les touches de fonction
    || k === 'escape'                                            // Échap : sortirait du plein écran de la page (« Revenir à l'examen »)
    || (input.alt && (k === ' ' || k === 'space'))               // menu système de la fenêtre
    || (ctrl && !input.shift && !input.alt && ['w', 'q', 'r', 'n', 't', 'p', 's', 'u', 'o', 'l', 'f', 'g', 'h', 'j', 'd', 'e', 'k', 'b', '+', '-', '=', '0', 'tab'].includes(k))
    || (ctrl && input.shift && ['r', 'n', 't', 'w', 'p', 'delete', 'o', 'b'].includes(k))
    || (input.alt && ['f4', 'arrowleft', 'arrowright', 'home', 'd', 'tab', 'escape'].includes(k))
    || k === 'meta' || k === 'contextmenu'
  if (!block) return
  event.preventDefault()
  const now = Date.now()
  if (devtools) report('devtools_attempt', { via: 'client', key: input.key })
  else if (now - exam.lastShortcutAt > 8000) { exam.lastShortcutAt = now; report('client_shortcut_blocked', { key: input.key }) }
}

function registerGlobalShortcuts() {
  globalOk = []
  const list = ['PrintScreen', 'Alt+PrintScreen', 'CommandOrControl+Shift+S', 'Alt+Tab', 'Alt+Shift+Tab', 'Alt+Escape', 'CommandOrControl+Escape', 'Super+D', 'Super+Tab']
  for (const acc of list) {
    try {
      if (globalShortcut.register(acc, () => { report('client_shortcut_blocked', { key: acc, global: true }) })) globalOk.push(acc)
    } catch { /* touche réservée par le système : impossible à intercepter, sera détectée par la perte de focus */ }
  }
  // Sortie d'urgence (code du surveillant)
  try { globalShortcut.register('CommandOrControl+Shift+Alt+Q', openQuitPrompt) } catch { /* idem */ }
}

// ── Surveillance de la machine pendant l'examen ──────────────────────────────────────────────────────────────────────
function coverOtherDisplays() {
  covers.splice(0).forEach(w => { try { w.destroy() } catch { /* déjà fermée */ } })
  if (!exam.active) return
  const primary = screen.getPrimaryDisplay()
  const others = screen.getAllDisplays().filter(d => d.id !== primary.id)
  if (others.length) report('client_second_display', { count: others.length })
  for (const d of others) {
    const w = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, backgroundColor: '#000000', show: false, webPreferences: { sandbox: true, devTools: false } })
    w.setAlwaysOnTop(true, 'screen-saver')
    w.loadURL('data:text/html,<body style="margin:0;background:#000"></body>')
    w.once('ready-to-show', () => w.showInactive())
    covers.push(w)
  }
}

// ── Ports : sorties vidéo externes et stockage USB ───────────────────────────────────────────────────────────────────────────
// Refus à l'entrée (voir cei:sign + serveur), correction automatique pendant l'examen (disque USB éjecté, sortie vidéo externe coupée quand
// le système le permet à un simple utilisateur), écran supplémentaire recouvert (coverOtherDisplays), tout est signalé au surveillant.
const portSeen = new Map()
async function checkPorts() {
  const electronCount = screen.getAllDisplays().length
  const p = await guard.detectPorts(electronCount)
  const badDisp = p.displays > 1, badUsb = p.usb.length > 0
  if (!badDisp && !badUsb) return p
  const done = await guard.enforcePorts(p)
  const now = Date.now()
  if (badUsb && now - (portSeen.get('usb') || 0) > 60000) { portSeen.set('usb', now); report('client_usb_storage', { count: p.usb.length, ejected: done.ejected }) }
  // Plusieurs écrans visibles pour Electron : déjà signalé et recouvert par coverOtherDisplays ; ici, le cas invisible pour lui (écran dupliqué / en miroir)
  if (badDisp && p.displays > electronCount && now - (portSeen.get('display') || 0) > 60000) { portSeen.set('display', now); report('client_external_display', { count: p.displays, kinds: p.displayNames, off: done.displaysOff }) }
  return p
}

function startWatchers() {
  const every = (ms, fn) => timers.push(setInterval(() => { try { fn() } catch (e) { log('ERR watcher', e.message) } }, ms))
  every(400, () => {                                         // reprise du premier plan
    if (!exam.active || !win || win.isDestroyed()) return
    const live = w => w && !w.isDestroyed()
    if (win.isFocused()) exam.lastFocus = 'main'
    if (live(assistWin) && assistWin.isFocused()) exam.lastFocus = 'assist'
    const inOurWindow = (live(assistWin) && assistWin.isFocused()) || (live(quitWin) && quitWin.isFocused())   // fenêtre d'assistance / saisie du code : tolérées
    if ((!win.isFocused() && !inOurWindow) || exam.forceBlur) {
      exam.forceBlur = false
      const now = Date.now()
      if (now - exam.blurAt > 2500) { exam.blurAt = now; report('window_blur', { via: 'client' }) }
      const back = exam.lastFocus === 'assist' && live(assistWin) ? assistWin : win
      back.show(); back.focus(); back.moveTop(); back.setAlwaysOnTop(true, 'screen-saver')
    }
    if (live(assistWin) && !assistWin.isVisible()) assistWin.show()
  })
  every(1500, () => { if (exam.active) clipboard.clear() })  // rien d'extérieur ne peut être collé
  let sweeping = false
  every(cfg.appsMs, async () => {                              // toute autre application avec une fenêtre est fermée aussitôt
    if (!exam.active || sweeping) return
    sweeping = true
    try {
      const apps = await guard.listWindowApps(selfIdentity())
      if (apps.length) {
        const left = await guard.closeApps(apps, selfIdentity(), { force: true })
        for (const a of apps) {
          const last = exam.forbiddenSeen.get('app:' + a.name) || 0
          if (Date.now() - last > 60 * 1000) { exam.forbiddenSeen.set('app:' + a.name, Date.now()); report('client_app_closed', { name: a.name, still_open: left.some(x => x.name === a.name) }) }
        }
      }
    } finally { sweeping = false }
  })
  let portsBusy = false
  every(cfg.portsMs, async () => {
    if (!exam.active || portsBusy || cfg.noPorts) return
    portsBusy = true
    try { await checkPorts() } finally { portsBusy = false }
  })
  every(cfg.scanMs, async () => {
    if (!exam.active) return
    const procs = await guard.listProcesses()
    const remote = guard.remoteToolsIn(procs)
    let still = []
    if (remote.length) still = await guard.killRemoteTools(remote)                                  // arrêtés aussitôt, pas seulement signalés
    for (const name of await guard.forbiddenRunning(procs)) {
      const last = exam.forbiddenSeen.get(name) || 0
      if (Date.now() - last > 5 * 60 * 1000) { exam.forbiddenSeen.set(name, Date.now()); report('client_forbidden_app', { name, remote_tool: remote.includes(name), killed: remote.includes(name) && !still.includes(name) }) }
    }
    const rs = await guard.detectRemoteSession()
    if (rs.remote && !exam.remoteSeen) { exam.remoteSeen = true; report('client_remote_session', { hint: rs.hint }) }
  })
}
app.whenReady().then(() => {
  screen.on('display-added', coverOtherDisplays)
  screen.on('display-removed', coverOtherDisplays)
  screen.on('display-metrics-changed', coverOtherDisplays)
})

function enterExamMode(opts = {}) {
  const { maxMinutes = 240 } = opts
  applyExamConfig(opts)
  if (exam.active || !win) return { ok: true, already: true }
  exam.active = true; exam.since = Date.now(); exam.forbiddenSeen.clear(); exam.remoteSeen = false
  try { win.setKiosk(true) } catch { win.setFullScreen(true) }
  const tryDo = fn => { try { fn() } catch { /* option non disponible sur ce système */ } }
  tryDo(() => win.setAlwaysOnTop(true, 'screen-saver'))
  tryDo(() => win.setContentProtection(true))             // capture / enregistrement d'écran : fenêtre noire
  tryDo(() => win.setMinimizable(false)); tryDo(() => win.setResizable(false)); tryDo(() => win.setMovable(false)); tryDo(() => win.setClosable(false))
  win.focus(); clipboard.clear()
  // Aucun moyen de rester en fenêtre normale : si le plein écran est quitté par n'importe quelle voie, il est rétabli aussitôt
  win.removeAllListeners('leave-full-screen'); win.removeAllListeners('hide')
  win.on('leave-full-screen', () => { if (exam.active && win && !win.isDestroyed()) { try { win.setKiosk(true) } catch { win.setFullScreen(true) } } })
  win.on('hide', () => { if (exam.active && win && !win.isDestroyed()) win.show() })
  registerGlobalShortcuts(); startWatchers(); coverOtherDisplays()
  if (!cfg.noPorts) checkPorts().catch(e => log('ERR ports', e.message))
  clearTimeout(exam.maxTimer)
  exam.maxTimer = setTimeout(() => { report('client_exam_mode_timeout'); leaveExamMode() }, (Math.max(5, Math.min(600, maxMinutes)) + 15) * 60000)   // jamais d'élève prisonnier
  log('EXAM ON')
  return { ok: true, shortcuts: globalOk }
}

function leaveExamMode() {
  if (!exam.active) return { ok: true }
  exam.active = false
  clearTimeout(exam.maxTimer)
  closeAssist()
  exam.allowedSites = []; exam.allowedApps = []; guard.setExtraAllow(cfg.allowApps)      // les exceptions n'existent que le temps de l'examen
  if (win && !win.isDestroyed()) { win.removeAllListeners('leave-full-screen'); win.removeAllListeners('hide') }
  timers.splice(0).forEach(clearInterval)
  try { globalShortcut.unregisterAll() } catch { /* rien */ }
  covers.splice(0).forEach(w => { try { w.destroy() } catch { /* rien */ } })
  if (win && !win.isDestroyed()) {
    const tryDo = fn => { try { fn() } catch { /* rien */ } }
    tryDo(() => win.setKiosk(false)); tryDo(() => win.setAlwaysOnTop(false)); tryDo(() => win.setContentProtection(false))
    tryDo(() => win.setMinimizable(true)); tryDo(() => win.setResizable(true)); tryDo(() => win.setMovable(true)); tryDo(() => win.setClosable(true))
  }
  log('EXAM OFF')
  setTimeout(() => checkUpdate('background'), 8000)          // l'examen est fini : une mise à jour en attente peut être proposée
  return { ok: true }
}

// ── Sortie d'urgence ──────────────────────────────────────────────────────────────────────────────────────────────────
function openQuitPrompt() {
  if (quitWin && !quitWin.isDestroyed()) { quitWin.focus(); return }
  quitWin = new BrowserWindow({ width: 420, height: 230, parent: win || undefined, modal: !!win, alwaysOnTop: true, resizable: false, minimizable: false, frame: true, title: 'Code de sortie',
    autoHideMenuBar: true, webPreferences: { nodeIntegration: true, contextIsolation: false } })
  quitWin.setMenu(null)
  quitWin.loadFile(path.join(__dirname, 'quit.html'))
}
async function submitQuitCode(code) {
  // Hors examen verrouillé : rien à débloquer
  if (!exam.active) { allowQuit = true; setTimeout(() => app.quit(), 200); return { ok: true } }
  if (!exam.examId || !exam.userId) return { ok: false, message: "Identité de l'examen inconnue : redémarrez l'examen ou contactez le surveillant." }
  const typed = String(code || '').trim()
  if (!/\d/.test(typed)) return { ok: false, message: 'Saisissez le code à 8 chiffres donné par le surveillant.' }
  const ts = Date.now()
  const sig = crypto.createHmac('sha256', cfg.clientSecret).update(`exit|${exam.examId}|${exam.userId}|${typed}|${ts}|${cfg.version}|${process.platform}`).digest('hex')
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000)
  try {
    const r = await net.fetch(new URL('/api/exam-client/exit', cfg.url).toString(), {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': `CEIExamClient/${cfg.version}` },
      body: JSON.stringify({ exam_id: exam.examId, user_id: exam.userId, code: typed, ts, version: cfg.version, platform: process.platform, sig }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.ok) { log('QUIT code accepté par le serveur'); allowQuit = true; leaveExamMode(); setTimeout(() => app.quit(), 300); return { ok: true } }
    log('QUIT refusé', r.status)
    const left = typeof j.tries_left === 'number' ? ` (${j.tries_left} essai${j.tries_left > 1 ? 's' : ''} restant${j.tries_left > 1 ? 's' : ''})` : ''
    return { ok: false, message: (j.error || 'Code refusé') + left }
  } catch {
    return { ok: false, message: "Le serveur est injoignable : le code ne peut pas être vérifié. Réessayez dès que la connexion revient. Le verrouillage se lève de lui-même à la fin de l'examen." }
  } finally { clearTimeout(to) }
}
ipcMain.handle('cei:quit-code', (_e, code) => submitQuitCode(code))

// ── Fenêtre d'assistance : sites choisis par l'enseignant pour CET examen, contenus dans l'application ──────────────────────
function openAssist(url) {
  if (!exam.active || !win) return { ok: false, message: "L'assistance n'est disponible que pendant l'examen." }
  const entry = exam.allowedSites.find(s => sameHost(s, url) && (new URL(url).pathname.startsWith(new URL(s).pathname) || new URL(s).pathname === '/'))
  if (!entry) return { ok: false, message: "Ce site n'est pas autorisé pour cet examen." }
  if (assistWin && !assistWin.isDestroyed()) { assistWin.show(); assistWin.focus(); return { ok: true, already: true } }
  const host = new URL(entry).hostname
  assistWin = new BrowserWindow({
    width: 1100, height: 760, parent: win, modal: false, title: `Assistance technique — ${host}`, autoHideMenuBar: true, alwaysOnTop: true, minimizable: false, fullscreenable: false,
    backgroundColor: '#ffffff', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { partition: 'cei-assist', contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, spellcheck: false, webSecurity: true },
  })
  assistWin.setMenu(null)
  try { assistWin.setAlwaysOnTop(true, 'screen-saver'); assistWin.setContentProtection(true) } catch { /* option indisponible */ }
  const as = assistWin.webContents.session
  const okPermA = new Set(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection', 'notifications'])
  as.setPermissionRequestHandler((wc, perm, cb) => { let h = ''; try { h = new URL(wc.getURL()).hostname } catch { /* adresse illisible */ } cb(okPermA.has(perm) && assistAllowedHost(h)) })
  as.setPermissionCheckHandler((wc, perm) => okPermA.has(perm))
  as.setDisplayMediaRequestHandler(async (_r, cb) => { try { const src = await desktopCapturer.getSources({ types: ['screen'] }); cb(src[0] ? { video: src[0] } : {}) } catch { cb({}) } })
  assistWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guardA = (e, u) => { let h = ''; try { h = new URL(u).hostname } catch { /* adresse illisible */ } if (!assistAllowedHost(h) || !okAssistUrl(u)) { e.preventDefault(); report('client_navigation_blocked', { url: String(u).slice(0, 200), where: 'assistance' }) } }
  assistWin.webContents.on('will-navigate', guardA); assistWin.webContents.on('will-redirect', guardA)
  assistWin.webContents.on('before-input-event', (ev, input) => { if (input.type === 'keyDown' && /^f12$/i.test(input.key || '')) ev.preventDefault() })
  assistWin.on('closed', () => { assistWin = null; exam.lastFocus = 'main'; report('client_assist_closed', { host }); if (win && !win.isDestroyed()) { win.focus() } })
  assistWin.loadURL(url)
  report('client_assist_opened', { host })
  return { ok: true }
}
function closeAssist() { if (assistWin && !assistWin.isDestroyed()) { try { assistWin.destroy() } catch { /* déjà fermée */ } } assistWin = null }

// ── Pont avec la page CEI (uniquement depuis un site autorisé) ───────────────────────────────────────────────────────────────
const fromAllowed = e => { try { return isAllowed(e.senderFrame.url) } catch { return false } }

// ── Mise à jour automatique ──────────────────────────────────────────────────────────────────────────────────────────────
// Vérifiée au démarrage puis toutes les 30 min, JAMAIS pendant un examen. Fichier téléchargé depuis le serveur CEI, somme SHA-256 ET signature
// HMAC (secret embarqué) contrôlées avant toute exécution. Windows : installateur silencieux ; Linux AppImage : remplacement du fichier ;
// macOS : remplacement du paquet .app. Autres cas (paquet .deb…) : la page de téléchargement est proposée.
const upd = { busy: false, win: null, choice: null, manualShown: new Set() }
const updStateFile = () => path.join(app.getPath('userData'), 'update-state.json')
const readUpdState = () => { try { return JSON.parse(fs.readFileSync(updStateFile(), 'utf8')) } catch { return {} } }
const updSend = st => { if (upd.win && !upd.win.isDestroyed()) upd.win.webContents.send('upd:state', st) }
function updClose() { if (upd.win && !upd.win.isDestroyed()) { try { upd.win.destroy() } catch { /* déjà fermée */ } } upd.win = null }
function updOpen() {
  if (upd.win && !upd.win.isDestroyed()) return
  upd.win = new BrowserWindow({ width: 480, height: 270, resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, title: 'Mise à jour de CEI Examen',
    autoHideMenuBar: true, show: false, icon: path.join(__dirname, 'icon.png'), webPreferences: { nodeIntegration: true, contextIsolation: false } })
  upd.win.setMenu(null)
  upd.win.once('ready-to-show', () => upd.win && !upd.win.isDestroyed() && upd.win.show())
  upd.win.on('closed', () => { upd.win = null; if (upd.choice) { upd.choice('later'); upd.choice = null } })
  upd.win.loadFile(path.join(__dirname, 'update.html'))
}
const updWait = () => new Promise(res => { upd.choice = res })
ipcMain.on('upd:choice', (_e, c) => { if (upd.choice) { const f = upd.choice; upd.choice = null; f(String(c)) } })

async function fetchReleases() {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 10000)
  try {
    const r = await net.fetch(cfg.releasesUrl, { signal: ctl.signal, headers: { 'User-Agent': `CEIExamClient/${cfg.version}`, Accept: 'application/json' } })
    return r.ok ? await r.json() : null
  } catch { return null } finally { clearTimeout(to) }
}

async function installUpdate(sel) {
  const e = sel.entry
  const dir = path.join(app.getPath('temp'), 'cei-examen-update')
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* rien à nettoyer */ }
  const dest = path.join(dir, e.name)
  // Servi par nginx (/static/downloads/…) : ces fichiers pèsent 100 à 200 Mo et ne doivent pas occuper l'API ; repli sur le point d'accès de l'API
  const url = new URL(/^\/static\/downloads\/[A-Za-z0-9._%-]+$/.test(String(e.url || '')) ? e.url : `/api/exam-client/download/${encodeURIComponent(e.name)}`, cfg.url).toString()
  updSend({ phase: 'download', version: sel.version, pct: 0 })
  await updater.download({ fetchFn: (u, o) => net.fetch(u, { ...o, headers: { 'User-Agent': `CEIExamClient/${cfg.version}` } }), url, dest, expectedSha256: e.sha256, expectedSize: e.size,
    onProgress: p => updSend({ phase: 'download', version: sel.version, pct: p }) })
  if (exam.active) { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* rien */ } updClose(); return }      // un examen vient de commencer : on n'y touche pas
  updSend({ phase: 'install', version: sel.version })
  fs.writeFileSync(updStateFile(), JSON.stringify({ target: sel.version, at: Date.now() }))
  log('UPDATE install', sel.version, sel.mode)
  const bye = () => { allowQuit = true; setTimeout(() => app.quit(), 500) }
  if (sel.mode === 'nsis') {
    spawn('cmd.exe', ['/d', '/s', '/c', `"${updater.winRelaunchCommand(dest, process.execPath)}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref()
    return bye()
  }
  if (sel.mode === 'appimage') {
    const target = process.env.APPIMAGE
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    fs.copyFileSync(dest, target + '.new'); fs.chmodSync(target + '.new', 0o755); fs.renameSync(target + '.new', target)
    const env = { ...process.env }; for (const k of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete env[k]
    spawn('/bin/sh', ['-c', updater.linuxRelaunchCommand(target)], { detached: true, stdio: 'ignore', env }).unref()
    return bye()
  }
  if (sel.mode === 'mac-zip') {
    const bundle = path.resolve(process.execPath, '..', '..', '..')
    if (!/\.app$/.test(bundle)) throw new Error("application introuvable (installation non standard)")
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK)
    const sh = path.join(dir, 'remplacer.sh'); fs.writeFileSync(sh, updater.macReplaceScript(), { mode: 0o755 })
    spawn('/bin/sh', [sh, String(process.pid), dest, bundle], { detached: true, stdio: 'ignore' }).unref()
    return bye()
  }
  throw new Error('mode de mise à jour inconnu')
}

/** mode : 'startup' (installe tout seul), 'manual' (demandé par la page, installe tout seul), 'background' (propose, l'étudiant choisit). */
async function checkUpdate(mode) {
  if (cfg.noUpdate || (!app.isPackaged && !cfg.updateTest)) return { skipped: 'off' }
  if (exam.active) return { skipped: 'exam' }
  if (upd.busy) return { skipped: 'busy' }
  upd.busy = true
  try {
    const rel = await fetchReleases()
    if (!rel) return { skipped: 'offline' }
    const sel = updater.selectUpdate(rel, { platform: process.platform, arch: process.arch, current: cfg.version, appImage: process.env.APPIMAGE, secret: cfg.clientSecret })
    if (!sel) return { skipped: 'uptodate' }
    if (exam.active) return { skipped: 'exam' }
    const st = readUpdState()
    if (!sel.manual && st.target === sel.version && Date.now() - (st.at || 0) < 6 * 3600 * 1000) { log('UPDATE déjà tentée récemment', sel.version); return { skipped: 'recent-attempt' } }
    if (sel.manual) {                                        // plus récente, mais pas installable automatiquement ici : on prévient une fois
      if (upd.manualShown.has(sel.version)) return { skipped: 'manual-shown' }
      upd.manualShown.add(sel.version)
      updOpen(); updSend({ phase: 'manual', version: sel.version, current: cfg.version })
      if ((await updWait()) === 'open') shell.openExternal(new URL('/telecharger-client', cfg.url).toString())
      updClose(); return { manual: true }
    }
    updOpen()
    if (mode === 'background') {
      updSend({ phase: 'ask', version: sel.version, current: cfg.version })
      if ((await updWait()) !== 'install') { updClose(); return { later: true } }
    }
    await installUpdate(sel)
    return { installing: true }
  } catch (e) {
    log('UPDATE échec', e.message)
    updSend({ phase: 'error', message: String(e.message || e).slice(0, 160) }); setTimeout(updClose, 7000)
    return { error: String(e.message || e) }
  } finally { upd.busy = false }
}
ipcMain.handle('cei:update-now', e => fromAllowed(e) ? checkUpdate('manual') : { skipped: 'denied' })
ipcMain.handle('cei:update-info', e => fromAllowed(e) ? { version: cfg.version, updating: upd.busy } : null)

ipcMain.handle('cei:info', e => fromAllowed(e) ? { client: 'CEIExamClient', version: cfg.version, platform: process.platform, arch: process.arch, examMode: exam.active, vm: vmInfo.vm } : null)
// Autorisations du système (Windows 10/11 et macOS) : caméra, micro, enregistrement de l'écran (macOS). 'granted' | 'denied' | 'not-determined' | 'unknown'
const mediaAccess = () => {
  const get = k => { try { return systemPreferences.getMediaAccessStatus ? systemPreferences.getMediaAccessStatus(k) : 'unknown' } catch { return 'unknown' } }
  return { camera: get('camera'), microphone: get('microphone'), screen: get('screen') }
}
// macOS : déclenche la demande d'autorisation caméra / micro MAINTENANT (avant l'examen), pas au milieu de la composition
ipcMain.handle('cei:ask-media', async e => {
  if (!fromAllowed(e)) return null
  if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
    for (const k of ['camera', 'microphone']) { try { await systemPreferences.askForMediaAccess(k) } catch { /* refusé ou indisponible */ } }
  }
  return mediaAccess()
})
ipcMain.handle('cei:status', e => fromAllowed(e) ? { examMode: exam.active, assist: !!(assistWin && !assistWin.isDestroyed()), media: mediaAccess(), displays: screen.getAllDisplays().length, focused: !!(win && win.isFocused()), kiosk: !!(win && win.isKiosk()), shortcuts: globalOk, vm: vmInfo.vm } : null)
ipcMain.handle('cei:sign', async (e, { nonce, userId, examId } = {}) => {
  if (!fromAllowed(e) || !nonce) return null
  const msg = `${nonce}|${userId}|${cfg.version}|${process.platform}`
  const sig = crypto.createHmac('sha256', cfg.clientSecret).update(msg).digest('hex')
  const rs = await guard.detectRemoteSession()
  const pt = cfg.noPorts ? { displays: 1, usb: [] } : await guard.detectPorts(screen.getAllDisplays().length)
  return { sig, version: cfg.version, platform: process.platform, vm: vmInfo.vm, vm_hint: vmInfo.hint, remote: rs.remote, remote_hint: rs.hint, examId,
    displays: pt.displays, usb_storage: pt.usb.length }
})
ipcMain.handle('cei:apps', async e => fromAllowed(e) ? { apps: [...new Map((await guard.listWindowApps(selfIdentity())).map(a => [a.name, a])).values()].map(a => ({ name: a.name })) } : null)
ipcMain.handle('cei:apps-close', async e => {
  if (!fromAllowed(e)) return null
  const self = selfIdentity()
  const apps = await guard.listWindowApps(self)
  const left = await guard.closeApps(apps, self, { graceMs: 6000 })
  log('APPS CLOSED', apps.map(a => a.name).join(','), 'left=' + left.map(a => a.name).join(','))
  return { closed: apps.length - left.length, remaining: [...new Set(left.map(a => a.name))].map(name => ({ name })) }
})
ipcMain.handle('cei:enter', (e, opts) => fromAllowed(e) ? enterExamMode(opts) : { ok: false })
ipcMain.handle('cei:ports', async e => fromAllowed(e) ? await guard.detectPorts(screen.getAllDisplays().length) : null)
ipcMain.handle('cei:configure', (e, opts) => { if (!fromAllowed(e)) return { ok: false }; applyExamConfig(opts || {}); return { ok: true } })
ipcMain.handle('cei:assist-open', (e, url) => fromAllowed(e) ? openAssist(String(url || '')) : { ok: false })
ipcMain.handle('cei:assist-close', e => { if (!fromAllowed(e)) return { ok: false }; closeAssist(); return { ok: true } })
ipcMain.handle('cei:leave', e => fromAllowed(e) ? leaveExamMode() : { ok: false })

if (cfg.test) {                                           // uniquement pour les essais automatiques
  ipcMain.handle('cei:test-input', (_e, spec) => { win.webContents.sendInputEvent(spec); return true })
  ipcMain.handle('cei:test-blur', () => { exam.forceBlur = true; return true })
  ipcMain.handle('cei:test-quit', (_e, code) => submitQuitCode(code))
  ipcMain.handle('cei:test-close', () => { win.close(); return !!(win && !win.isDestroyed()) })
}

// ── Démarrage ───────────────────────────────────────────────────────────────────────────────────────────────────────────
app.on('second-instance', (_e, argv) => { const u = (argv || []).find(a => String(a).startsWith(PROTO + '://')); if (u) openDeepLink(u); if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('open-url', (e, u) => { e.preventDefault(); openDeepLink(u) })
app.on('before-quit', e => { if (exam.active && !allowQuit) e.preventDefault() })
app.on('session-end', () => { allowQuit = true })
app.on('window-all-closed', () => { if (!exam.active || allowQuit) app.quit() })

app.whenReady().then(async () => {
  const ses = session.defaultSession
  const okPerm = new Set(['media', 'display-capture', 'fullscreen', 'notifications', 'clipboard-sanitized-write', 'keyboardLock', 'window-management', 'speaker-selection', 'pointerLock'])
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(okPerm.has(perm) && isAllowed(wc.getURL())))
  ses.setPermissionCheckHandler((wc, perm) => okPerm.has(perm) && (!wc || isAllowed(wc.getURL())))
  // Partage d'écran demandé par la page : l'écran principal est choisi d'office (aucun sélecteur à manipuler)
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try { const s = await desktopCapturer.getSources({ types: ['screen'] }); cb(s[0] ? { video: s[0] } : {}) } catch { cb({}) }
  })
  try { app.setAsDefaultProtocolClient(PROTO) } catch { /* non fatal */ }
  guard.setExtraAllow(cfg.allowApps)
  vmInfo = await guard.detectVM()
  log('START', cfg.version, process.platform, 'vm=' + vmInfo.vm, vmInfo.hint)
  createWindow()
  if (!cfg.test) {                                         // contrôle au démarrage (avant la connexion), puis régulièrement hors examen
    // Départs étalés au hasard : 3000 étudiants ne téléchargent pas 100 Mo à la même seconde
    setTimeout(() => checkUpdate('startup'), 2500 + Math.floor(Math.random() * cfg.updateJitterMs))
    setInterval(() => checkUpdate('background'), cfg.updateEveryMs + Math.floor(Math.random() * 300000)).unref()
  }
  const first = process.argv.find(a => String(a).startsWith(PROTO + '://'))
  if (first) win.webContents.once('did-finish-load', () => openDeepLink(first))
})
