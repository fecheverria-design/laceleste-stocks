# Operación de los syncs "en vivo"

Guía práctica para que el stock se mantenga sincronizado con la app del compañero
**todos los días, solo**. Pensada para la PC local de J (mientras no haya server propio).

## Qué corre y cuándo

- Una **Tarea Programada de Windows** llamada **`LaCeleste Sync en vivo`** dispara el script
  `scripts\sync-live.cmd` **cada 1 hora**, todos los días, indefinidamente.
- El script corre los dos syncs en orden (**abastecimientos** y **recepciones**) leyendo la
  API del compañero (`produccion.laceleste.com.ar`) y materializando los movimientos en
  nuestra DB. Es **PULL**: su app no se toca.
- Modo **reconciliar** + **ventana móvil**: cada corrida re-lee **hoy + los 2 días
  anteriores** y actualiza lo que haya cambiado (real corregido, renglones nuevos). Si algo
  ya estaba igual, no hace nada (no duplica, no ensucia el historial).
- **Bajas (recepciones):** si una recepción que ya habíamos traído **desaparece** de la app
  del compañero (la borraron), la corrida la **anula sola** acá y el stock se revierte. Si en
  cambio solo la **movieron de fecha**, no se toca: se avisa en el log (`⚠ … se movió del …
  al …`) y cuando esa fecha nueva entre en la ventana se corrige sola. Una recepción borrada
  no vuelve nunca (el id no se reusa), por eso ahí anular es definitivo.
