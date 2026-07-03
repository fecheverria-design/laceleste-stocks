@echo off
REM ============================================================================
REM  sync-live.cmd  -  Syncs "en vivo" de laceleste-movimientos (PULL app companiero)
REM ----------------------------------------------------------------------------
REM  Corre los DOS syncs en orden (abastecimientos + recepciones) en MODO
REM  RECONCILIAR con VENTANA MOVIL (hoy + VENTANA_DIAS_ATRAS dias atras, default 2).
REM  Lo dispara la Tarea Programada de Windows cada ~1h (ver laceleste-sync.xml).
REM
REM  - ESPERA a que el daemon de Docker este listo (lo LANZA si esta apagado),
REM    y a que Postgres acepte conexiones, ANTES de sincronizar. Sin esto, cada
REM    corrida caia con "Failed query ... usuarios" cuando Docker no estaba arriba.
REM  - Loguea TODO con timestamp en logs\sync-live.log (gitignored: *.log).
REM  - Reenvia los argumentos a ambos syncs: para probar sin escribir en la DB:
REM        scripts\sync-live.cmd --dry
REM
REM  Requisitos: .env en la raiz del repo, Docker Desktop instalado, npm en PATH
REM  (se cumple al correr como el usuario logueado).
REM ============================================================================
setlocal enabledelayedexpansion

REM Raiz del repo = carpeta padre de este script (scripts\..)
cd /d "%~dp0.."

if not exist "logs" mkdir "logs"
set "LOG=logs\sync-live.log"

echo.>> "%LOG%"
echo ================ INICIO %DATE% %TIME% ================>> "%LOG%"

REM --- 1) Asegurar el daemon de Docker (lanzarlo si esta apagado) ---
docker info >nul 2>&1
if errorlevel 1 (
  echo [%TIME%] Docker no responde: lanzando Docker Desktop...>> "%LOG%"
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)

set /a INTENTOS=0
:esperar_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
set /a INTENTOS+=1
if !INTENTOS! geq 36 (
  echo [%TIME%] ABORT: el daemon de Docker no levanto tras ~180s. La proxima corrida horaria reintenta.>> "%LOG%"
  echo ================ FIN    %DATE% %TIME% ================>> "%LOG%"
  endlocal
  exit /b 1
)
REM ~5s de espera (ping en vez de timeout, que falla sin consola bajo Task Scheduler)
ping -n 6 127.0.0.1 >nul
goto esperar_docker

:docker_ok
echo [%TIME%] docker daemon OK (tras !INTENTOS! reintento/s)>> "%LOG%"

REM --- 2) Asegurar el contenedor de Postgres (no-op si ya corre) ---
echo [%TIME%] docker compose up -d db>> "%LOG%"
call docker compose up -d db>> "%LOG%" 2>&1

REM --- 3) Esperar a que Postgres acepte conexiones (hasta ~30s) ---
set /a INTENTOS=0
:esperar_pg
docker exec laceleste_movimientos_db pg_isready -U laceleste >nul 2>&1
if not errorlevel 1 goto pg_ok
set /a INTENTOS+=1
if !INTENTOS! geq 15 (
  echo [%TIME%] WARN: Postgres no respondio pg_isready tras ~30s; intento sincronizar igual.>> "%LOG%"
  goto pg_ok
)
ping -n 3 127.0.0.1 >nul
goto esperar_pg
:pg_ok

REM --- 4) Sincronizar (ventana movil + reconciliar) ---
echo [%TIME%] sync:abastecimientos>> "%LOG%"
call npm -w backend run sync:abastecimientos -- %*>> "%LOG%" 2>&1

echo [%TIME%] sync:recepciones>> "%LOG%"
call npm -w backend run sync:recepciones -- %*>> "%LOG%" 2>&1

echo ================ FIN    %DATE% %TIME% ================>> "%LOG%"
endlocal
