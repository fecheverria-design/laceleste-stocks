#!/usr/bin/env bash
# ============================================================================
#  health-check.sh — Vigía de laceleste-movimientos (corre EN EL LXC)
# ----------------------------------------------------------------------------
#  Cron diario. Junta dos cosas y, si hay algo, manda UN mail:
#
#    [INFRA]  acá mismo: que el cron tenga sus líneas, que los contenedores
#             estén Up y que el backup de anoche exista en /opt/backups.
#    [DATOS]  backend/src/db/health-check.ts adentro del contenedor: frescura
#             del sync, renglones salteados por productos sin alta en el
#             maestro, áreas que no cerraron la sesión y productos caídos.
#
#  Manda mail SOLO si hay algo que reportar (no ensucia el inbox). Loguea todas
#  las corridas en /var/log/laceleste-health.log.
#
#  Reemplaza a scripts/health-check.ps1, que corría en la PC de J contra la DB
#  local: desde la mudanza al server esa DB quedó vieja y el vigía miraba al
#  lugar equivocado. Ahora vive donde vive la app y no depende de que la PC esté
#  prendida. Ver memory/automatizar-syncs-en-vivo.md.
#
#  Config (en /opt/laceleste/.env, las mismas claves de siempre):
#    ALERT_MAIL_TO, ALERT_MAIL_FROM, ALERT_SMTP_USER, ALERT_SMTP_PASS
#    ALERT_SMTP_HOST (default smtp.gmail.com), ALERT_SMTP_PORT (default 587)
#    SYNC_STALE_DIAS (default 2), DIAS_CAIDO (default 3)
#  ALERT_SMTP_PASS tiene que ser una CONTRASEÑA DE APLICACIÓN de Google (16
#  letras, sin espacios), no la clave normal de la cuenta.
#
#  Uso:
#    /opt/laceleste/scripts/health-check.sh          # chequea y manda si hay algo
#    /opt/laceleste/scripts/health-check.sh --dry    # muestra el mail, NO lo manda
# ============================================================================
set -uo pipefail

REPO=/opt/laceleste
COMPOSE="docker compose -f $REPO/docker-compose.prod.yml"
LOG=/var/log/laceleste-health.log
BACKUP_DIR=/opt/backups
DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# .env → variables de este shell (ignora comentarios y líneas vacías).
set -a
# shellcheck disable=SC1091
[ -f "$REPO/.env" ] && . "$REPO/.env"
set +a

log "==== INICIO health-check ===="
PROBLEMAS=""
add() { PROBLEMAS="${PROBLEMAS}* $1"$'\n\n'; }

# ── INFRA 1: el cron sigue teniendo sus líneas ────────────────────────────────
# El modo de falla real (2026-07-23) fue justamente este: el scheduler quedó
# apagado y nadie se enteró durante 5 días.
CRON=$(crontab -l 2>/dev/null)
FALTAN_CRON=""
for job in "sync:abastecimientos" "sync:recepciones" "backup-db.sh"; do
  if ! grep -q -- "$job" <<<"$CRON"; then
    add "Falta la línea de \"$job\" en el crontab del LXC (crontab -l). Sin eso no corre solo."
    log "  PROBLEMA: crontab sin $job"
    FALTAN_CRON="si"
  fi
done
[ -z "$FALTAN_CRON" ] && log "  OK: el crontab tiene los 2 syncs y el backup"
if ! systemctl is-active --quiet cron; then
  add "El servicio cron NO está activo en el LXC: nada automático está corriendo (systemctl status cron)."
  log "  PROBLEMA: cron inactivo"
fi

# ── INFRA 2: contenedores arriba ──────────────────────────────────────────────
CAIDOS_SVC=""
for svc in db backend web; do
  estado=$($COMPOSE ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$svc" '$1==s {print $2}')
  if [ "$estado" != "running" ]; then
    add "El contenedor \"$svc\" no está corriendo (estado: ${estado:-ausente}). Levantalo con: cd $REPO && $COMPOSE up -d"
    log "  PROBLEMA: contenedor $svc en estado ${estado:-ausente}"
    CAIDOS_SVC="si"
  fi
done
[ -z "$CAIDOS_SVC" ] && log "  OK: los 3 contenedores (db, backend, web) corriendo"

# ── INFRA 3: backup de anoche ─────────────────────────────────────────────────
# El backup local es la primera capa; la segunda (Dropbox) la baja la PC de J.
ULTIMO_BK=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1)
if [ -z "$ULTIMO_BK" ]; then
  add "No hay ningún dump en $BACKUP_DIR. El backup local no está corriendo (/root/backup-db.sh, cron 3:30)."
  log "  PROBLEMA: sin dumps"
else
  EDAD_H=$(( ( $(date +%s) - $(stat -c %Y "$ULTIMO_BK") ) / 3600 ))
  if [ "$EDAD_H" -gt 36 ]; then
    add "El último backup local es de hace ${EDAD_H}h ($(basename "$ULTIMO_BK")). Debería ser de anoche (cron 3:30 AM)."
    log "  PROBLEMA: backup viejo (${EDAD_H}h)"
  else
    log "  OK: backup de hace ${EDAD_H}h ($(basename "$ULTIMO_BK"))"
  fi
fi

