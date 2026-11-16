# CEI Examen — arrêt des logiciels interdits (exécuté par Windows en tant que SYSTEM, à la demande de l'application CEI Examen).
# Installé UNE FOIS par un administrateur (« Préparation du poste »). Ce fichier n'est modifiable que par SYSTEM et les administrateurs.
# Sécurité : l'application dépose dans « requests » une liste de noms de processus ; seuls ceux qui figurent AUSSI dans forbidden.txt
# (liste fixe, écrite par l'administrateur) sont arrêtés. Aucun autre nom, aucun chemin, aucune commande n'est jamais exécuté.
$ErrorActionPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$allow = @(Get-Content -LiteralPath (Join-Path $dir 'forbidden.txt') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -match '^[\w.\-]{1,60}$' })
$reqDir = Join-Path $dir 'requests'
$asked = @()
Get-ChildItem -LiteralPath $reqDir -Filter '*.req' | ForEach-Object {
  if (((Get-Date) - $_.LastWriteTime).TotalMinutes -lt 10) {
    $asked += @(Get-Content -LiteralPath $_.FullName | ForEach-Object { $_.Trim().ToLower() })
  }
  Remove-Item -LiteralPath $_.FullName -Force
}
$targets = @($asked | Where-Object { $allow -contains $_ } | Select-Object -Unique)
if ($targets.Count -eq 0) { exit 0 }
# Les SERVICES d'abord (sinon le gestionnaire de services relance le processus aussitôt), puis les processus eux-mêmes.
Get-Process | Where-Object { $targets -contains $_.ProcessName.ToLower() } | ForEach-Object {
  $id = $_.Id
  Get-CimInstance Win32_Service -Filter "ProcessId=$id" | ForEach-Object { Stop-Service -Name $_.Name -Force }
  Stop-Process -Id $id -Force
}
exit 0
