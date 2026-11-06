'use strict'
// Contrôles de la machine : machine virtuelle, logiciels interdits (prise de contrôle à distance, partage/enregistrement d'écran, messageries).
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')

const norm = n => String(n || '').toLowerCase().replace(/\.(exe|app)$/, '').trim()
let extraAllow = new Set()           // applications épargnées pour CET examen (réglage de l'examen + CEI_ALLOW_APPS)

const FORBIDDEN = new Set([
  // prise de contrôle à distance
  'teamviewer', 'teamviewer_service', 'tv_w32', 'tv_x64', 'anydesk', 'rustdesk', 'ultraviewer', 'ultraviewer_desktop', 'supremo', 'supremoservice',
  'parsec', 'parsecd', 'vncviewer', 'vncserver', 'winvnc', 'tvnserver', 'tightvnc', 'radmin', 'rutserv', 'logmein', 'lmiguardiansvc',
  'splashtop', 'srservice', 'remoting_host', 'remotepc', 'screenconnect.clientservice', 'chromoting', 'x11vnc', 'vino-server',
  // visioconférence / messageries (partage d'écran, aide extérieure)
  'zoom', 'zoom.us', 'skype', 'skypeapp', 'teams', 'ms-teams', 'discord', 'slack', 'telegram', 'whatsapp', 'signal', 'webex', 'anydesk-service',
  // enregistrement / capture d'écran
  'obs', 'obs64', 'obs32', 'obs-studio', 'streamlabs', 'bandicam', 'camtasia', 'camtasiastudio', 'sharex', 'snagit32', 'snagiteditor', 'loom',
  'screenrec', 'snippingtool', 'screenclippinghost', 'kazam', 'simplescreenrecorder', 'peek', 'flameshot', 'spectacle', 'gnome-screenshot',
  // virtualisation hôte
  'vmware', 'vmware-vmx', 'vmplayer', 'virtualbox', 'virtualboxvm', 'vboxsvc', 'qemu-system-x86_64', 'prl_client_app',
])

// Outils de PRISE DE CONTRÔLE / de BUREAU À DISTANCE : non seulement signalés, mais arrêtés dès qu'ils sont détectés pendant l'examen
// (un service en arrière-plan n'a pas de fenêtre : le nettoyage des fenêtres ne le verrait pas).
const REMOTE_TOOLS = new Set([
  'teamviewer', 'teamviewer_service', 'tv_w32', 'tv_x64', 'teamviewerd', 'anydesk', 'rustdesk', 'ultraviewer', 'ultraviewer_desktop', 'supremo', 'supremoservice',
  'parsec', 'parsecd', 'vncviewer', 'vncserver', 'winvnc', 'tvnserver', 'tightvnc', 'ultravnc', 'uvnc_service', 'radmin', 'rutserv', 'rfusclient', 'logmein', 'lmiguardiansvc',
  'splashtop', 'srservice', 'remoting_host', 'remotepc', 'screenconnect.clientservice', 'screenconnect.windowsclient', 'connectwisecontrol.client',
  'chromoting', 'chrome-remote-desktop-host', 'remoting_desktop', 'x11vnc', 'vino-server', 'krfb', 'xrdp', 'xrdp-sesman', 'x2goagent', 'nxserver', 'nxplayer', 'nxclient',
  'gotomypc', 'g2mcomm', 'g2mlauncher', 'zohoassist', 'getscreen', 'aa_v3', 'ammyyadmin', 'dwrcs', 'bomgar-scc', 'beyondtrust', 'mstsc', 'rdpclip', 'msra', 'quickassist',
  'remoteassistance', 'microsoft remote desktop', 'screensharingd', 'ardagent', 'remotemanagementd', 'sunshine', 'moonlight', 'steamstreaming',
])

function run(cmd, args, timeout = 6000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout || '')))
  })
}

