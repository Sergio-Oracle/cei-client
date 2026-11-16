$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName 'CEI Examen Arret' -Confirm:$false
Remove-Item -LiteralPath (Join-Path $env:ProgramData 'CEI Examen') -Recurse -Force
exit 0
