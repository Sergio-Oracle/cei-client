'use strict'
// Contrôles de la machine : machine virtuelle, logiciels interdits (prise de contrôle à distance, partage/enregistrement d'écran, messageries).
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')

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

/** Noms de logiciels interdits actuellement lancés (sans doublon). */
async function forbiddenRunning() {
  const names = await listProcesses()
  const found = new Set()
  for (const raw of names) {
    const n = raw.toLowerCase().replace(/\.(exe|app)$/, '')
    if (FORBIDDEN.has(n)) found.add(n)
  }
  return [...found]
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
const norm = n => String(n || '').toLowerCase().replace(/\.(exe|app)$/, '').trim()

// Composants du bureau ou d'accessibilité : jamais fermés (fermer le bureau ou un lecteur d'écran n'a aucun sens).
const SYSTEM_ALLOW = {
  win32: new Set(['explorer', 'dwm', 'csrss', 'winlogon', 'taskhostw', 'sihost', 'ctfmon', 'searchhost', 'searchui', 'searchapp', 'startmenuexperiencehost',
    'shellexperiencehost', 'textinputhost', 'lockapp', 'runtimebroker', 'securityhealthsystray', 'widgets', 'widgetservice', 'fontdrvhost', 'conhost',
    'nvda', 'jfw', 'narrator', 'magnify', 'osk', 'voiceaccess', 'systemsettingsbroker']),
  darwin: new Set(['finder', 'dock', 'systemuiserver', 'loginwindow', 'controlcenter', 'notificationcenter', 'windowserver', 'universalaccessd', 'voiceover']),
  linux: new Set(['gnome-shell', 'plasmashell', 'xfdesktop', 'xfce4-panel', 'cinnamon', 'mate-panel', 'budgie-panel', 'xorg', 'xwayland', 'kwin_x11', 'kwin_wayland',
    'mutter', 'openbox', 'ibus-ui-gtk3', 'orca', 'onboard', 'gnome-session-b', 'cinnamon-session', 'lxpanel', 'pcmanfm-desktop']),
}
let extraAllow = new Set()
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

module.exports = { forbiddenRunning, detectVM, listProcesses, listWindowApps, closeApps, setExtraAllow, parseWinApps, parseMacApps, selectApps, FORBIDDEN, hostname: os.hostname() }
