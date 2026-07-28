# ============================================================================
#  health-check.ps1  -  Vigía de laceleste-movimientos
# ----------------------------------------------------------------------------
#  Corre 1 vez al día (Tarea Programada de Windows) y avisa por MAIL si:
#
#   [SISTEMA]  1) la tarea "LaCeleste Sync en vivo" (o "LaCeleste Backup DB")
#                 quedó Disabled, o
#              2) el último movimiento del sync en la DB tiene más de
#                 SYNC_STALE_DIAS días (default 2) → el sync no está entrando
#                 (tarea caída, Docker apagado, PC apagada, error, etc.).
#
#   [ORIGEN]   3) en la app del compañero hay abastecimientos de AYER con
#                 sugerido cargado pero SIN "real" guardado (sesión sin cerrar)
#                 → esos renglones NO entran a nuestro stock (regla #2) y ese
#                 día queda incompleto (fue el caso "base de torta" 19-23/07).
#
#  Manda mail SOLO si hay algo que reportar (no ensucia el inbox). Loguea todas
#  las corridas en logs\health-check.log. Nace del incidente 2026-07-23: el sync
#  estuvo caído del 17 al 23/07 sin que nadie se entere. Ver
#  memory\automatizar-syncs-en-vivo.md.
#
#  Config: lee la .env de la raíz del repo. Claves nuevas (agregar a .env):
#     ALERT_MAIL_TO      destinatario (ej. ia@laceleste.com.ar)
#     ALERT_MAIL_FROM    remitente    (ej. ia@laceleste.com.ar)
#     ALERT_SMTP_USER    usuario SMTP (la misma cuenta de Gmail/Workspace)
#     ALERT_SMTP_PASS    contraseña de aplicación de Google (16 letras, sin espacios)
#     ALERT_SMTP_HOST    opcional, default smtp.gmail.com
#     ALERT_SMTP_PORT    opcional, default 587 (STARTTLS)
#     SYNC_STALE_DIAS    opcional, default 2
#  Reusa COMPANERO_API_URL/USER/PASS y POSTGRES_* que ya están en la .env.
#
#  Prueba manual (imprime lo que mandaría, sin depender del scheduler):
#     powershell -ExecutionPolicy Bypass -File scripts\health-check.ps1
#  Con -WhatIfMail NO envía, solo muestra el mail en consola/log:
#     powershell -ExecutionPolicy Bypass -File scripts\health-check.ps1 -WhatIfMail
# ============================================================================
[CmdletBinding()]
param(
  [switch]$WhatIfMail  # si está, arma el mail pero NO lo envía (para probar)
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot   # scripts\.. = raíz del repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'health-check.log'

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
  Write-Host $line
}

# --- .env → hashtable (split en el PRIMER '='; ignora comentarios/vacías) ---
function Read-DotEnv([string]$path) {
  $h = @{}
  if (-not (Test-Path $path)) { return $h }
  foreach ($raw in Get-Content -Path $path -Encoding utf8) {
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    $h[$k] = $v
  }
  return $h
}

Log "==== INICIO health-check ===="
$env0 = Read-DotEnv (Join-Path $repo '.env')

$problemas = New-Object System.Collections.Generic.List[string]

