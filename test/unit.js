'use strict'
// Essais sans écran : lecture des listes d'applications de Windows et de macOS (exemples réels) et règles d'autorisation.
const g = require('../src/guard')
let ok = 0, ko = 0
const t = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ✔ ' : '  ✘ ') + n) }
const self = { pids: new Set([111]), names: new Set(['cei examen', 'electron']) }

const WIN = ['4120|Notepad', '5512|chrome', '6000|Claude', '6101|ChatGPT', '812|explorer', '900|CEI Examen', '111|CEI Examen', '7000|WINWORD', '1234|nvda', '2000|ApplicationFrameHost', '2200|msedge', ''].join('\r\n')
const w = g.selectApps(g.parseWinApps(WIN), 'win32', self).map(a => a.name)
t('Windows : Bloc-notes, Chrome, Claude, ChatGPT, Word, Edge listés', ['Notepad', 'chrome', 'Claude', 'ChatGPT', 'WINWORD', 'msedge'].every(n => w.includes(n)))
t("Windows : l'application elle-même, l'Explorateur et le lecteur d'écran NVDA épargnés", !w.includes('CEI Examen') && !w.includes('explorer') && !w.includes('nvda'))
t('Windows : hôte des applications du Store (ApplicationFrameHost) fermé', w.includes('ApplicationFrameHost'))