async function listProcesses() {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FO', 'CSV', '/NH'])
    return out.split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean)
  }
  const out = await run('ps', ['-A', '-o', 'comm='])
  return out.split('\n').map(l => l.trim().split('/').pop()).filter(Boolean)
}

/** Noms de logiciels interdits actuellement lancés (sans doublon), hors exceptions autorisées pour cet examen (`setExtraAllow`). */
async function forbiddenRunning(procs) {
  const names = procs || await listProcesses()
  const found = new Set()
  for (const raw of names) {
    const n = raw.toLowerCase().replace(/\.(exe|app)$/, '')
    if ((FORBIDDEN.has(n) && !extraAllow.has(n)) || REMOTE_TOOLS.has(n)) found.add(n)   // un outil de contrôle à distance n'est jamais épargné
  }
  return [...found]
}

/** Parmi des noms de processus, ceux qui sont des outils de bureau / contrôle à distance (jamais épargnés, même par une exception d'examen). */
function remoteToolsIn(names) {
  const out = new Set()
  for (const raw of names || []) { const n = norm(raw); if (REMOTE_TOOLS.has(n)) out.add(n) }
  return [...out]
}

/** Arrête les outils de contrôle à distance (processus de l'utilisateur ; un service protégé ne s'arrête pas : il reste signalé). Retourne ce qui tourne encore. */
async function killRemoteTools(names) {
  for (const n of names) {
    if (process.platform === 'win32') await run('taskkill', ['/F', '/T', '/IM', n.replace(/[^\w .-]/g, '') + '.exe'], 5000)
    else await run('pkill', ['-9', '-x', n.replace(/[^\w .-]/g, '')], 4000)
  }
  await new Promise(r => setTimeout(r, 600))
  return remoteToolsIn(await listProcesses())
}

/** Décision pure (testée) : cet ordinateur est-il utilisé À DISTANCE (l'examen se déroulerait sur une autre machine, vue ou pilotée de loin) ? */
function remoteFromSignals({ platform, env = {}, procs = [], loginctlRemote = false }) {
  const names = new Set(procs.map(norm))
  if (platform === 'win32') {
    if (/^rdp-/i.test(env.SESSIONNAME || '')) return { remote: true, hint: 'session Bureau à distance Windows (' + env.SESSIONNAME + ')' }
    if (names.has('rdpclip')) return { remote: true, hint: 'session Bureau à distance Windows (rdpclip)' }
  } else if (platform === 'darwin') {
    if (names.has('screensharingd')) return { remote: true, hint: 'partage d\'écran macOS actif' }
  } else {
    if (env.XRDP_SESSION) return { remote: true, hint: 'session xrdp' }
    if (loginctlRemote) return { remote: true, hint: 'session de bureau distante (loginctl)' }
  }
  return { remote: false, hint: '' }
}

async function detectRemoteSession() {
  try {
    const procs = await listProcesses()
    let loginctlRemote = false
    if (process.platform === 'linux') {
      const out = await run('loginctl', ['show-session', process.env.XDG_SESSION_ID || 'self', '-p', 'Remote'], 3000)
      loginctlRemote = /Remote=yes/.test(out)
    }
    return remoteFromSignals({ platform: process.platform, env: process.env, procs, loginctlRemote })
  } catch { return { remote: false, hint: '' } }
}

const VM_RE = /vmware|virtualbox|vbox|qemu|kvm|hyper-v|xen|parallels|bochs|bhyve|innotek|virtual machine|microsoft corporation virtual/i

