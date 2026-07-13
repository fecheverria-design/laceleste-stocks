# ============================================================================
#  register-backup-task.ps1  -  Registra la Tarea Programada DIARIA de backup.
# ----------------------------------------------------------------------------
#  Crea/actualiza la tarea "LaCeleste Backup DB" que corre scripts\backup-db.ps1
#  todos los dias a las 13:00. Con StartWhenAvailable: si la PC estuvo apagada a
#  esa hora, corre apenas puede.
#
#  Uso (PowerShell, como el usuario que queda logueado):
#      cd D:\Bibliotecas\Desktop\Appstocks
#      powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
#
#  Borrar:  Unregister-ScheduledTask -TaskName "LaCeleste Backup DB" -Confirm:$false
#  Correr a mano: Start-ScheduledTask -TaskName "LaCeleste Backup DB"
#  NOTA: sin acentos a proposito (PowerShell 5.1 lee el .ps1 como ANSI).
# ============================================================================
$ErrorActionPreference = 'Stop'

$taskName = 'LaCeleste Backup DB'
$script = Join-Path $PSScriptRoot 'backup-db.ps1'
if (-not (Test-Path $script)) { throw "No encuentro $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script)

# Diario a las 13:00 (horario en que la PC suele estar prendida).
$trigger = New-ScheduledTaskTrigger -Daily -At '13:00'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)

# Corre con la sesion del usuario (asi ve Docker); NO guarda contrasenia.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "OK - tarea '$taskName' registrada para $env:USERNAME."
Write-Host "Proxima corrida:" (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime
Write-Host "Correr a mano:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Ver el log:     Get-Content logs\backup-db.log -Tail 20"
