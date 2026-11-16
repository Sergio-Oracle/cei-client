# CEI Examen — préparation du poste (exécuté UNE FOIS, avec les droits d'administrateur, par l'installateur « Préparation du poste »).
# Crée la tâche planifiée « CEI Examen Arret » (compte SYSTEM) que l'application CEI Examen peut déclencher SANS droits d'administrateur
# pour arrêter, seule et sans fenêtre d'autorisation, les logiciels interdits (TeamViewer, AnyDesk, outil de capture…), services compris.
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$task = 'CEI Examen Arret'
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $dir 'requests') | Out-Null
  # Droits : SYSTEM et administrateurs ont tout ; les utilisateurs peuvent LIRE (pas modifier) le script et la liste.
  # Le sous-dossier « requests » accepte le dépôt d'un fichier par n'importe quel utilisateur (demande d'arrêt).
  & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
  & icacls.exe (Join-Path $dir 'requests') /grant '*S-1-5-32-545:(OI)(CI)(RX,WD,AD)' | Out-Null
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'cei-stop.ps1') + '"')
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  # Tout utilisateur connecté peut LANCER la tâche (lecture + exécution), jamais la modifier ni la supprimer.
  $svc = New-Object -ComObject 'Schedule.Service'
  $svc.Connect()
  $t = $svc.GetFolder('\').GetTask($task)
  $t.SetSecurityDescriptor('D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;AU)', 0)
  Write-Output 'OK'
  exit 0
} catch {
  Write-Output ('ERREUR : ' + $_.Exception.Message)
  exit 1
}
