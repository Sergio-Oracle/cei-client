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
 *   • sortie d'urgence uniquement par un code donné par le surveillant.
 * Limite assumée : aucune application ne peut intercepter Ctrl+Alt+Suppr ni la coupure de courant ; tout ce qui peut être fait
 * est fait, et le reste est détecté et tracé côté serveur.
 */
const { app, BrowserWindow, session, globalShortcut, screen, clipboard, ipcMain, Menu, desktopCapturer, systemPreferences } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const cfg = require('./config')
const guard = require('./guard')

app.userAgentFallback = `${app.userAgentFallback} CEIExamClient/${cfg.version}`
if (process.env.CEI_USERDATA) app.setPath('userData', process.env.CEI_USERDATA)      // essais : profil jetable
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
const exam = { active: false, since: 0, maxTimer: null, blurAt: 0, lastShortcutAt: 0, forbiddenSeen: new Map(), quitTries: 0 }

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
    autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
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
    || ['f5', 'f11', 'f1', 'f3', 'f6', 'f7', 'f10'].includes(k)
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

function startWatchers() {
  const every = (ms, fn) => timers.push(setInterval(() => { try { fn() } catch (e) { log('ERR watcher', e.message) } }, ms))
  every(400, () => {                                         // reprise du premier plan
    if (!exam.active || !win || win.isDestroyed()) return
    if (!win.isFocused() || exam.forceBlur) {
      exam.forceBlur = false
      const now = Date.now()
      if (now - exam.blurAt > 2500) { exam.blurAt = now; report('window_blur', { via: 'client' }) }
      win.show(); win.focus(); win.moveTop(); win.setAlwaysOnTop(true, 'screen-saver')
    }
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
  every(cfg.scanMs, async () => {
    if (!exam.active) return
    for (const name of await guard.forbiddenRunning()) {
      const last = exam.forbiddenSeen.get(name) || 0
      if (Date.now() - last > 5 * 60 * 1000) { exam.forbiddenSeen.set(name, Date.now()); report('client_forbidden_app', { name }) }
    }
  })
}
app.whenReady().then(() => {
  screen.on('display-added', coverOtherDisplays)
  screen.on('display-removed', coverOtherDisplays)
  screen.on('display-metrics-changed', coverOtherDisplays)
})

function enterExamMode({ maxMinutes = 240 } = {}) {
  if (exam.active || !win) return { ok: true, already: true }
  exam.active = true; exam.since = Date.now(); exam.forbiddenSeen.clear()
  try { win.setKiosk(true) } catch { win.setFullScreen(true) }
  const tryDo = fn => { try { fn() } catch { /* option non disponible sur ce système */ } }
  tryDo(() => win.setAlwaysOnTop(true, 'screen-saver'))
  tryDo(() => win.setContentProtection(true))             // capture / enregistrement d'écran : fenêtre noire
  tryDo(() => win.setMinimizable(false)); tryDo(() => win.setResizable(false)); tryDo(() => win.setMovable(false)); tryDo(() => win.setClosable(false))
  win.focus(); clipboard.clear()
  registerGlobalShortcuts(); startWatchers(); coverOtherDisplays()
  clearTimeout(exam.maxTimer)
  exam.maxTimer = setTimeout(() => { report('client_exam_mode_timeout'); leaveExamMode() }, (Math.max(5, Math.min(600, maxMinutes)) + 15) * 60000)   // jamais d'élève prisonnier
  log('EXAM ON')
  return { ok: true, shortcuts: globalOk }
}

function leaveExamMode() {
  if (!exam.active) return { ok: true }
  exam.active = false
  clearTimeout(exam.maxTimer)
  timers.splice(0).forEach(clearInterval)
  try { globalShortcut.unregisterAll() } catch { /* rien */ }
  covers.splice(0).forEach(w => { try { w.destroy() } catch { /* rien */ } })
  if (win && !win.isDestroyed()) {
    const tryDo = fn => { try { fn() } catch { /* rien */ } }
    tryDo(() => win.setKiosk(false)); tryDo(() => win.setAlwaysOnTop(false)); tryDo(() => win.setContentProtection(false))
    tryDo(() => win.setMinimizable(true)); tryDo(() => win.setResizable(true)); tryDo(() => win.setMovable(true)); tryDo(() => win.setClosable(true))
  }
  log('EXAM OFF')
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
ipcMain.handle('cei:quit-code', (_e, code) => {
  if (!cfg.quitHash) return { ok: false, message: "Aucun code de sortie n'est configuré sur ce poste." }
  exam.quitTries += 1
  const ok = crypto.createHash('sha256').update(String(code || '')).digest('hex') === cfg.quitHash
  if (!ok) { report('client_quit_code_failed', { tries: exam.quitTries }); return { ok: false, message: exam.quitTries >= 3 ? 'Code incorrect — le surveillant est prévenu.' : 'Code incorrect' } }
  report('client_quit_code_used'); allowQuit = true; leaveExamMode(); setTimeout(() => app.quit(), 300)
  return { ok: true }
})

// ── Pont avec la page CEI (uniquement depuis un site autorisé) ───────────────────────────────────────────────────────────────
const fromAllowed = e => { try { return isAllowed(e.senderFrame.url) } catch { return false } }
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
ipcMain.handle('cei:status', e => fromAllowed(e) ? { examMode: exam.active, media: mediaAccess(), displays: screen.getAllDisplays().length, focused: !!(win && win.isFocused()), kiosk: !!(win && win.isKiosk()), shortcuts: globalOk, vm: vmInfo.vm } : null)
ipcMain.handle('cei:sign', (e, { nonce, userId, examId } = {}) => {
  if (!fromAllowed(e) || !nonce) return null
  const msg = `${nonce}|${userId}|${cfg.version}|${process.platform}`
  const sig = crypto.createHmac('sha256', cfg.clientSecret).update(msg).digest('hex')
  return { sig, version: cfg.version, platform: process.platform, vm: vmInfo.vm, vm_hint: vmInfo.hint, examId }
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
ipcMain.handle('cei:leave', e => fromAllowed(e) ? leaveExamMode() : { ok: false })

if (cfg.test) {                                           // uniquement pour les essais automatiques
  ipcMain.handle('cei:test-input', (_e, spec) => { win.webContents.sendInputEvent(spec); return true })
  ipcMain.handle('cei:test-blur', () => { exam.forceBlur = true; return true })
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
  const first = process.argv.find(a => String(a).startsWith(PROTO + '://'))
  if (first) win.webContents.once('did-finish-load', () => openDeepLink(first))
})
