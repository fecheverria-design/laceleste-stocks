# ============================================================================
#  register-sync-task.ps1  -  Registra/actualiza la Tarea Programada de Windows
#  que corre los syncs en vivo cada 1h (importa scripts\laceleste-sync.xml).
# ----------------------------------------------------------------------------
#  Uso (PowerShell, como el usuario que va a quedar logueado en la PC):
#      cd D:\Bibliotecas\Desktop\Appstocks
#      powershell -ExecutionPolicy Bypass -File scripts\register-sync-task.ps1
#
#  - Registra la tarea a nombre del usuario ACTUAL, con LogonType Interactive
#    (corre solo con el usuario logueado; NO guarda contrasenia).
#  - Re-ejecutar actualiza la tarea (-Force). Para borrarla:
#      Unregister-ScheduledTask -TaskName "LaCeleste Sync en vivo" -Confirm:$false
#  - Para dispararla a mano y ver el log:
#      Start-ScheduledTask -TaskName "LaCeleste Sync en vivo"
#      Get-Content logs\sync-live.log -Tail 40
# ============================================================================
$ErrorActionPreference = 'Stop'

$taskName = 'LaCeleste Sync en vivo'
$repo = Split-Path -Parent $PSScriptRoot          # scripts\ -> raiz del repo
$xmlPath = Join-Path $PSScriptRoot 'laceleste-sync.xml'

if (-not (Test-Path $xmlPath)) { throw "No encuentro $xmlPath" }

# Sanity: el .cmd que la tarea va a ejecutar tiene que existir.
$cmd = Join-Path $PSScriptRoot 'sync-live.cmd'
if (-not (Test-Path $cmd)) { throw "No encuentro $cmd" }

$xml = Get-Content -Raw -Path $xmlPath

Register-ScheduledTask -TaskName $taskName -Xml $xml -User $env:USERNAME -Force | Out-Null

Write-Host "OK - tarea '$taskName' registrada para el usuario $env:USERNAME."
Write-Host "Proxima corrida:" (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime
Write-Host ""
Write-Host "Probar ahora sin escribir en la DB:  scripts\sync-live.cmd --dry"
Write-Host "Disparar la tarea a mano:            Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Ver el log:                          Get-Content logs\sync-live.log -Tail 40"
