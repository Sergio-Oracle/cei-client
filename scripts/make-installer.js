#!/usr/bin/env node
'use strict'
/**
 * Installateur Windows (.exe) de CEI Examen, fabriqué avec NSIS (makensis) — fonctionne depuis Linux, macOS ou Windows, sans Wine.
 * (L'outil habituel d'electron-builder exige Wine pour son installateur ; celui-ci n'en a pas besoin.)
 *
 *   node scripts/make-installer.js          prérequis : dist/win-unpacked (npm run build:win) et makensis (apt install nsis)
 *
 * L'installateur : installe pour l'utilisateur courant (aucun droit administrateur), crée les raccourcis Bureau et menu Démarrer,
 * déclare la désinstallation dans « Applications installées », enregistre le lien ceiexamen:// et propose de lancer l'application.
 */
const { spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..')
const pkg = require('../package.json')
const unpacked = path.join(root, 'dist', 'win-unpacked')
if (!fs.existsSync(path.join(unpacked, 'CEI Examen.exe'))) { console.error('✘ dist/win-unpacked introuvable : construisez d\'abord Windows (node scripts/build.js win).'); process.exit(1) }
if (spawnSync('makensis', ['-VERSION']).status !== 0) { console.error('✘ makensis introuvable (Linux : apt install nsis ; macOS : brew install nsis ; Windows : installer NSIS).'); process.exit(1) }

const ico = path.join(root, 'build', 'icon.ico')
const out = path.join(root, 'dist', `CEI-Examen-${pkg.version}-win-setup.exe`)
const q = p => p.replace(/\//g, '\\')            // chemins au format NSIS
const nsi = `Unicode true
!define APP "CEI Examen"
!define EXE "CEI Examen.exe"
!define VERSION "${pkg.version}"
!define KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CEIExamen"
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "\${APP}"
OutFile "${out.replace(/\\/g, '/')}"
InstallDir "$LOCALAPPDATA\\Programs\\CEI Examen"
InstallDirRegKey HKCU "Software\\CEI Examen" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "CEI Examen \${VERSION} — Université Numérique Cheikh Hamidou Kane"
VIProductVersion "${pkg.version}.0"
VIAddVersionKey /LANG=1036 "ProductName" "CEI Examen"
VIAddVersionKey /LANG=1036 "FileDescription" "Installateur de CEI Examen"
VIAddVersionKey /LANG=1036 "FileVersion" "${pkg.version}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© 2026 UN-CHK — Centre d'Examen Intelligent"
VIAddVersionKey /LANG=1036 "CompanyName" "UN-CHK — Centre d'Examen Intelligent"
${fs.existsSync(ico) ? `!define MUI_ICON "${ico}"\n!define MUI_UNICON "${ico}"` : ''}
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer CEI Examen"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Section "Installation"
  nsExec::Exec 'taskkill /IM "\${EXE}" /F'          ; une ancienne version ouverte est fermée (mise à jour par-dessus)
  SetOutPath "$INSTDIR"
  File /r "${q(unpacked)}\\*.*"
  WriteUninstaller "$INSTDIR\\Désinstaller CEI Examen.exe"
  CreateShortcut "$DESKTOP\\CEI Examen.lnk" "$INSTDIR\\\${EXE}"
  CreateDirectory "$SMPROGRAMS\\CEI Examen"
  CreateShortcut "$SMPROGRAMS\\CEI Examen\\CEI Examen.lnk" "$INSTDIR\\\${EXE}"
  CreateShortcut "$SMPROGRAMS\\CEI Examen\\Désinstaller CEI Examen.lnk" "$INSTDIR\\Désinstaller CEI Examen.exe"
  WriteRegStr HKCU "Software\\CEI Examen" "InstallDir" "$INSTDIR"
  ; Applications installées (Paramètres Windows)
  WriteRegStr HKCU "\${KEY}" "DisplayName" "\${APP}"
  WriteRegStr HKCU "\${KEY}" "DisplayVersion" "\${VERSION}"
  WriteRegStr HKCU "\${KEY}" "Publisher" "UN-CHK — Centre d'Examen Intelligent"
  WriteRegStr HKCU "\${KEY}" "DisplayIcon" "$INSTDIR\\\${EXE}"
  WriteRegStr HKCU "\${KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "\${KEY}" "UninstallString" '"$INSTDIR\\Désinstaller CEI Examen.exe"'
  WriteRegStr HKCU "\${KEY}" "QuietUninstallString" '"$INSTDIR\\Désinstaller CEI Examen.exe" /S'
  WriteRegDWORD HKCU "\${KEY}" "NoModify" 1
  WriteRegDWORD HKCU "\${KEY}" "NoRepair" 1
  \${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "\${KEY}" "EstimatedSize" "$0"
  ; Lien « Ouvrir dans l'application » du site : ceiexamen://exam/123
  WriteRegStr HKCU "Software\\Classes\\ceiexamen" "" "URL:CEI Examen"
  WriteRegStr HKCU "Software\\Classes\\ceiexamen" "URL Protocol" ""
  WriteRegStr HKCU "Software\\Classes\\ceiexamen\\DefaultIcon" "" "$INSTDIR\\\${EXE},0"
  WriteRegStr HKCU "Software\\Classes\\ceiexamen\\shell\\open\\command" "" '"$INSTDIR\\\${EXE}" "%1"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "\${EXE}" /F'
  Delete "$DESKTOP\\CEI Examen.lnk"
  RMDir /r "$SMPROGRAMS\\CEI Examen"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "\${KEY}"
  DeleteRegKey HKCU "Software\\CEI Examen"
  DeleteRegKey HKCU "Software\\Classes\\ceiexamen"
SectionEnd
`
const file = path.join(root, 'build', 'installer.nsi')
fs.writeFileSync(file, nsi, 'utf8')
const r = spawnSync('makensis', ['-V2', file], { stdio: 'inherit' })
if (r.status !== 0) { console.error('✘ Échec de makensis'); process.exit(r.status || 1) }
console.log(`✔ Installateur Windows : ${out} (${(fs.statSync(out).size / 1048576).toFixed(0)} Mo)`)