/** Machine virtuelle ? Indices matériels propres à chaque système (jamais bloquant seul : signalé au serveur). */
async function detectVM() {
  try {
    if (process.platform === 'linux') {
      const read = f => { try { return fs.readFileSync(f, 'utf8').trim() } catch { return '' } }
      const hint = [read('/sys/class/dmi/id/product_name'), read('/sys/class/dmi/id/sys_vendor'), read('/sys/class/dmi/id/board_vendor')].join(' ')
      const cpuinfo = read('/proc/cpuinfo')
      if (VM_RE.test(hint)) return { vm: true, hint: hint.trim() }
      if (/\bhypervisor\b/.test(cpuinfo.split('\n').find(l => l.startsWith('flags')) || '')) return { vm: true, hint: 'drapeau hypervisor' }
      return { vm: false, hint: '' }
    }
    if (process.platform === 'win32') {
      const out = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ForEach-Object { $_.Manufacturer + " " + $_.Model })'])
      return { vm: VM_RE.test(out), hint: out.trim() }
    }
    if (process.platform === 'darwin') {
      const out = await run('sysctl', ['-n', 'kern.hv_vmm_present'])
      const model = await run('sysctl', ['-n', 'hw.model'])
      return { vm: out.trim() === '1' || VM_RE.test(model), hint: model.trim() }
    }
  } catch { /* indice indisponible : on ne bloque personne */ }
  return { vm: false, hint: '' }
}

// ── Applications ouvertes (toutes celles qui ont une fenêtre) ────────────────────────────────────────────────────────────
// Principe : pendant l'examen, SEULE l'application CEI Examen (et le bureau du système) a le droit d'avoir une fenêtre.
// Tout le reste — bloc-notes, Claude, ChatGPT, navigateurs (donc aussi un chatbot ouvert dans un onglet), Word, Discord… — est fermé.
// Composants du bureau ou d'accessibilité : jamais fermés (fermer le bureau ou un lecteur d'écran n'a aucun sens).
const SYSTEM_ALLOW = {
  win32: new Set(['explorer', 'dwm', 'csrss', 'winlogon', 'taskhostw', 'sihost', 'ctfmon', 'searchhost', 'searchui', 'searchapp', 'startmenuexperiencehost',
    'shellexperiencehost', 'textinputhost', 'lockapp', 'runtimebroker', 'securityhealthsystray', 'widgets', 'widgetservice', 'fontdrvhost', 'conhost',
    'nvda', 'jfw', 'narrator', 'magnify', 'osk', 'voiceaccess', 'systemsettingsbroker']),
  darwin: new Set(['finder', 'dock', 'systemuiserver', 'loginwindow', 'controlcenter', 'notificationcenter', 'windowserver', 'universalaccessd', 'voiceover']),
  linux: new Set(['gnome-shell', 'plasmashell', 'xfdesktop', 'xfce4-panel', 'cinnamon', 'mate-panel', 'budgie-panel', 'xorg', 'xwayland', 'kwin_x11', 'kwin_wayland',
    'mutter', 'openbox', 'ibus-ui-gtk3', 'orca', 'onboard', 'gnome-session-b', 'cinnamon-session', 'lxpanel', 'pcmanfm-desktop']),
}
function setExtraAllow(list) { extraAllow = new Set((list || []).map(norm)) }

/** Sorties brutes des commandes système → [{ pid, name }] (fonctions pures, testées avec des exemples réels de Windows et macOS). */
function parseWinApps(txt) {
  return String(txt || '').split(/\r?\n/).map(l => l.trim().split('|')).filter(x => x.length >= 2 && x[1]).map(([pid, name]) => ({ pid: parseInt(pid, 10), name }))
}
function parseMacApps(txt) {
  const out = []
  for (const l of String(txt || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(.+?\.app)\/Contents\/MacOS\/[^/]+$/)       // applications lancées depuis un paquet .app
    if (m && !m[2].startsWith('/System/')) out.push({ pid: parseInt(m[1], 10), name: m[2].split('/').pop() })
  }
  return out
}