- **Bajas (abastecimientos):** si **vacían un área entera** (borran todos los reales de ese
  día, o los ponen en cero), el RINT que teníamos se **anula** y el stock vuelve. Esto **sí es
  reversible**: si más tarde vuelven a guardar el real, la próxima corrida **revive** ese mismo
  movimiento y el stock se descuenta de nuevo. Dos seguros para que no dispare de más:
  - un día en que la API no devuelve filas (falla de red, servidor caído) **no anula nada**;
  - el sync solo revive **sus propias** bajas. Si vos anulaste un movimiento a mano desde el
    front, el sync **jamás** lo resucita (regla #4: la decisión humana manda).
- **Los movimientos importados de 3c no los toca ningún sync** (no tienen `idempotencia_key`).
  O sea que un día cargado a mano con `import:movimientos` está a salvo.

**Traducción a lo cotidiano:** vos no tenés que correr nada. Con la PC prendida y logueada,
el stock se actualiza solo cada hora. Lo único que hace falta es que **el real esté cargado
en la app del compañero** (cuando depósito completa la sesión); en la próxima corrida se
refleja acá.

## Requisitos para que corra siempre (ya configurados)

1. **PC prendida y con el usuario logueado.** La tarea corre con tu sesión (así ve Docker);
   no guarda contraseña. Si apagás la PC, no se pierde nada: al volver, la tarea arranca
   apenas puede (opción *StartWhenAvailable*) y la ventana móvil recupera los días que se
   perdió. Solo se pierde *frescura* mientras estuvo apagada.
2. **Docker Desktop arranca con Windows.** Ya quedó configurado (acceso directo en la carpeta
   de Inicio + `AutoStart` de Docker en true). El script igual intenta levantar el contenedor
   de Postgres en cada corrida por las dudas.
3. **`.env` en la raíz del repo** con las credenciales del compañero y la config. No se
   commitea; si se pierde, ver `.env.example`.

## Chequeo diario (30 segundos)

Abrí PowerShell en la carpeta del repo y mirá la última corrida:

```powershell
cd D:\Bibliotecas\Desktop\Appstocks
Get-Content logs\sync-live.log -Tail 40
```

Buscá al final de cada corrida líneas como
`N movimiento(s), M renglón(es)` (abastecimientos) y `N recepción(es)…` (recepciones), sin
`con error`. Para ver estado y próxima corrida de la tarea:

```powershell
Get-ScheduledTaskInfo -TaskName "LaCeleste Sync en vivo"
# LastTaskResult 0 = ok | NextRunTime = próxima corrida
```

También podés verlo en la GUI: **Programador de tareas** → Biblioteca → `LaCeleste Sync en vivo`.

## Comandos útiles

```powershell
# Correr AHORA a mano (además del horario)
Start-ScheduledTask -TaskName "LaCeleste Sync en vivo"

# Probar SIN escribir en la DB (dry-run): muestra qué haría
scripts\sync-live.cmd --dry

# Correr un día puntual o un rango a mano (no toca la tarea horaria)
npm -w backend run sync:abastecimientos -- --fecha=2026-07-01
npm -w backend run sync:recepciones -- --desde=2026-06-20 --hasta=2026-06-30
```

## Ajustes

- **Cambiar la frecuencia** (ej. cada 30 min): editar `<Interval>PT1H</Interval>` →
  `PT30M` en `scripts\laceleste-sync.xml` y volver a registrar:
  `powershell -ExecutionPolicy Bypass -File scripts\register-sync-task.ps1`.
- **Cambiar cuántos días atrás mira la ventana móvil:** setear `VENTANA_DIAS_ATRAS` en el
  `.env` (default 2).
- **Reinstalar / actualizar la tarea:** `register-sync-task.ps1` (usa `-Force`, la pisa).
- **Borrar la tarea:** `Unregister-ScheduledTask -TaskName "LaCeleste Sync en vivo" -Confirm:$false`.

## Si algo falla

- **`LastTaskResult` distinto de 0 o errores en el log:**
  - `docker ... daemon` / `connection refused` → Docker no estaba levantado. Abrí Docker
    Desktop y esperá a que quede "running"; la próxima corrida se recupera sola.
  - `Login … falló` → revisar credenciales del compañero en `.env` (`COMPANERO_API_*`).
  - `PRODUCTO_NO_ENCONTRADO` en abastecimientos → falta ese producto en nuestro maestro
    (importarlo). En recepciones ese renglón se saltea solo (no frena la recepción).
- **El stock de un área quedó viejo tras borrar el real en su app:** ya no hace falta tocar
  nada a mano — la reconciliación de bajas lo anula solo en la próxima corrida (y lo revive si
  el real vuelve). Ver "Bajas (abastecimientos)" arriba.
- **Sospecha de doble descuento:** no debería pasar (idempotencia por `(fecha,área)` /
  `recep:<id>`), pero se verifica con:
  ```sql
  SELECT idempotencia_key, count(*) FROM movimientos
  WHERE idempotencia_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
  ```
  (0 filas = sin duplicados.)
- **`⚠ recep #N: X ítem(s) SIN cantidad (sin BPM)` en el log → la recepción entró INCOMPLETA.**
  La cantidad recibida **solo** vive en el BPM de su app: un ítem que no pasó por control BPM
  no tiene cantidad en ningún lado, así que es imposible traerlo (no se inventa). Esos
  renglones hay que cargarlos del **export de 3c**: `npm run import:movimientos -- <archivo.tsv>`
  (probá primero con `--dry`, que ahora sí no escribe nada). **Ojo:** el import de 3c dedup por
  `nro_3c`, y lo que trajo el sync tiene `nro_3c` nulo → **anulá primero la recepción del sync**
  o vas a duplicar.

## Backups y recuperación

**Dónde vive todo:** una sola base PostgreSQL 16 en Docker, en el volumen
`laceleste_movimientos_pgdata`, que físicamente está en **D:**
(`D:\DockerData\DockerDesktopWSL\disk\docker_data.vhdx`). No en C:. La base es chica (~30 MB).

**Backup automático (ya configurado):** la tarea **`LaCeleste Backup DB`** corre
`scripts\backup-db.ps1` **todos los días a las 13:00**. Hace un `pg_dump -Fc` (comprimido,
~1,5 MB), lo **verifica** con `pg_restore -l` y lo copia a
`C:\Users\MSI\Dropbox\laceleste-backups\` → **Dropbox lo sube a la nube (off-site)**. Rota
solo: borra los de más de 14 días. Requiere Docker corriendo y **Dropbox abierto/logueado**.

```powershell
# Backup a mano cuando quieras (además del diario)
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
Get-Content logs\backup-db.log -Tail 20            # ver resultado
Get-ScheduledTaskInfo -TaskName "LaCeleste Backup DB"
```

> ⚠️ **El backup depende de que Dropbox esté corriendo y sincronizando.** Cada tanto,
> confirmá en el ícono de Dropbox que la carpeta `laceleste-backups` está al día (tilde
> verde). Si Dropbox está cerrado, el dump queda solo local (no off-site).

**Restaurar un backup** (recuperar la base de un `.dump`):

```powershell
# 1) Elegí el dump (de Dropbox\laceleste-backups) y copialo al contenedor
docker cp "C:\Users\MSI\Dropbox\laceleste-backups\laceleste_YYYYMMDD_HHMM.dump" laceleste_movimientos_db:/tmp/restore.dump
# 2) Restaurá encima de la base actual (--clean pisa lo que haya)
docker exec laceleste_movimientos_db pg_restore -U laceleste -d laceleste_movimientos --clean --if-exists /tmp/restore.dump
# 3) Refrescá la vista de stock
docker exec laceleste_movimientos_db psql -U laceleste -d laceleste_movimientos -c "REFRESH MATERIALIZED VIEW stock_actual;"
```

**Recuperación total en una PC nueva** (si se pierde/rompe la máquina):
1. Instalar Docker Desktop + clonar el repo + poner el `.env`.
2. `docker compose up -d` (crea la base vacía con las migraciones del init).
3. Bajar el último `.dump` de Dropbox y correr el `pg_restore` de arriba.

**Trazabilidad:** dentro de la base, `movimientos_auditoria` guarda quién/cuándo/qué en cada
edición, y toda anulación sella `anulado_por`/`anulado_en`. Esa historia viaja dentro del
`.dump`, así que los backups también preservan el rastro de cambios.

## A futuro

Cuando exista server propio (ej. `stock.laceleste.com.ar`, al lado de
`produccion.laceleste.com.ar`), mover estos syncs a **cron** en ese server: siempre on, sin
depender de la PC de J. La lógica (reconciliar + ventana móvil) no cambia; solo el disparador.
El backup también convendría moverlo ahí (y/o a un bucket cloud) en esa etapa.
