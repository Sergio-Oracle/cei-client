'use strict'
// Essais sans écran : lecture des listes d'applications de Windows et de macOS (exemples réels) et règles d'autorisation.
const g = require('../src/guard')
let ok = 0, ko = 0
let asyncChecks = Promise.resolve()
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
// ── 1.4.1 : messageries et visio laissées en arrière-plan = arrêtées, pas seulement signalées ──
t('Teams, Zoom, Discord… sont des applications de fond arrêtées par le client', ['zoom', 'ms-teams', 'teams', 'discord', 'slack', 'skype', 'webex', 'whatsapp'].every(n => g.BACKGROUND_APPS.has(n)))
t('une application de fond est aussi une application interdite (signalée)', [...g.BACKGROUND_APPS].every(n => g.FORBIDDEN.has(n) || n === 'msteams'))
t("les outils à distance et les machines virtuelles ne sont PAS des applications de fond (comportement inchangé)", !g.BACKGROUND_APPS.has('anydesk') && !g.BACKGROUND_APPS.has('vmware'))
g.setExtraAllow(['zoom'])
const bgRun = g.forbiddenRunning(['Zoom.exe', 'ms-teams.exe', 'notepad.exe'])      // le calcul est synchrone (liste fournie) : l'exception est relue tout de suite
g.setExtraAllow([])
bgRun.then(r => t("exception d'examen : Zoom autorisé n'est plus signalé, Teams l'est encore", JSON.stringify(r) === JSON.stringify(['ms-teams'])))
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
  
