@echo off
REM ============================================================================
REM  sync-live.cmd  -  Syncs "en vivo" de laceleste-movimientos (PULL app companiero)
REM ----------------------------------------------------------------------------
REM  Corre los DOS syncs en orden (abastecimientos + recepciones) en MODO
REM  RECONCILIAR con VENTANA MOVIL (hoy + VENTANA_DIAS_ATRAS dias atras, default 2).
REM  Lo dispara la Tarea Programada de Windows cada ~1h (ver laceleste-sync.xml).
REM
REM  - Se asegura de que el Postgres de Docker este levantado (best-effort).
REM  - Loguea TODO con timestamp en logs\sync-live.log (gitignored: *.log).
REM  - Reenvia los argumentos a ambos syncs: para probar sin escribir en la DB:
REM        scripts\sync-live.cmd --dry
REM
REM  Requisitos: .env en la raiz del repo, Docker Desktop corriendo, npm en PATH
REM  (se cumple al correr como el usuario logueado).
REM ============================================================================
setlocal

REM Raiz del repo = carpeta padre de este script (scripts\..)
cd /d "%~dp0.."

if not exist "logs" mkdir "logs"
set "LOG=logs\sync-live.log"

echo.>> "%LOG%"
echo ================ INICIO %DATE% %TIME% ================>> "%LOG%"

REM Asegura el contenedor de Postgres (no-op si ya esta corriendo; falla suave si
REM el daemon de Docker esta caido -> los syncs loguean el error y la proxima
REM corrida horaria + ventana movil recuperan lo que se haya perdido).
echo [%TIME%] docker compose up -d db>> "%LOG%"
call docker compose up -d db>> "%LOG%" 2>&1

echo [%TIME%] sync:abastecimientos>> "%LOG%"
call npm -w backend run sync:abastecimientos -- %*>> "%LOG%" 2>&1

echo [%TIME%] sync:recepciones>> "%LOG%"
call npm -w backend run sync:recepciones -- %*>> "%LOG%" 2>&1

echo ================ FIN    %DATE% %TIME% ================>> "%LOG%"
endlocal