/** Filtre : retire l'application elle-même, le bureau du système et les exceptions autorisées. Dédoublonne par pid / identifiant de fenêtre. */
function selectApps(raw, platform, self) {
  const allow = SYSTEM_ALLOW[platform] || new Set()
  const out = []
  for (const r of raw) {
    const n = norm(r.name)
    if (!(r.pid || r.xid) || !n || self.pids.has(r.pid) || allow.has(n) || extraAllow.has(n) || self.names.has(n)) continue
    if (out.some(o => (r.pid && o.pid === r.pid) || (r.xid && o.xid === r.xid))) continue
    out.push({ pid: r.pid || 0, xid: r.xid || null, name: String(r.name).replace(/\.(exe|app)$/i, '') })
  }
  return out
}

/** Applications avec fenêtre à fermer : [{ pid, xid, name }]. `self` = { pids:Set, names:Set } de l'application CEI Examen. */
async function listWindowApps(self) {
  const raw = []
  if (process.platform === 'win32') {
    raw.push(...parseWinApps(await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id.ToString() + '|' + $_.ProcessName }"], 12000)))
  } else if (process.platform === 'darwin') {
    raw.push(...parseMacApps(await run('ps', ['-axo', 'pid=,comm='])))
  } else {
    // Linux : wmctrl (bureau avec gestionnaire de fenêtres) ; à défaut, les fenêtres de premier niveau lues par xwininfo/xprop.
    const wins = []
    const wm = await run('wmctrl', ['-lp'])
    for (const l of wm.split('\n')) { const m = l.trim().match(/^(0x[0-9a-f]+)\s+-?\d+\s+(\d+)\s/); if (m) wins.push({ xid: m[1], pid: parseInt(m[2], 10) || 0 }) }
    if (!wins.length) {
      const tree = await run('xwininfo', ['-root', '-children'])
      for (const m of tree.matchAll(/^\s*(0x[0-9a-f]+)\s+(?:"[^"]*"|\(has no name\)):\s*\(("[^"]*")\s+"[^"]*"\)/gm)) wins.push({ xid: m[1], pid: 0, cls: m[2].replace(/"/g, '') })
    }
    for (const w of wins.slice(0, 80)) {
      if (!w.pid) { const pr = await run('xprop', ['-id', w.xid, '_NET_WM_PID'], 3000); w.pid = parseInt((pr.match(/=\s*(\d+)/) || [])[1], 10) || 0 }
      let name = ''
      if (w.pid) { try { name = fs.readFileSync(`/proc/${w.pid}/comm`, 'utf8').trim() } catch { /* terminé */ } }
      if (!name) name = w.cls || ((await run('xprop', ['-id', w.xid, 'WM_CLASS'], 3000)).match(/=\s*"([^"]+)"/) || [])[1] || ''
      if (name) raw.push({ pid: w.pid, xid: w.xid, name })
    }
  }
  return selectApps(raw, process.platform, self)
}

/** Ferme les applications : d'abord poliment (elles peuvent proposer d'enregistrer), puis de force après `graceMs`. Retourne ce qui reste ouvert. */
async function closeApps(apps, self, { graceMs = 6000, force = false } = {}) {
  const win = process.platform === 'win32'
  const polite = a => {
    if (win) return run('taskkill', ['/PID', String(a.pid)], 5000)
    if (a.pid) { try { process.kill(a.pid, 'SIGTERM') } catch { /* déjà fermée */ } } else return run('xkill', ['-id', a.xid], 4000)
  }
  const hard = a => win ? run('taskkill', ['/F', '/T', '/PID', String(a.pid)], 5000)
    : (a.pid ? (() => { try { process.kill(a.pid, 'SIGKILL') } catch { /* déjà fermée */ } })() : run('xkill', ['-id', a.xid], 4000))
  if (win) await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { $_.Quit() }'], 6000)   // fenêtres de l'Explorateur de fichiers
  if (!force) { await Promise.all(apps.map(polite)); await new Promise(r => setTimeout(r, graceMs)) }
  let left = (await listWindowApps(self)).filter(x => apps.some(a => (a.pid && a.pid === x.pid) || norm(a.name) === norm(x.name)))
  if (left.length) { await Promise.all(left.map(hard)); await new Promise(r => setTimeout(r, 800)); left = (await listWindowApps(self)).filter(x => apps.some(a => norm(a.name) === norm(x.name))) }
  return left
}

