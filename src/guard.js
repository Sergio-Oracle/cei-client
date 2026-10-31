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

module.exports = { forbiddenRunning, detectVM, listProcesses, FORBIDDEN, hostname: os.hostname() }