const MAC = ['  101 /Applications/Safari.app/Contents/MacOS/Safari', '  102 /Applications/Claude.app/Contents/MacOS/Claude', '  103 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder',
  '  104 /Applications/CEI Examen.app/Contents/MacOS/CEI Examen', '  105 /Applications/TextEdit.app/Contents/MacOS/TextEdit', '  106 /usr/libexec/syslogd', '  107 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].join('\n')
const m = g.selectApps(g.parseMacApps(MAC), 'darwin', self).map(a => a.name)
t('macOS : Safari, Claude, TextEdit, Chrome listés', ['Safari', 'Claude', 'TextEdit', 'Google Chrome'].every(n => m.includes(n)))
t("macOS : Finder, services système et l'application elle-même épargnés", !m.includes('Finder') && !m.includes('CEI Examen') && m.length === 4)

g.setExtraAllow(['Zoom'])
t('exception autorisée par la configuration (CEI_ALLOW_APPS)', !g.selectApps([{ pid: 5, name: 'Zoom' }], 'win32', self).length)
g.setExtraAllow([])
t('doublons de pid ignorés', g.selectApps([{ pid: 9, name: 'notepad' }, { pid: 9, name: 'notepad' }], 'win32', self).length === 1)
// ── 1.2.0 : outils de bureau à distance, session à distance, exceptions d'examen ──
t('outils à distance reconnus (TeamViewer, RDP, AnyDesk, VNC…) et seulement eux', JSON.stringify(g.remoteToolsIn(['TeamViewer.exe', 'notepad.exe', 'mstsc.exe', 'AnyDesk', 'rdpclip.exe', 'chrome'])) === JSON.stringify(['teamviewer', 'mstsc', 'anydesk', 'rdpclip']))
t('session Bureau à distance Windows détectée (SESSIONNAME=RDP-Tcp#3)', g.remoteFromSignals({ platform: 'win32', env: { SESSIONNAME: 'RDP-Tcp#3' } }).remote === true)
t('console locale Windows : pas de session à distance', g.remoteFromSignals({ platform: 'win32', env: { SESSIONNAME: 'Console' }, procs: ['explorer.exe'] }).remote === false)
t('Windows : rdpclip lancé = session à distance', g.remoteFromSignals({ platform: 'win32', env: {}, procs: ['rdpclip.exe'] }).remote === true)
t('macOS : partage d\'écran actif (screensharingd) = session à distance', g.remoteFromSignals({ platform: 'darwin', procs: ['screensharingd'] }).remote === true)
t('Linux : session xrdp / loginctl Remote=yes détectées', g.remoteFromSignals({ platform: 'linux', env: { XRDP_SESSION: '1' } }).remote && g.remoteFromSignals({ platform: 'linux', loginctlRemote: true }).remote)
t('Linux local : pas de session à distance', g.remoteFromSignals({ platform: 'linux', env: {}, procs: ['gnome-shell'] }).remote === false)
// ── 1.3.0 : mise à jour automatique (logique pure) ──
const u = require('../src/updater'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto')
t('versions comparées numériquement (1.10.0 > 1.9.9, 1.2 < 1.2.1)', u.cmpVersion('1.10.0', '1.9.9') === 1 && u.cmpVersion('1.2.0', '1.2.0') === 0 && u.cmpVersion('1.2', '1.2.1') === -1)
const SEC = 'secret-de-test'
const ent = (name, mode, platform, arch, sha = 'a'.repeat(64)) => ({ name, mode, platform, arch, sha256: sha, sig: u.signUpdate(SEC, '1.3.0', name, sha), size: 10 })
const rel = { version: '1.3.0', updates: [ent('CEI-Examen-1.3.0-win-setup.exe', 'nsis', 'win32', 'x64'), ent('CEI-Examen-1.3.0-linux-x86_64.AppImage', 'appimage', 'linux', 'x64'), ent('CEI-Examen-1.3.0-universal-mac.zip', 'mac-zip', 'darwin', 'universal')] }
const sel = (platform, o = {}) => u.selectUpdate(rel, { platform, arch: 'x64', current: '1.2.0', secret: SEC, ...o })
t('Windows : l\'installateur silencieux est choisi', sel('win32').mode === 'nsis' && !sel('win32').manual)
t('Windows ARM : la version 64 bits Intel-AMD (émulée) est utilisée', sel('win32', { arch: 'arm64' }).mode === 'nsis')
t('Linux lancé depuis un AppImage : remplacement du fichier', sel('linux', { appImage: '/home/x/CEI.AppImage' }).mode === 'appimage')
t('Linux installé par paquet .deb : pas de mise à jour silencieuse (page de téléchargement proposée)', sel('linux').manual === true)
t('macOS : archive universelle choisie', sel('darwin', { arch: 'arm64' }).mode === 'mac-zip')
t('déjà à jour ou plus récent que le serveur : rien à faire', sel('win32', { current: '1.3.0' }) === null && sel('win32', { current: '2.0.0' }) === null)
t('signature falsifiée : jamais installée automatiquement', u.selectUpdate({ ...rel, updates: [{ ...rel.updates[0], sha256: 'b'.repeat(64) }] }, { platform: 'win32', arch: 'x64', current: '1.2.0', secret: SEC }).manual === true)
t('mauvais secret (fichier signé par un autre) : refusé', u.selectUpdate(rel, { platform: 'win32', arch: 'x64', current: '1.2.0', secret: 'autre' }).manual === true)
t('nom de fichier dangereux (../) : refusé', u.selectUpdate({ ...rel, updates: [{ ...ent('..', 'nsis', 'win32', 'x64') }] }, { platform: 'win32', arch: 'x64', current: '1.2.0', secret: SEC }).manual === true)
const wc = u.winRelaunchCommand('C:\\Users\\Zoé\\AppData\\Local\\Temp\\cei\\setup.exe', 'C:\\Users\\Zoé\\AppData\\Local\\Programs\\CEI Examen\\CEI Examen.exe')
t('Windows : installateur /S (silencieux) puis relance de l\'application', /setup\.exe" \/S & start "" "C:.*CEI Examen\.exe"$/.test(wc))
t('macOS : le script remplace le paquet, retire la quarantaine et relance', /ditto -x -k/.test(u.macReplaceScript()) && /xattr -cr/.test(u.macReplaceScript()) && /open "\$APP"/.test(u.macReplaceScript()))
t('Linux : relance du nouvel AppImage après fermeture', u.linuxRelaunchCommand('/home/a b/CEI.AppImage') === 'sleep 2; exec "/home/a b/CEI.AppImage"')

// ── 1.4.0 : ports (écrans externes HDMI/VGA, disques USB) ──
const XR1 = 'Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\neDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm\nHDMI-1 disconnected (normal left inverted right x axis y axis)\nDP-1 disconnected\n'
const XR2 = XR1.replace('HDMI-1 disconnected', 'HDMI-1 connected 1920x1080+1920+0')
t('Linux : portable seul (eDP) = 1 écran, HDMI branché = 2 écrans', g.parseXrandr(XR1).length === 1 && g.parseXrandr(XR2).length === 2 && g.parseXrandr(XR2).find(x => x.name === 'HDMI-1') && g.parseXrandr(XR1)[0].internal)
t('Windows : un moniteur interne seul = 1 ; interne + HDMI + VGA = 3', g.parseWinMonitors('2147483648\r\n').length === 1 && g.parseWinMonitors('2147483648\r\n5\r\n0\r\n').length === 3)
t('Windows : sortie vide ou texte d\'erreur = aucun moniteur lu (jamais de blocage sur une détection impossible)', g.parseWinMonitors('').length === 0 && g.parseWinMonitors('Get-CimInstance : Invalid class').length === 0)
const MACJ = JSON.stringify({ SPDisplaysDataType: [{ spdisplays_ndrvs: [{ _name: 'Color LCD' }, { _name: 'DELL U2720Q' }] }] })
t('macOS : deux écrans listés (même en miroir) = 2 ; un seul = 1 ; sortie illisible = 0', g.parseMacDisplays(MACJ) === 2 && g.parseMacDisplays(JSON.stringify({ SPDisplaysDataType: [{ spdisplays_ndrvs: [{}] }] })) === 1 && g.parseMacDisplays('pas du json') === 0)
t('Windows : lettres des volumes d\'un disque USB', JSON.stringify(g.parseWinUsbLetters('E\r\nF\r\n\r\nE\r\n')) === JSON.stringify(['E', 'F']))
t('macOS : seuls les disques EXTERNES physiques sont retenus', JSON.stringify(g.parseMacExternalDisks('/dev/disk0 (internal, physical):\n   #: TYPE NAME\n/dev/disk2 (external, physical):\n   #: TYPE\n/dev/disk3 (synthesized):\n')) === JSON.stringify(['/dev/disk2']))
const LSB = JSON.stringify({ blockdevices: [
  { name: 'nvme0n1', path: '/dev/nvme0n1', tran: 'nvme', rm: false, hotplug: false, mountpoint: null, type: 'disk', children: [{ name: 'nvme0n1p2', path: '/dev/nvme0n1p2', mountpoint: '/', type: 'part' }] },
  { name: 'sdb', path: '/dev/sdb', tran: 'usb', rm: true, hotplug: true, mountpoint: null, type: 'disk', size: 16000000000, children: [{ name: 'sdb1', path: '/dev/sdb1', mountpoint: '/media/etu/CLE', type: 'part' }] },
  { name: 'sdc', path: '/dev/sdc', tran: 'usb', rm: true, hotplug: true, mountpoint: null, type: 'disk', size: 0 },
  { name: 'loop0', path: '/dev/loop0', tran: null, rm: false, hotplug: false, mountpoint: '/snap/core', type: 'loop' }] })
const lb = g.parseLsblk(LSB)
t('Linux : la clé USB (sdb) est détectée avec ses points de montage ; le disque interne et les snaps ne le sont pas', lb.length === 1 && lb[0].path === '/dev/sdb' && lb[0].mounts[0] === '/media/etu/CLE' && lb[0].partitions[0] === '/dev/sdb1')
t('Linux : un lecteur de cartes USB VIDE (taille 0) n\'est pas un disque branché', lb.every(d => d.path !== '/dev/sdc'))
t('Linux : aucun disque amovible = liste vide ; sortie illisible = liste vide', g.parseLsblk(JSON.stringify({ blockdevices: [] })).length === 0 && g.parseLsblk('x').length === 0)

g.setExtraAllow(['WhatsApp']);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cei-upd-')), body = Buffer.from('contenu-de-la-mise-a-jour'.repeat(1000)), sha = crypto.createHash('sha256').update(body).digest('hex')
  const mk = () => async () => new Response(new ReadableStream({ start(c) { c.enqueue(body.subarray(0, 9000)); c.enqueue(body.subarray(9000)); c.close() } }), { headers: { 'content-length': String(body.length) } })
  const prog = []
  const got = await u.download({ fetchFn: mk(), url: 'x', dest: path.join(dir, 'ok.bin'), expectedSha256: sha, onProgress: p => prog.push(p) })
  t('téléchargement : somme contrôlée, progression de 0 à 100 %', got === sha && fs.readFileSync(path.join(dir, 'ok.bin')).equals(body) && prog.length >= 2 && prog[prog.length - 1] === 1)
  let refused = false; try { await u.download({ fetchFn: mk(), url: 'x', dest: path.join(dir, 'bad.bin'), expectedSha256: 'c'.repeat(64) }) } catch { refused = true }
  t('fichier dont la somme ne correspond pas : refusé ET effacé', refused && !fs.existsSync(path.join(dir, 'bad.bin')))
  let http = false; try { await u.download({ fetchFn: async () => new Response('non', { status: 404 }), url: 'x', dest: path.join(dir, 'x.bin') }) } catch { http = true }
  t('réponse du serveur en erreur : mise à jour abandonnée', http)
  fs.rmSync(dir, { recursive: true, force: true })
})().then(() => g.forbiddenRunning(['WhatsApp.exe', 'TeamViewer.exe', 'Discord.exe']).then(r => {
  t('exception d\'examen : WhatsApp toléré, Discord signalé', !r.includes('whatsapp') && r.includes('discord'))
  t('exception d\'examen : un outil de contrôle à distance n\'est JAMAIS toléré', r.includes('teamviewer'))
  g.setExtraAllow([])
  console.log(`\n${ok}/${ok + ko} vérifications réussies`)
  process.exit(ko ? 1 : 0)
}))