# ── INFRA 4: la copia OFF-SITE se está haciendo ───────────────────────────────
# La baja la PC de J (tarea "LaCeleste Backup Server offsite" → Dropbox) y toca esta
# marca al terminar bien. Si la PC deja de hacerlo, desde el server es invisible: pasó
# del 20 al 28/07 (la tarea moría por el corte de batería de Windows) y nadie se enteró.
MARCA=$BACKUP_DIR/.offsite-ok
if [ ! -f "$MARCA" ]; then
  add "No hay marca de copia off-site ($MARCA). Revisá la tarea \"LaCeleste Backup Server offsite\" en la PC (Dropbox)."
  log "  PROBLEMA: sin marca off-site"
else
  EDAD_OFF=$(( ( $(date +%s) - $(stat -c %Y "$MARCA") ) / 3600 ))
  if [ "$EDAD_OFF" -gt 36 ]; then
    add "La copia off-site a Dropbox no se hace desde hace ${EDAD_OFF}h. El backup local sigue, pero está TODO en el mismo server: si se pierde el LXC, se pierde todo. Revisá la tarea \"LaCeleste Backup Server offsite\" en la PC."
    log "  PROBLEMA: off-site viejo (${EDAD_OFF}h)"
  else
    log "  OK: copia off-site de hace ${EDAD_OFF}h"
  fi
fi

# ── DATOS: el chequeo que sabe de negocio, adentro del contenedor ─────────────
SALIDA=$(cd "$REPO" && $COMPOSE exec -T backend npm -w backend run --silent health-check 2>&1)
CODIGO=$?
# dotenvx escupe un banner ("◇ injected env ... // tip: ...") que no tiene nada que ver con
# el chequeo y ensucia el mail. Fuera.
SALIDA=$(grep -v '^◇' <<<"$SALIDA")
case $CODIGO in
  0)  log "  OK datos: $(head -1 <<<"$SALIDA")" ;;
  10) log "  PROBLEMAS de datos encontrados"
      PROBLEMAS="${PROBLEMAS}${SALIDA}"$'\n' ;;
  *)  add "El chequeo de datos no pudo correr (exit $CODIGO):"$'\n'"$SALIDA"
      log "  PROBLEMA: health-check.ts fallo (exit $CODIGO)" ;;
esac

# ── Resultado → mail (solo si hay algo) ───────────────────────────────────────
if [ -z "$PROBLEMAS" ]; then
  log "Todo OK — no se manda mail."
  log "==== FIN health-check ===="
  exit 0
fi

CANT=$(grep -c '^\*' <<<"$PROBLEMAS")
ASUNTO="[La Celeste] Alerta stock/sync ($CANT tema/s) - $(date '+%d/%m %H:%M')"
CUERPO="Chequeo automático de laceleste-movimientos ($(date '+%d/%m/%Y %H:%M'), server LXC 105).
Se detectaron $CANT tema(s):

$PROBLEMAS
--
Este aviso lo manda scripts/health-check.sh (cron del LXC).
Si algo ya lo resolviste, ignoralo: el próximo chequeo no lo vuelve a mandar."

log "RESUMEN: $CANT tema(s). Asunto: $ASUNTO"

if [ "$DRY" = "1" ]; then
  log "[--dry] NO se envía. Cuerpo del mail:"
  echo "$CUERPO" | tee -a "$LOG"
  log "==== FIN health-check ===="
  exit 0
fi

if [ -z "${ALERT_SMTP_PASS:-}" ] || [ -z "${ALERT_MAIL_TO:-}" ] || [ -z "${ALERT_SMTP_USER:-}" ]; then
  log "FALTA CONFIG DE MAIL (ALERT_MAIL_TO / ALERT_SMTP_USER / ALERT_SMTP_PASS en $REPO/.env). No se envió. Cuerpo:"
  echo "$CUERPO" | tee -a "$LOG"
  log "==== FIN health-check ===="
  exit 2
fi

SMTP_HOST=${ALERT_SMTP_HOST:-smtp.gmail.com}
SMTP_PORT=${ALERT_SMTP_PORT:-587}
FROM=${ALERT_MAIL_FROM:-$ALERT_SMTP_USER}

# curl habla SMTP con STARTTLS; el mensaje va por stdin con sus headers (RFC 5322).
# Date y To/Subject explícitos para que Gmail no lo mande a spam por malformado.
MAIL=$(printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n' \
  "$FROM" "$ALERT_MAIL_TO" "$ASUNTO" "$(date -R)" "$CUERPO")

if echo "$MAIL" | curl -s --show-error --ssl-reqd \
     --url "smtp://${SMTP_HOST}:${SMTP_PORT}" \
     --user "${ALERT_SMTP_USER}:${ALERT_SMTP_PASS}" \
     --mail-from "$FROM" --mail-rcpt "$ALERT_MAIL_TO" \
     --upload-file - >>"$LOG" 2>&1; then
  log "Mail enviado a $ALERT_MAIL_TO via ${SMTP_HOST}:${SMTP_PORT}."
else
  log "ERROR enviando el mail (ver detalle arriba). Cuerpo:"
  echo "$CUERPO" | tee -a "$LOG"
  log "==== FIN health-check ===="
  exit 3
fi

log "==== FIN health-check ===="
exit 0