// ── Ports : sorties vidéo externes (HDMI, VGA, DisplayPort, projection sans fil) et stockage USB ────────────────────────────────
// Une application ne peut pas désactiver un port matériel sans droits d'administrateur ; elle peut en revanche (1) détecter ce qui y est branché,
// (2) refuser de démarrer l'examen tant que c'est branché, (3) corriger elle-même ce que le système permet à un simple utilisateur :
// éjecter un disque USB, couper une sortie vidéo externe (Windows, Linux), recouvrir l'écran supplémentaire (tous systèmes).
// Les analyseurs ci-dessous sont PURS (testés avec des sorties réelles de chaque système).

/** Windows : un nombre par moniteur ACTIF (WmiMonitorConnectionParams.VideoOutputTechnology : 0 VGA, 4 DVI, 5 HDMI, 10 DisplayPort, 15 Miracast, 6/11/13 ou 2147483648 = écran interne). */
function parseWinMonitors(txt) {
  return String(txt || '').split(/\r?\n/).map(l => l.trim()).filter(l => /^-?\d+$/.test(l)).map(Number)
}
/** Linux : sorties xrandr connectées → [{ name, primary, internal }]. */
function parseXrandr(txt) {
  const out = []
  for (const l of String(txt || '').split('\n')) {
    const m = l.match(/^(\S+) connected( primary)?/)
    if (m) out.push({ name: m[1], primary: !!m[2], internal: /^(eDP|LVDS|DSI)/i.test(m[1]) })
  }
  return out
}
/** macOS : nombre d'écrans listés par `system_profiler SPDisplaysDataType -json` (en miroir, chaque écran reste listé). */
function parseMacDisplays(txt) {
  try {
    const j = JSON.parse(txt)
    return (j.SPDisplaysDataType || []).reduce((n, g) => n + ((g.spdisplays_ndrvs || []).length), 0)
  } catch { return 0 }
}
/** Windows : lettres des volumes portés par un disque USB. */
function parseWinUsbLetters(txt) {
  return [...new Set(String(txt || '').split(/\r?\n/).map(l => l.trim().toUpperCase()).filter(l => /^[A-Z]$/.test(l)))]
}
/** macOS : disques externes physiques (`diskutil list external physical`). */
function parseMacExternalDisks(txt) {
  return [...String(txt || '').matchAll(/^(\/dev\/disk\d+)\s+\(external, physical\)/gm)].map(m => m[1])
}
/** Linux : disques USB / amovibles branchés (lsblk -J) → [{ path, mounts: [points de montage], partitions: [chemins montés] }]. */
function parseLsblk(txt) {
  let j; try { j = JSON.parse(txt) } catch { return [] }
  const out = []
  for (const d of j.blockdevices || []) {
    if (d.type !== 'disk') continue
    const usb = String(d.tran || '').toLowerCase() === 'usb' || d.rm === true || d.hotplug === true
    if (!usb || !Number(d.size)) continue                       // un lecteur de cartes VIDE (taille 0) n'est pas un disque branché
    const parts = [d, ...(d.children || [])].filter(x => x.mountpoint)
    out.push({ path: d.path || '/dev/' + d.name, mounts: parts.map(x => x.mountpoint), partitions: parts.map(x => x.path || '/dev/' + x.name) })
  }
  return out
}

