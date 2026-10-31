Unicode true
!define APP "CEI Examen"
!define EXE "CEI Examen.exe"
!define VERSION "1.1.1"
!define KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CEIExamen"
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "${APP}"
OutFile "/root/cei-client/dist/CEI-Examen-1.1.1-win-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\CEI Examen"
InstallDirRegKey HKCU "Software\CEI Examen" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "CEI Examen ${VERSION} — Université Numérique Cheikh Hamidou Kane"
VIProductVersion "1.1.1.0"
VIAddVersionKey /LANG=1036 "ProductName" "CEI Examen"
VIAddVersionKey /LANG=1036 "FileDescription" "Installateur de CEI Examen"
VIAddVersionKey /LANG=1036 "FileVersion" "1.1.1"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© 2026 UN-CHK — Centre d'Examen Intelligent"
VIAddVersionKey /LANG=1036 "CompanyName" "UN-CHK — Centre d'Examen Intelligent"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer CEI Examen"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Section "Installation"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'          ; une ancienne version ouverte est fermée (mise à jour par-dessus)
  SetOutPath "$INSTDIR"
  File /r "\root\cei-client\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Désinstaller CEI Examen.exe"
  CreateShortcut "$DESKTOP\CEI Examen.lnk" "$INSTDIR\${EXE}"
  CreateDirectory "$SMPROGRAMS\CEI Examen"
  CreateShortcut "$SMPROGRAMS\CEI Examen\CEI Examen.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\CEI Examen\Désinstaller CEI Examen.lnk" "$INSTDIR\Désinstaller CEI Examen.exe"
  WriteRegStr HKCU "Software\CEI Examen" "InstallDir" "$INSTDIR"
  ; Applications installées (Paramètres Windows)
  WriteRegStr HKCU "${KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${KEY}" "Publisher" "UN-CHK — Centre d'Examen Intelligent"
  WriteRegStr HKCU "${KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${KEY}" "UninstallString" '"$INSTDIR\Désinstaller CEI Examen.exe"'
  WriteRegStr HKCU "${KEY}" "QuietUninstallString" '"$INSTDIR\Désinstaller CEI Examen.exe" /S'
  WriteRegDWORD HKCU "${KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${KEY}" "EstimatedSize" "$0"
  ; Lien « Ouvrir dans l'application » du site : ceiexamen://exam/123
  WriteRegStr HKCU "Software\Classes\ceiexamen" "" "URL:CEI Examen"
  WriteRegStr HKCU "Software\Classes\ceiexamen" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\ceiexamen\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\ceiexamen\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Delete "$DESKTOP\CEI Examen.lnk"
  RMDir /r "$SMPROGRAMS\CEI Examen"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${KEY}"
  DeleteRegKey HKCU "Software\CEI Examen"
  DeleteRegKey HKCU "Software\Classes\ceiexamen"
SectionEnd
