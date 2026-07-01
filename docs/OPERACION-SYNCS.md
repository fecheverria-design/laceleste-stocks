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
- **El stock de un área quedó viejo tras borrar el real en su app:** la ventana móvil solo
  pisa lo que sigue presente; si borraron/pusieron en 0 el real, corregilo a mano editando o
  anulando el movimiento en el front. (Caso borde conocido, ver `docs/PROGRESO.md`.)
- **Sospecha de doble descuento:** no debería pasar (idempotencia por `(fecha,área)` /
  `recep:<id>`), pero se verifica con:
  ```sql
  SELECT idempotencia_key, count(*) FROM movimientos
  WHERE idempotencia_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
  ```
  (0 filas = sin duplicados.)

## A futuro

Cuando exista server propio (ej. `stock.laceleste.com.ar`, al lado de
`produccion.laceleste.com.ar`), mover estos syncs a **cron** en ese server: siempre on, sin
depender de la PC de J. La lógica (reconciliar + ventana móvil) no cambia; solo el disparador.