/** Ce qui est branché maintenant : { displays (nombre d'écrans actifs vus par le système), displayNames, usb: [{ id, label }] }. `electronDisplays` : nombre vu par Electron. */
async function detectPorts(electronDisplays = 1) {
  let displays = electronDisplays, names = [], usb = []
  try {
    if (process.platform === 'win32') {
      const mon = parseWinMonitors(await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams | Where-Object { $_.Active } | ForEach-Object { [string]$_.VideoOutputTechnology }"], 12000))
      displays = Math.max(electronDisplays, mon.length)
      names = mon.map(n => ({ 0: 'VGA', 4: 'DVI', 5: 'HDMI', 10: 'DisplayPort', 15: 'projection sans fil' }[n] || (n === 6 || n === 11 || n === 13 || n === 2147483648 ? 'écran intégré' : 'sortie vidéo')))
      const letters = parseWinUsbLetters(await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-Disk | Where-Object { $_.BusType -eq 'USB' } | Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { [string]$_.DriveLetter }"], 12000))
      usb = letters.map(l => ({ id: l, label: `lecteur ${l}:` }))
    } else if (process.platform === 'darwin') {
      displays = Math.max(electronDisplays, parseMacDisplays(await run('system_profiler', ['SPDisplaysDataType', '-json'], 15000)))
      usb = parseMacExternalDisks(await run('diskutil', ['list', 'external', 'physical'])).map(d => ({ id: d, label: d }))
    } else {
      const xr = parseXrandr(await run('xrandr', ['--query']))
      displays = Math.max(electronDisplays, xr.length); names = xr.map(x => x.name)
      usb = parseLsblk(await run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,TRAN,RM,HOTPLUG,MOUNTPOINT,TYPE,SIZE'])).map(d => ({ id: d.path, label: d.path, mounts: d.mounts, partitions: d.partitions }))
    }
  } catch { /* commande indisponible : on ne bloque personne sur une détection impossible */ }
  return { displays, displayNames: names, usb }
}

/** Corrige ce que le système permet à un simple utilisateur : éjecte les disques USB, coupe les sorties vidéo externes (Windows, Linux). Retourne ce qui a été fait. */
async function enforcePorts(ports, { eject = true, displaysOff = true } = {}) {
  const done = { ejected: [], displaysOff: [] }
  if (eject) {
    for (const u of ports.usb || []) {
      let ok = false
      if (process.platform === 'win32' && /^[A-Z]$/.test(u.id)) {
        await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -comObject Shell.Application).NameSpace(17).ParseName('${u.id}:').InvokeVerb('Eject')`], 12000); ok = true
      } else if (process.platform === 'darwin' && /^\/dev\/disk\d+$/.test(u.id)) {
        await run('diskutil', ['eject', u.id], 15000); ok = true
      } else if (process.platform === 'linux' && /^\/dev\/[\w/-]+$/.test(String(u.id))) {
        for (const part of u.partitions || []) if (/^\/dev\/[\w/-]+$/.test(part)) await run('udisksctl', ['unmount', '-b', part], 8000)
        await run('udisksctl', ['power-off', '-b', u.id], 8000); ok = true
      }
      if (ok) done.ejected.push(u.label)
    }
  }
  if (displaysOff && (ports.displays || 0) > 1) {
    if (process.platform === 'win32') { await run('DisplaySwitch.exe', ['/internal'], 8000); done.displaysOff.push('écran seul (DisplaySwitch /internal)') }
    else if (process.platform === 'linux') {
      const xr = parseXrandr(await run('xrandr', ['--query']))
      const keep = xr.find(x => x.primary) || xr.find(x => x.internal) || xr[0]
      for (const x of xr) if (keep && x.name !== keep.name && /^[\w.-]+$/.test(x.name)) { await run('xrandr', ['--output', x.name, '--off'], 6000); done.displaysOff.push(x.name) }
    }
  }
  return done
}

module.exports = {
  parseWinMonitors, parseXrandr, parseMacDisplays, parseWinUsbLetters, parseMacExternalDisks, parseLsblk, detectPorts, enforcePorts, forbiddenRunning, remoteToolsIn, killRemoteTools, remoteFromSignals, detectRemoteSession, REMOTE_TOOLS, detectVM, listProcesses, listWindowApps, closeApps, setExtraAllow, parseWinApps, parseMacApps, selectApps, FORBIDDEN, hostname: os.hostname() }
