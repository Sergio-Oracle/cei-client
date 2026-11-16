$ErrorActionPreference = 'Stop'
# CEI Examen - preparation du poste (exécuté avec les droits d'administrateur, UNE fois par ordinateur, après accord de l'administrateur).
# Contenu fixé par l'application : rien n'est lu ailleurs que dans ce texte.
$dir = Join-Path $env:ProgramData 'CEI Examen'
$task = 'CEI Examen Arret'
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $dir 'requests') | Out-Null
  $stop = @'
{{STOP_SCRIPT}}
'@
  $names = @'
{{FORBIDDEN}}
'@
  # Droits d'abord (SYSTEM et administrateurs : tout ; utilisateurs : lecture seule ; « requests » : dépôt d'un fichier), écriture ensuite.
  & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
  & icacls.exe (Join-Path $dir 'requests') /grant '*S-1-5-32-545:(OI)(CI)(RX,WD,AD)' | Out-Null
  Set-Content -LiteralPath (Join-Path $dir 'cei-stop.ps1') -Value $stop -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $dir 'forbidden.txt') -Value $names -Encoding ASCII
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'cei-stop.ps1') + '"')
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  # Tout utilisateur connecté peut LANCER la tâche (lecture + exécution), jamais la modifier ni la supprimer.
  $svc = New-Object -ComObject 'Schedule.Service'
  $svc.Connect()
  $t = $svc.GetFolder('\').GetTask($task)
  $t.SetSecurityDescriptor('D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)', 0)
  Set-Content -LiteralPath (Join-Path $dir 'version.txt') -Value '{{VERSION}}' -Encoding ASCII
  exit 0
} catch {
  exit 1
}
