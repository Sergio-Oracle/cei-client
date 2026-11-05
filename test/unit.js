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
g.setExtraAllow(['WhatsApp'])
g.forbiddenRunning(['WhatsApp.exe', 'TeamViewer.exe', 'Discord.exe']).then(r => {
  t('exception d\'examen : WhatsApp toléré, Discord signalé', !r.includes('whatsapp') && r.includes('discord'))
  t('exception d\'examen : un outil de contrôle à distance n\'est JAMAIS toléré', r.includes('teamviewer'))
  g.setExtraAllow([])
  console.log(`\n${ok}/${ok + ko} vérifications réussies`)
  process.exit(ko ? 1 : 0)
})
