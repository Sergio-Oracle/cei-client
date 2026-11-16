#!/usr/bin/env node
'use strict'
/**
 * Installateur « Préparation du poste » (Windows) : à lancer UNE FOIS par ordinateur, par quelqu'un qui a les droits d'administrateur
 * (le technicien de la salle d'examen, par exemple). Il permet ensuite à CEI Examen d'arrêter SEUL les logiciels interdits — services compris
 * (TeamViewer, AnyDesk…) — chez un étudiant SANS droits d'administrateur et sans aucune fenêtre d'autorisation :
 *   - copie cei-stop.ps1 et forbidden.txt (liste fixe) dans C:\ProgramData\CEI Examen (modifiables par les seuls administrateurs) ;
 *   - crée la tâche planifiée « CEI Examen Arret » (compte SYSTEM) que tout utilisateur peut déclencher mais pas modifier.
 * Aucun droit n'est donné sur autre chose que l'arrêt des noms de la liste fixe (voir build/helper/cei-stop.ps1).
 *
 *   node scripts/make-prep.js          prérequis : makensis
 */
const { spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const pkg = require('../package.json')
const guard = require('../src/guard')
if (spawnSync('makensis', ['-VERSION']).status !== 0) { console.error('✘ makensis introuvable.'); process.exit(1) }

const src = path.join(root, 'build', 'helper')
const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cei-prep-'))
const names = [...new Set([...guard.FORBIDDEN, ...guard.REMOTE_TOOLS, ...guard.BACKGROUND_APPS].map(n => String(n).toLowerCase().replace(/\.(exe|app)$/, '').trim()).filter(n => /^[\w.\-]{1,60}$/.test(n)))].sort()
for (const f of ['cei-stop.ps1', 'prepare.ps1', 'retirer.ps1']) fs.copyFileSync(path.join(src, f), path.join(work, f))
fs.writeFileSync(path.join(work, 'forbidden.txt'), names.join('\r\n') + '\r\n')
const out = path.join(root, 'dist', `CEI-Examen-${pkg.version}-preparation-poste.exe`)
const ico = path.join(root, 'build', 'icon.ico')
const w = p => p.replace(/\//g, '\\')
const KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CEIExamenPreparation'
const nsi = `Unicode true
!define APP "CEI Examen — Préparation du poste"
!include "MUI2.nsh"
Name "\${APP}"
OutFile "${out.replace(/\\/g, '/')}"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "CEI Examen ${pkg.version} — Université Numérique Cheikh Hamidou Kane"
VIProductVersion "${pkg.version}.0"
VIAddVersionKey /LANG=1036 "ProductName" "CEI Examen — Préparation du poste"
VIAddVersionKey /LANG=1036 "FileDescription" "Préparation du poste pour CEI Examen (administrateur, une seule fois)"
VIAddVersionKey /LANG=1036 "FileVersion" "${pkg.version}"
VIAddVersionKey /LANG=1036 "CompanyName" "UN-CHK — Centre d'Examen Intelligent"
${fs.existsSync(ico) ? `!define MUI_ICON "${ico}"\n!define MUI_UNICON "${ico}"` : ''}
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Cet ordinateur va être préparé UNE FOIS pour CEI Examen : l'application pourra arrêter seule les logiciels interdits pendant un examen (TeamViewer, AnyDesk, capture d'écran…), même pour un étudiant sans droits d'administrateur.$\\r$\\n$\\r$\\nAucun autre droit n'est accordé."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Section "Préparation"
  SetShellVarContext all
  StrCpy $INSTDIR "$APPDATA\\CEI Examen"
  SetOutPath "$INSTDIR"
  File "${w(path.join(work, 'cei-stop.ps1'))}"
  File "${w(path.join(work, 'prepare.ps1'))}"
  File "${w(path.join(work, 'retirer.ps1'))}"
  File "${w(path.join(work, 'forbidden.txt'))}"
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\\prepare.ps1"'
  Pop $0
  Pop $1
  \${If} $0 != 0
    MessageBox MB_ICONSTOP "La préparation du poste a échoué (code $0) :$\\r$\\n$1" /SD IDOK
    Abort
  \${EndIf}
  WriteUninstaller "$INSTDIR\\Retirer la préparation.exe"
  WriteRegStr HKLM "${KEY}" "DisplayName" "CEI Examen — Préparation du poste"
  WriteRegStr HKLM "${KEY}" "DisplayVersion" "${pkg.version}"
  WriteRegStr HKLM "${KEY}" "Publisher" "UN-CHK — Centre d'Examen Intelligent"
  WriteRegStr HKLM "${KEY}" "UninstallString" '"$INSTDIR\\Retirer la préparation.exe"'
  WriteRegDWORD HKLM "${KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${KEY}" "NoRepair" 1
  MessageBox MB_ICONINFORMATION "Poste préparé : CEI Examen peut maintenant arrêter seul les logiciels interdits." /SD IDOK
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\\retirer.ps1"'
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${KEY}"
SectionEnd
`
const nsiPath = path.join(work, 'prep.nsi')
fs.writeFileSync(nsiPath, '\ufeff' + nsi)
const r = spawnSync('makensis', ['-V2', nsiPath], { stdio: 'inherit' })
fs.rmSync(work, { recursive: true, force: true })
if (r.status !== 0) { console.error('✘ makensis a échoué'); process.exit(1) }
console.log('✔ ' + out + ' (' + names.length + ' noms dans la liste fixe)')
