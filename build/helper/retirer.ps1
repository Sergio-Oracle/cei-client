# CEI Examen — retrait de la préparation du poste (administrateur).
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName 'CEI Examen Arret' -Confirm:$false
exit 0
