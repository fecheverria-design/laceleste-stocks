# ============================================================================
#  backup-db.ps1  -  Backup de la base de laceleste-movimientos a Dropbox (off-site)
# ----------------------------------------------------------------------------
#  Hace un pg_dump (formato custom -Fc, comprimido) de la DB en Docker, lo VERIFICA
#  (pg_restore -l) y lo copia a la carpeta de Dropbox -> se sube solo a la nube.
#  Rota: borra backups de mas de $RetencionDias dias. Loguea en logs\backup-db.log.
#
#  Lo dispara una Tarea Programada diaria (ver register-backup-task.ps1), pero se
#  puede correr a mano cuando quieras:
#      powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
#
#  Requisitos: Docker Desktop corriendo (contenedor laceleste_movimientos_db) y
#  Dropbox instalado/logueado (para que sincronice la carpeta).
#  NOTA: sin acentos ni caracteres no-ASCII a proposito (Windows PowerShell 5.1 lee
#  el .ps1 como ANSI y se rompe con UTF-8).
# ============================================================================
$ErrorActionPreference = 'Stop'

$Contenedor    = 'laceleste_movimientos_db'
$DbUser        = 'laceleste'
$DbName        = 'laceleste_movimientos'
$RetencionDias = 14

$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'backup-db.log'

function Escribir($msg) {
  $linea = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $linea
  Write-Host $linea
}

# Carpeta destino dentro de Dropbox (se sube off-site sola).
$dropbox = Join-Path $env:USERPROFILE 'Dropbox'
if (-not (Test-Path $dropbox)) { Escribir "AVISO: no encuentro $dropbox (Dropbox no instalado?). El backup igual queda local." }
$destDir = Join-Path $dropbox 'laceleste-backups'
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd_HHmm'
$nombre = "laceleste_$stamp.dump"
$destino = Join-Path $destDir $nombre
$tmpEnContenedor = "/tmp/$nombre"

try {
  Escribir "==== inicio backup ===="

  # 1) Dump DENTRO del contenedor (binario, sin pasar por redireccion de PowerShell
  #    que corromperia el archivo con UTF-16).
  & docker exec $Contenedor pg_dump -U $DbUser -Fc -f $tmpEnContenedor $DbName
  if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo (exit $LASTEXITCODE)" }

  # 2) Verificar que el dump es un archivo valido (lista la TOC).
  & docker exec $Contenedor pg_restore -l $tmpEnContenedor | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "el dump no valida con pg_restore -l (exit $LASTEXITCODE)" }

  # 3) Copiar al host (Dropbox) y limpiar el temporal del contenedor.
  & docker cp "${Contenedor}:${tmpEnContenedor}" $destino
  if ($LASTEXITCODE -ne 0) { throw "docker cp fallo (exit $LASTEXITCODE)" }
  & docker exec $Contenedor rm -f $tmpEnContenedor | Out-Null

  $kb = [math]::Round((Get-Item $destino).Length / 1KB, 1)
  Escribir ("OK -> {0} ({1} KB)" -f $destino, $kb)

  # 4) Rotacion por edad: borrar dumps de mas de $RetencionDias dias. Por EDAD (no
  #    por cantidad) para que un backup fallido no borre los buenos anteriores.
  $limite = (Get-Date).AddDays(-$RetencionDias)
  $viejos = Get-ChildItem -Path $destDir -Filter 'laceleste_*.dump' | Where-Object { $_.LastWriteTime -lt $limite }
  foreach ($v in $viejos) { Remove-Item $v.FullName -Force; Escribir ("rotado (> {0} d): {1}" -f $RetencionDias, $v.Name) }

  Escribir "==== fin backup OK ===="
}
catch {
  Escribir ("ERROR: {0}" -f $_.Exception.Message)
  try { & docker exec $Contenedor rm -f $tmpEnContenedor 2>$null | Out-Null } catch {}
  exit 1
}