// 1.5.0 : les services du système (session 0, fenêtre cachée sans titre) ne sont plus listés à fermer (« IdeaShareService », 14/11/2026)
t('Windows : la liste ne retient que les fenêtres visibles (avec titre) de la session de l\'étudiant', /MainWindowTitle -ne ''/.test(g.WIN_APPS_PS) && /SessionId -eq \$s/.test(g.WIN_APPS_PS) && /MainWindowHandle -ne 0/.test(g.WIN_APPS_PS))
t('Windows : un processus nommé comme un service mais sans fenêtre visible n\'est pas dans la liste produite', !g.selectApps(g.parseWinApps(['4120|Notepad']), 'win32', self).some(a => a.name === 'IdeaShareService'))
{
  const { execFileSync } = require('child_process')
  const mode = e => execFileSync(process.execPath, ['-e', "process.env.CEI_SHARE=process.argv[1];console.log(require('./src/config').shareMode)", e], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' }).trim()
  t('partage : « écran » par défaut, « page » seulement si demandé (CEI_SHARE=page)', mode('') === 'screen' && mode('page') === 'page' && mode('autre') === 'screen')
}

// 1.6.0 : TOUT logiciel interdit est arrêté ; les services résistants sont arrêtés avec les droits d'administrateur (fenêtre d'autorisation Windows)
{
  const sc = g.winStopScript(['TeamViewer_Service.exe', 'AnyDesk', "x';Remove-Item C:\\ -Recurse;'", 'a b', '$(calc)'])
  t('arrêt administrateur : script limité aux noms sûrs (TeamViewer_Service, AnyDesk), aucune injection', /@\('teamviewer_service','anydesk'\)/.test(sc) && !/Remove-Item|calc|a b/.test(sc))
  t('arrêt administrateur : les SERVICES sont arrêtés avant les processus (sinon relancés)', sc.indexOf('Stop-Service') > 0 && sc.indexOf('Stop-Service') < sc.indexOf('Stop-Process'))
  t('arrêt administrateur : aucun nom valide => script vide (rien n\'est lancé)', g.winStopScript(['', '$(x)', null]) === '')
  g.setExtraAllow([])
  asyncChecks = Promise.all([
    g.forbiddenRunning(['TeamViewer_Service.exe', 'AnyDesk.exe', 'SnippingTool.exe', 'ScreenSketch.exe', 'notepad.exe', 'obs64.exe']).then(f => {
      t('détectés : TeamViewer (service), AnyDesk, outil de capture (ancien et nouveau), OBS ; pas le Bloc-notes', ['teamviewer_service', 'anydesk', 'snippingtool', 'screensketch', 'obs64'].every(n => f.includes(n)) && !f.includes('notepad'))
    }),
    g.stopForbidden([]).then(r => t('rien à arrêter : aucun processus touché', Array.isArray(r) && r.length === 0)),
  ])
}

// 1.6.0 : « Préparation du poste » (administrateur, une fois) — l'application arrête SEULE les logiciels interdits, sans fenêtre d'autorisation
{
  const fs = require('fs'), path = require('path')
  const stop = fs.readFileSync(path.join(__dirname, '..', 'src', 'helper', 'cei-stop.ps1'), 'utf8')
  const prep = g.buildHelperScript('install')
  t('aide : seuls les noms présents AUSSI dans la liste fixe forbidden.txt sont arrêtés', /\$allow -contains \$_/.test(stop) && /forbidden\.txt/.test(stop))
  t('aide : aucun nom n\'est jamais exécuté comme commande (ni Invoke-Expression, ni iex, ni Start-Process)', !/Invoke-Expression|\biex\b|Start-Process|Invoke-Command/i.test(stop))
  t('aide : noms assainis (lettres, chiffres, point, tiret, 60 caractères au plus)', /\^\[\\w\.\\-\]\{1,60\}\$/.test(stop))
  t('aide : les services sont arrêtés avant les processus', stop.indexOf('Stop-Service') > 0 && stop.indexOf('Stop-Service') < stop.indexOf('Stop-Process'))
  t('préparation : tâche SYSTEM, un utilisateur peut la LANCER (GRGX) mais ni la modifier ni la supprimer', /SYSTEM/.test(prep) && /\(A;;GRGX;;;AU\)/.test(prep) && !/\(A;;(FA|GA);;;AU\)/.test(prep))
  t('préparation : le dossier n\'est modifiable que par SYSTEM et les administrateurs ; les utilisateurs déposent seulement des demandes', /S-1-5-18:\(OI\)\(CI\)F/.test(prep) && /S-1-5-32-544:\(OI\)\(CI\)F/.test(prep) && /S-1-5-32-545:\(OI\)\(CI\)RX/.test(prep) && /requests.*RX,WD,AD/.test(prep))
  {
    const full = g.buildHelperScript('install')
    t('préparation : tout est DANS la commande (aucun fichier relu au moment de l\'élévation) et aucun marqueur laissé', !/\{\{[A-Z_]+\}\}/.test(full) && /\$stop = @'/.test(full) && /\$names = @'/.test(full) && !/Get-Content|\. \.\\|Invoke-Expression|DownloadString/i.test(full.split("$stop = @'")[0]))
    t('préparation : la liste fixe contient TeamViewer, AnyDesk, l\'outil de capture, Teams (et seulement des noms sûrs)', ['teamviewer_service', 'anydesk', 'snippingtool', 'ms-teams', 'zoom'].every(n => full.includes('\n' + n + '\r\n') || full.includes('\n' + n + '\n')) && g.helperList().every(n => /^[\w.\-]{1,60}$/.test(n)))
    t('préparation : version écrite sur le poste (re-préparation quand le script change)', full.includes("'" + g.HELPER_VERSION + "'") && /version\.txt/.test(full))
    t('retrait : désenregistre la tâche et supprime le dossier', /Unregister-ScheduledTask/.test(g.buildHelperScript('remove')) && /Remove-Item/.test(g.buildHelperScript('remove')))
    t('préparation : le fichier du SYSTEM n\'est écrit qu\'APRÈS la mise en place des droits (aucune fenêtre où un utilisateur pourrait le modifier)', full.indexOf('icacls.exe $dir') > 0 && full.indexOf('icacls.exe $dir') < full.indexOf('Set-Content -LiteralPath (Join-Path $dir \'cei-stop.ps1\')'))
  }
  {
    const mi = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'make-installer.js'), 'utf8')
    t('installateur : l\'autorisation de l\'administrateur est demandée en fin d\'installation interactive, jamais pendant une mise à jour silencieuse', /IfSilent \+2\s+ExecWait '[^\n]*--prepare-poste --auto'/.test(mi))
    t('installateur : raccourci du menu Démarrer pour (re)donner l\'autorisation', /Autoriser l'arrêt automatique des logiciels interdits\.lnk/.test(mi))
    t('installateur : reste installable SANS droits d\'administrateur (l\'ancien système de mise à jour des versions 1.3 à 1.6 ne sait lancer qu\'un installateur sans élévation)', /RequestExecutionLevel user/.test(mi))
  }
  t('aide : noms demandables assainis', JSON.stringify(g.helperNames(['TeamViewer_Service.exe', 'a b', "x';y", 'AnyDesk'])) === JSON.stringify(['teamviewer_service', 'anydesk']))
  asyncChecks = Promise.all([asyncChecks, g.helperAvailable().then(a => t('aide : « non disponible » hors Windows, aucune demande déposée', a === false)), g.helperStop(['anydesk']).then(a => t('aide : demande d\'arrêt sans effet hors Windows', a === false))])
}
asyncChecks.then(() => {
console.log(`\n${ok}/${ok + ko} vérifications réussies`)
  process.exit(ko ? 1 : 0)
})
}))
