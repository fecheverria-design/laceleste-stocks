# ============================================================================
#  register-healthcheck-task.ps1  -  Registra la Tarea Programada del vigia.
# ----------------------------------------------------------------------------
#  Crea/actualiza la tarea "LaCeleste Health Check" que corre
#  scripts\health-check.ps1 todos los dias a las 09:30. Con StartWhenAvailable:
#  si la PC estuvo apagada, corre apenas puede.
#
#  El vigia avisa por mail si: el sync se cayo, una tarea quedo deshabilitada, un
#  area no cerro la sesion, o un producto regular dejo de tener "real" en el origen.
#  Solo manda mail cuando hay algo que reportar. Requiere las claves ALERT_* en .env.
#
#  Uso (PowerShell, como el usuario que queda logueado):
#      cd D:\Bibliotecas\Desktop\Appstocks
#      powershell -ExecutionPolicy Bypass -File scripts\register-healthcheck-task.ps1
#
#  Borrar:  Unregister-ScheduledTask -TaskName "LaCeleste Health Check" -Confirm:$false
#  Correr a mano: Start-ScheduledTask -TaskName "LaCeleste Health Check"
#  Probar sin enviar: powershell -ExecutionPolicy Bypass -File scripts\health-check.ps1 -WhatIfMail
#  NOTA: sin acentos a proposito (PowerShell 5.1 lee el .ps1 como ANSI).
# ============================================================================
$ErrorActionPreference = 'Stop'

$taskName = 'LaCeleste Health Check'
$script = Join-Path $PSScriptRoot 'health-check.ps1'
if (-not (Test-Path $script)) { throw "No encuentro $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script)

# Diario a las 09:30: chequea el dia ANTERIOR (ya cerrado) y avisa temprano.
$trigger = New-ScheduledTaskTrigger -Daily -At '09:30'

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
Write-Host "Ver el log:     Get-Content logs\health-check.log -Tail 30"