# ============================================================================
# [SISTEMA] 1) Estado de las tareas programadas
# ============================================================================
foreach ($tn in @('LaCeleste Sync en vivo', 'LaCeleste Backup DB')) {
  try {
    $task = Get-ScheduledTask -TaskName $tn -ErrorAction Stop
    if ($task.State -eq 'Disabled') {
      $problemas.Add("La tarea programada `"$tn`" está DESHABILITADA (State=Disabled). No va a correr hasta re-habilitarla: Enable-ScheduledTask -TaskName '$tn'.")
      Log "  PROBLEMA: tarea '$tn' Disabled"
    } else {
      Log "  OK: tarea '$tn' State=$($task.State)"
    }
  } catch {
    $problemas.Add("No pude leer la tarea programada `"$tn`" (¿la borraron/renombraron?): $($_.Exception.Message)")
    Log "  PROBLEMA: no se pudo leer tarea '$tn'"
  }
}

# ============================================================================
# [SISTEMA] 2) Frescura de los datos del sync en la DB
# ============================================================================
$staleDias = 2
if ($env0['SYNC_STALE_DIAS']) { [int]::TryParse($env0['SYNC_STALE_DIAS'], [ref]$staleDias) | Out-Null }
$pgUser = $env0['POSTGRES_USER']; $pgDb = $env0['POSTGRES_DB']; $pgPass = $env0['POSTGRES_PASSWORD']
$cont = 'laceleste_movimientos_db'
$syncStale = $false
try {
  $sql = "SELECT COALESCE(to_char(max(fecha),'YYYY-MM-DD'),'') FROM movimientos WHERE observaciones LIKE 'Sync %';"
  $maxFecha = (& docker exec -e "PGPASSWORD=$pgPass" $cont psql -U $pgUser -d $pgDb -t -A -c $sql 2>$null | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($maxFecha)) {
    $syncStale = $true
    $problemas.Add("No pude leer el último movimiento del sync en la DB (¿Docker/Postgres apagado?). Contenedor: $cont.")
    Log "  PROBLEMA: DB no respondió max(fecha)"
  } else {
    $edad = [int]((Get-Date).Date - ([datetime]$maxFecha).Date).TotalDays
    if ($edad -gt $staleDias) {
      $syncStale = $true
      $problemas.Add("El sync no está entrando: el último movimiento en la app es del $maxFecha ($edad día/s atrás, umbral $staleDias). Revisá la tarea 'Sync en vivo' y logs\sync-live.log; después catch-up: npm -w backend run sync:abastecimientos -- --desde=$maxFecha --hasta=$((Get-Date).ToString('yyyy-MM-dd')) (idem recepciones).")
      Log "  PROBLEMA: datos stale, max(fecha)=$maxFecha ($edad d)"
    } else {
      Log "  OK: max(fecha) del sync = $maxFecha ($edad d)"
    }
  }
} catch {
  $syncStale = $true
  $problemas.Add("Error consultando la DB para la frescura del sync: $($_.Exception.Message)")
  Log "  PROBLEMA: excepción consultando la DB"
}

# ============================================================================
# [ORIGEN] 3) Chequeos sobre la app del compañero (fuente de los abastecimientos)
#   3a) ÁREA que no cerró: tiene sugeridos pero CERO reales en el día → no entró
#       NADA de esa área al stock (la olvidaron de cerrar entera).
#   3b) PRODUCTO que se cayó: venía con RINT casi a diario y hace >= DIAS_CAIDO
#       días que no tiene real, aunque el compañero lo sigue sugiriendo (caso
#       "base de torta" 19-23/07). Cruza el historial de nuestra DB con el
#       sugerido del origen. Se SALTEA si el sync está stale (un bajón global
#       haría figurar a TODOS como "caídos").
# ============================================================================
$apiUrl = ($env0['COMPANERO_API_URL']).TrimEnd('/')
$apiUsr = $env0['COMPANERO_API_USER']; $apiPas = $env0['COMPANERO_API_PASS']
$diasCaido = 3
if ($env0['DIAS_CAIDO']) { [int]::TryParse($env0['DIAS_CAIDO'], [ref]$diasCaido) | Out-Null }
$fechaChequeo = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')

function AsNum($v) { $n = 0.0; if ([double]::TryParse(("" + $v), [ref]$n)) { return $n } else { return 0.0 } }

try {
  $loginBody = @{ usuario = $apiUsr; password = $apiPas } | ConvertTo-Json
  $login = Invoke-RestMethod -Uri "$apiUrl/api/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 30
  $token = $login.token
  if (-not $token) { throw "login sin token" }
  $headers = @{ Authorization = "Bearer $token" }
  $resp = Invoke-RestMethod -Uri "$apiUrl/api/abastecimiento/tabla-integral?fecha=$fechaChequeo" -Headers $headers -TimeoutSec 60
  $filas = @($resp.data)

  # ---- 3a) áreas con sugerido pero CERO reales (no cerraron nada) ----
  $areasSinCerrar = New-Object System.Collections.Generic.List[string]
  foreach ($g in ($filas | Group-Object -Property area)) {
    $conSug = @($g.Group | Where-Object { (AsNum $_.cantidad_abastecer) -gt 0 })
    if ($conSug.Count -eq 0) { continue }   # área sin nada sugerido ese día → no aplica
    $conReal = @($g.Group | Where-Object { (AsNum $_.cantidad_abastecer_real) -gt 0 })
    if ($conReal.Count -eq 0) {
      $areasSinCerrar.Add(("{0} ({1} sugerido/s, 0 reales)" -f $g.Name, $conSug.Count))
    }
  }
  if ($areasSinCerrar.Count -gt 0) {
    $problemas.Add("Áreas que NO cargaron NINGÚN real el ${fechaChequeo} (no cerraron la sesión → nada de esas áreas entró al stock): " + ([string]::Join('; ', $areasSinCerrar)) + ". Que cierren/guarden la sesión de ese día, o cargá el día del export de 3c (import:movimientos).")
    Log "  PROBLEMA 3a: $($areasSinCerrar.Count) área(s) sin cerrar el $fechaChequeo"
  } else {
    Log "  OK 3a: toda área con sugerido cargó al menos un real el $fechaChequeo"
  }

  # códigos que el compañero SIGUE sugiriendo (para validar 3b: el producto sigue esperado)
  $sugeridosHoy = @{}
  foreach ($f in $filas) {
    if ((AsNum $f.cantidad_abastecer) -gt 0) {
      $cod = ("" + $f.codigo_3c).Trim()
      if ($cod -ne '') { $sugeridosHoy[$cod] = $true }
    }
  }

  # ---- 3b) productos que se cayeron (regulares que dejaron de entrar) ----
  if ($syncStale) {
    Log "  3b SALTEADO: el sync está stale (evita marcar a todos como caídos)."
  } else {
    $sqlCaidos = @"
SELECT d.producto_3c, p.nombre, to_char(max(m.fecha),'YYYY-MM-DD'), count(DISTINCT m.fecha)
FROM movimientos_detalle d
JOIN movimientos m ON m.id=d.movimiento_id
JOIN tipos_movimiento tm ON tm.id=m.tipo_id
JOIN productos p ON p.codigo_3c=d.producto_3c
WHERE tm.codigo='RINT' AND m.estado='CONFIRMADO' AND m.observaciones LIKE 'Sync %'
  AND m.fecha >= CURRENT_DATE - INTERVAL '21 days'
GROUP BY d.producto_3c, p.nombre
HAVING count(DISTINCT m.fecha) >= 5 AND max(m.fecha) <= CURRENT_DATE - ($diasCaido * INTERVAL '1 day');
"@
    $out = (& docker exec -e "PGPASSWORD=$pgPass" $cont psql -U $pgUser -d $pgDb -t -A -F "`t" -c $sqlCaidos 2>$null | Out-String)
    $caidos = New-Object System.Collections.Generic.List[string]
    foreach ($ln in ($out -split "`n")) {
      $ln = $ln.Trim()
      if ($ln -eq '') { continue }
      $c = $ln -split "`t"
      if ($c.Count -lt 4) { continue }
      $cod = $c[0].Trim()
      if (-not $sugeridosHoy.ContainsKey($cod)) { continue }  # el compañero ya no lo sugiere → no es gap
      $caidos.Add(("{0} ({1}): último RINT {2}, movía {3} día(s) en las últimas 3 semanas — el compañero lo sigue sugiriendo pero sin real" -f $c[1].Trim(), $cod, $c[2].Trim(), $c[3].Trim()))
    }
    if ($caidos.Count -gt 0) {
      $problemas.Add("Productos que SE CAYERON (venían moviéndose seguido y hace >= $diasCaido días sin real):`n" + ([string]::Join("`n", ($caidos | ForEach-Object { "  - " + $_ }))) + "`nRevisá si el área los dejó de cargar (que guarde la sesión) o si realmente dejaron de moverse.")
      Log "  PROBLEMA 3b: $($caidos.Count) producto(s) caído(s)"
    } else {
      Log "  OK 3b: no hay productos caídos."
    }
  }
} catch {
  $problemas.Add("No pude correr los chequeos de origen (API del compañero) del ${fechaChequeo}: $($_.Exception.Message)")
  Log "  PROBLEMA: fallo en chequeos de origen"
}

# ============================================================================
# Resultado → mail (solo si hay problemas)
# ============================================================================
if ($problemas.Count -eq 0) {
  Log "Todo OK — no se manda mail."
  Log "==== FIN health-check ===="
  exit 0
}

$asunto = "[La Celeste] Alerta stock/sync ($($problemas.Count) tema/s) - $((Get-Date).ToString('dd/MM HH:mm'))"
$cuerpo = @"
Chequeo automático de laceleste-movimientos ($((Get-Date).ToString('dd/MM/yyyy HH:mm'))).
Se detectaron $($problemas.Count) tema(s):

$([string]::Join("`n`n", ($problemas | ForEach-Object { "* " + $_ })))

--
Este aviso lo manda scripts\health-check.ps1 (tarea 'LaCeleste Health Check').
Si algo ya lo resolviste, ignoralo: el próximo chequeo no lo vuelve a mandar.
"@

Log "RESUMEN: $($problemas.Count) problema(s). Asunto: $asunto"

$to = $env0['ALERT_MAIL_TO']; $from = $env0['ALERT_MAIL_FROM']
$smtpUser = $env0['ALERT_SMTP_USER']; $smtpPass = $env0['ALERT_SMTP_PASS']
$smtpHost = if ($env0['ALERT_SMTP_HOST']) { $env0['ALERT_SMTP_HOST'] } else { 'smtp.gmail.com' }
$smtpPort = 587
if ($env0['ALERT_SMTP_PORT']) { [int]::TryParse($env0['ALERT_SMTP_PORT'], [ref]$smtpPort) | Out-Null }

if ($WhatIfMail) {
  Log "[-WhatIfMail] NO se envía. Cuerpo del mail:`n$cuerpo"
  Log "==== FIN health-check ===="
  exit 0
}

if (-not $to -or -not $smtpUser -or -not $smtpPass) {
  Log "FALTA CONFIG DE MAIL (ALERT_MAIL_TO / ALERT_SMTP_USER / ALERT_SMTP_PASS en .env). No se pudo enviar. Cuerpo:`n$cuerpo"
  Log "==== FIN health-check ===="
  exit 2
}

try {
  $sec = ConvertTo-SecureString $smtpPass -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential($smtpUser, $sec)
  Send-MailMessage -From $from -To $to -Subject $asunto -Body $cuerpo `
    -SmtpServer $smtpHost -Port $smtpPort -UseSsl -Credential $cred -Encoding utf8
  Log "Mail enviado a $to via $smtpHost`:$smtpPort."
} catch {
  Log "ERROR enviando el mail: $($_.Exception.Message)"
  Log "==== FIN health-check ===="
  exit 3
}

Log "==== FIN health-check ===="
exit 0
