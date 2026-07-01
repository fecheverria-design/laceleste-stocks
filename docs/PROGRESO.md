# PROGRESO — laceleste-movimientos

> Estado para retomar fácil. Última actualización: 2026-07-01.

## ⏭️ PRÓXIMO PASO (retomar acá — 2026-07-01) — PASO 2: registrar la tarea
El **PASO 1 (modo reconciliar + ventana móvil) y los artefactos del scheduler están
HECHOS** (ver abajo). Lo único que falta es la **acción manual de J: registrar la tarea**
en su PC (un comando) y confirmar que corre.

**Registrar (una vez, en PowerShell como el usuario que queda logueado):**
```
cd D:\Bibliotecas\Desktop\Appstocks
powershell -ExecutionPolicy Bypass -File scripts\register-sync-task.ps1
```
Probar a mano: `Start-ScheduledTask -TaskName "LaCeleste Sync en vivo"` y mirar
`logs\sync-live.log`. Ajustar frecuencia (ej. cada 30 min) editando el `<Interval>` del
XML y re-registrando.

## ✅ PASO 2 — Scheduler de Windows (artefactos) — HECHO (2026-07-01), falta registrar
Todo en `scripts/` (versionado):
- **`sync-live.cmd`**: wrapper que corre los DOS syncs en orden (abastecimientos +
  recepciones), asegura el Postgres de Docker (`docker compose up -d db`, best-effort) y
  loguea con timestamp en `logs/sync-live.log` (gitignored: `*.log`). **Reenvía argumentos**
  → probar sin escribir: `scripts\sync-live.cmd --dry`. Corre los syncs **sin `--fecha`** →
  usan la **ventana móvil** (hoy + `VENTANA_DIAS_ATRAS`, default 2).
- **`laceleste-sync.xml`**: definición de la tarea. Cada **1h** (`<Interval>PT1H</Interval>`
  sin Duration = indefinido), **`StartWhenAvailable=true`** (= "run ASAP after a missed
  start": si la PC estuvo apagada, corre apenas puede), `MultipleInstancesPolicy=IgnoreNew`
  (no se apilan si una corrida se demora), `LogonType=InteractiveToken` (corre con la
  sesión del usuario → ve Docker Desktop; NO guarda contraseña), `RunOnlyIfNetworkAvailable`.
  La ruta del `<Command>` es la de la PC de J (`D:\Bibliotecas\...`); si el repo se mueve,
  actualizarla.
- **`register-sync-task.ps1`**: importa el XML a nombre del usuario actual (`-Force` para
  actualizar; sin password). Imprime la próxima corrida y los comandos útiles.
- **Smoke-test OK (2026-07-01)**: `sync-live.cmd --dry` corrió end-to-end → Docker up,
  ventana móvil (2026-06-29…07-01), login OK a `produccion.laceleste.com.ar`, 8 abast /
  123 renglones + 14 recep / 44 renglones en dry (nada escrito), exit 0.

Apagar la PC ≠ perder datos: la fuente de verdad es SU server (siempre on); al volver, la
ventana móvil re-lee y reconcilia. Solo se pierde *frescura* mientras está apagada. A
futuro: mover esto a un server propio (`stock.laceleste.com.ar`) con cron real, al lado de
la app del compañero (`produccion.laceleste.com.ar`).

## ✅ PASO 1 — Syncs "en vivo" (modo RECONCILIAR + ventana móvil) — HECHO (2026-07-01)
El bloqueo era que los syncs eran **"crear una vez"** (idempotencia: abast por
`(fecha,área)`, recep por `recep:<id>`) → re-correr el mismo día NO incorporaba lo cargado
después de la 1ª corrida. Resuelto:
- **Modo RECONCILIAR (opt-in) en `registrarAutoConfirmado`** (`movimientos.service.ts`):
  en el hit de idempotencia, si viene `{ reconciliar: true }` y el movimiento **no** está
  ANULADO, en vez de devolverlo tal cual lo **reedita** con el estado fresco de su app
  (real corregido / renglones nuevos). Sin cambios = **no-op** (el diff da vacío, no
  escribe auditoría). Un ANULADO a mano **no se resucita** (se devuelve tal cual, el sync
  no lo cuenta como error). El POST M2M sigue en "crear una vez" (default `reconciliar:false`).
- **Transacción anidada resuelta por refactor (no savepoints):** se extrajo el cuerpo de
  `editarMovimiento` a un helper **`aplicarEdicion(tx, …)`** que opera dentro de una tx ya
  abierta. `editarMovimiento` quedó como wrapper que abre la tx y delega; el modo
  reconciliar llama a `aplicarEdicion` con **el mismo `tx`** del registro → una sola
  transacción, sin anidar. (Llamar a `editarMovimiento` desde otra tx habría abierto una
  tx separada en otra conexión: no vería lo no-commiteado y podría trabarse.)
- **Ventana móvil en los scripts** (`sync-abastecimientos.ts` / `sync-recepciones.ts`):
  sin argumentos, barren **hoy + `VENTANA_DIAS_ATRAS` días atrás** (default 2, configurable
  por `.env`) → autorrecuperan días perdidos si la PC estuvo apagada; días sin novedad =
  no-op. `--fecha` y `--desde/--hasta` siguen funcionando igual. Ambos scripts llaman al
  service con `{ reconciliar: true }`.
- **Tests (regla #5):** `tests/reconciliacion.service.test.ts` — real corregido reedita +
  ajusta stock + 1 fila de auditoría; sin cambios = no-op (0 auditoría); renglón nuevo
  aparece en detalle+stock sin tocar el existente; sin `reconciliar` = idempotencia clásica
  (no reedita); ANULADO respetado (no resucita, no error). **89 tests verdes** (+5).
- **Caso borde NO cubierto (a propósito):** si el compañero **borra/pone en 0** el real de
  un área ya sincronizada, esa área desaparece de su tabla → el sync no la ve → **no la
  reconcilia** (queda el valor viejo). Reconciliar solo pisa lo que sigue presente. Cubrirlo
  exige comparar contra lo ya materializado del día (bastante más laburo). Anotado; fuera de
  este paso. Se corrige a mano editando/anulando el movimiento en el front si pasa.

## 🔌 INTEGRACIÓN PULL app del compañero — PROBADA E2E (2026-06-30)
Script `npm run sync:abastecimientos -- --fecha=YYYY-MM-DD [--dry]` (o `--desde/--hasta`)
en `backend/src/db/sync-abastecimientos.ts` (commit `e2ae994`). Lee SU API REST
(`app_ordenes_produccion`) y materializa los abastecimientos como **RINT auto-confirmados**
que descuentan stock de FABRICA por `cantidad_real`. PULL puro: su app es read-only, no se toca.
- **Config (.env, no commiteado):** `COMPANERO_API_URL=https://produccion.laceleste.com.ar`
  (host base **sin** `/api` — el script le pega `/api` solo), usuario de servicio `compras`,
  y **`DEPOSITO_PRINCIPAL_DEP_ID_3C=1`** (FABRICA = origen; sin esto el run real tira
  `ORIGEN_REQUERIDO`, el dry no lo detecta).
- **Corrida real semana 06-23 a 06-29:** 25 RINTs (`RINT-2026-03783`…`03807`), 430 renglones,
  0 errores. Áreas destino 47 Panadería / 48 Pastelería / 49 Recetas / 50 Sandwichería
  (`codigo_3c_area` == dep_id_3c confirmado). Backup previo `backup_pre_sync_abast_20260630.dump`.
  Sin doble descuento (0 RINTs previos en esas fechas; el export 3c era anterior).
- **Operación diaria:** correr con `--fecha=<hoy>` cuando el real ya esté cargado en su app
  (idempotente: re-correr no duplica). Pendiente: J contrasta totales por área/día contra 3c.

### Recepciones (la otra pata) — PROBADA E2E (2026-06-30)
Script `npm run sync:recepciones -- --fecha=YYYY-MM-DD [--dry]` (commit `feat(sync): PULL de
recepciones`). Materializa **RECEPCION auto-confirmada** que **suma** stock a FABRICA.
- **Su modelo es distinto al de abastecimiento:** la recepción es agenda + checklist de estados;
  la CANTIDAD solo vive en la tabla `bpm` (`cantidad_total`, unidades base), y solo para ítems
  que pasaron por control BPM/pesado. Por eso el sync hace 2 pasos: `GET /api/recepciones?fecha=`
  (agenda) + `GET /api/bpm/recepcion/:id` (cantidades). Solo materializa ítems con BPM y
  cantidad>0; pre-filtra productos que no estén en nuestro maestro (saltea ese renglón, no pierde
  la recepción). Origen = `RECEPCION_ORIGEN_DEP_ID_3C` (default 102, balde proveedores sin stock),
  destino = FABRICA. Idempotente por `recep:<id>`.
- **Refactor del service:** se extrajo `registrarAutoConfirmado` (núcleo tx/idempotencia/stock
  compartido) y se sumó `registrarRecepcion` + `RecepcionSchema`, espejo de abastecimiento. El
  stock se mueve por DIRECCIÓN (la matview `stock_actual` ignora `signo_stock`): recepción suma
  al destino, abastecimiento resta del origen.
- **Corrida real semana 06-23 a 06-29:** 43 RECEPCION (`REC-2026-00578`…`00620`), 95 renglones,
  0 errores, 5 recepciones sin BPM/cantidad (salteadas). Backup `backup_pre_sync_recep_20260630.dump`.
  Sin doble conteo (0 RECEPCION previas en el rango). **84 tests verdes** (+6 de recepción).
- **Pendiente:** J contrasta totales por proveedor/día contra 3c. A futuro: ¿mapear
  `cod_proveedor` → acopio puntual (dep_id_3c) en vez del balde 102 genérico?

## 🚩 CIERRE FASE 1 — PR a `dev` (2026-06-25)
Branch `feat/movimientos-fase1-backend` listo para PR a `dev`. **72 tests verdes**,
typecheck/lint/build limpios (back y front). Lo construido en Fase 1 (además del backend
de movimientos/auth/stock):
- **Panel** (landing) con valorización del stock a precio vigente + gráficos (Recharts).
- **Precios**: histórico con tipo COMPRA/ACTUALIZACION (vigente = última compra), gráfico
  de compras, alta/edición; importer `import:precios`.
- **Consumos por área**: cantidad + promedio semanal + **costo $ por área** (cantidad ×
  precio vigente, comparable).
- **Proveedores**: gasto real por familia (de compras reales), vista mensual + período,
  alta de proveedor (numero_3c obligatorio); tabla `compras` + `import:compras`.
- **Calidad de datos**: fix de fusión de movimientos por NUMERO, ajustes vía balde 101,
  devoluciones invertidas, conteo autoritativo de acopios (`--exclusivo`). Ver
  `docs/IMPORTACION-3C.md`.
- Datos reales de J cargados: ~17.585 movimientos, 13.160 precios, 11.601 compras,
  inventario anclado (0 negativos).
- **Acción manual de J**: pushear branch (hecho por la sesión si hubo credenciales) y
  crear el PR en GitHub (no hay `gh`). Pendientes menores: asegurar M2M `abastecimientos`
  (API key + idempotencia), ~35 productos sin precio (one-off, cargar a mano si importan).

### 🆕 Sesión 2026-06-25 — Calidad de datos de movimientos (importante)
Se corrigieron varios temas de cómo se interpreta el histórico de 3c. **Todo documentado
en `docs/IMPORTACION-3C.md`** (fuente única de las reglas de import — leer ahí si un
movimiento/stock aparece mal).
- **Bug de fusión**: el NUMERO de 3c es único por tipo de documento, no global → se
  fusionaban ~484 movimientos. Fix: agrupar por (tipo+numero+dirección).
- **Ajustes**: en 3c vienen como `Rint` desde el balde 101 → ahora se clasifican AJUSTE
  (101→FABRICA suma, FABRICA→101 resta).
- **Devoluciones**: cantidad negativa → se invierte la dirección (antes se descartaban).
- **Acopios**: `import:inventario --exclusivo` (conteo autoritativo por depósito).
- **Método de re-sync sin mover stock**: foto → wipe → reimport → re-anclar `--exclusivo`
  (detallado en IMPORTACION-3C.md). El stock quedó idéntico (430 ítems, 0 negativos) y el
  histórico completo: 15.849 movimientos → **17.585** (se recuperó lo fusionado + splits).
- Backups: `backup_pre_resync_20260625.dump` (gitignored).

## ⏱️ AL VOLVER — empezá por acá
**Estado**: Fase 1 + import 3c + inventario + **módulo de PRECIOS (histórico con tipo COMPRA/ACTUALIZACION)** + **PANEL con valorización y gráficos (Recharts)**. Todo commiteado en `feat/movimientos-fase1-backend`. **70 tests verdes.**

### 🆕 Sesión 2026-06-24 — Precios + Panel + limpieza de datos
- **Módulo de precios** (migraciones `0006`–`0008`): tabla `precios` con `proveedor_id` + `tipo` (COMPRA|ACTUALIZACION) + fecha. **Vigente = última COMPRA** (lo que se pagó); si no hubo compra, cae a la última ACTUALIZACION (referencia). Endpoints `GET /api/precios`, `GET /api/productos/:cod/precios`, `POST/PUT/DELETE /api/precios`. Front: tab **Precios** (tabla + historial editable + gráfico de COMPRAS, Recharts lazy).
- **Importer** `npm run import:precios -- <archivo> [--dry]`: formato histórico (`ID, PRECIO_UNITARIO, PERSONAS_ID, PROVEEDORES, FECHA, TIPO`). Idempotente (upsert por producto+proveedor+fecha+tipo). **Cargado el histórico real: 13.160 precios** (9.506 compras), 653 prod / 701 prov.
- **Panel** (tab inicial, landing): `GET /api/valorizacion` = stock × precio vigente. KPIs + barras top productos + tabla por depósito. `$0 = sin precio`. **Total actual ~$577M**, 35 ítems con stock sin precio.
- **Limpieza de datos ficticios**: se borraron 27 ajustes de prueba (AJU) + se recargó la foto de inventario desde archivo corregido (`Hoja de cálculo sin título - STOCKS.csv`) + correcciones manuales de escala (CAFE/BONDIOLA/PURE/PAPEL ALFAJOR en FABRICA). Backups: `backup_pre_limpieza.dump`, `backup_fin_dia_20260624.dump` (gitignored).
- **⏳ Pendiente p/ mañana**: (a) ver los 35 productos con stock sin precio; (b) 5 negativos de packaging en acopios (CAJA TORTA, BOLSA DELIVERY… — poner en 0 o conteo real); (c) precio mayonesa $2.452 vs $3.028 si hace falta; (d) ¿productos solo-ACTUALIZACION muestran esa como referencia? (hoy: sí).

1. **✅ INVENTARIO INICIAL — HECHO (2026-06-22)**. Se cargó la "foto" del inventario físico vía `import:inventario`. Quedó **0 negativos** en todo el sistema. **Decisión de J: stock real = solo FABRICA, pero los acopios se llevan EN PARALELO** (cada depósito de proveedor lleva su propio stock; ej. al recibir mercadería poniendo origen 210 Morrovalle en vez del 102 genérico, se descuenta del acopio del 210). El import enciende `lleva_stock` en todos los depósitos del archivo (15 hoy: FABRICA + 14 acopios). Cinco productos quedaron negativos en acopios (historial de 3c sin conteo) → **J decidió ponerlos en 0** (acopio agotado, un negativo es físicamente imposible). Detalle del importer en "FASE DE PRECISIÓN DE STOCK".
2. **Estado de la importación de 3c** (corrida en el dev de J): productos, proveedores, ubicaciones y **15.849 movimientos** importados. Tipos mapeados: Rint→RINT, ReMe/Fcpr→RECEPCION, RINV→AJUSTE. **NCC queda afuera** (módulo facturas futuro). Solo FABRICA lleva stock (`npm run db:stock-en -- 1`). ⚠️ El dev tiene los datos REALES de J (no la demo).
3. **🔴 ACCIÓN MANUAL DE J — cambiar default branch a `main` en GitHub**: `main` y `dev` ya están pusheados, pero `gh`/token no están. Settings → Branches → Default → `main`. Después borrar `feat/movimientos-fase0-setup`. PR de Fase 1: base `dev` ← `feat/movimientos-fase1-backend`.
4. **Otros slices pendientes** (cuando se cierre el stock): módulo de facturas (NCC).
   - ✅ **Idempotencia + API key M2M del POST de abastecimientos — HECHO** (commit `6505622`).
   - ✅ **Export de listado a CSV/Excel — HECHO**: `GET /api/movimientos/export.csv` (mismos
     filtros del listado) + botón "Exportar Excel" en el front. CSV afinado para Excel es-AR
     (BOM UTF-8, separador `;`, coma decimal). **Decisión de J (2026-07-01): dejarlo así**
     (no pasar a `.xlsx` nativo por ahora).
   - ✅ **Validación del form (crear/editar) — HECHA y cableada**: `validar()`/`tieneErrores()`
     en `movimientoForm.ts`, usada en `NuevoMovimientoPage` y `MovimientoDetallePage`; bloquea
     el submit y muestra errores por campo (`MovimientoFormFields`). Refleja el schema Zod
     (regla #8). **Decisión de J (2026-07-01): dejarla así** (no sumar chequeos finos).
   - ⏳ **Kardex por producto** (libro mayor con saldo corriendo) — **el único real pendiente**
     de este bloque; no pedido aún.
5. **Setup**: Docker desde `D:\DockerData` (`docker compose up -d`). Backend `npm -w backend run dev` (3000) + front `npm -w frontend run dev` (5173) → http://localhost:5173. Login: `admin@laceleste.local` / `laceleste123`. Para volver a datos demo: `npm -w backend run db:reset` + `db:seed:dev`. Comandos de import: `import:productos|proveedores|ubicaciones|movimientos` y `db:stock-en`.

## 📥 Importación de Excel — productos (HECHO, falta proveedores y movimientos)
Carga masiva por scripts CLI locales (decisión de J). Parser propio sin deps.
- **`npm run import:productos -- <archivo.csv|tsv>`**: maestro de productos de 3c. Mapea `ID`→`codigo_3c` (PK, regla #1), `ARTICULO`→nombre, `UM`→`unidad_base`. Ignora FAMILIA/SUBFAMILIA (no modeladas). Idempotente (upsert por `codigo_3c`), dedup intra-archivo, saltea filas sin ID/nombre. Probado con muestra real de J.
- **`csv.ts`**: parser de texto delimitado robusto (autodetecta tab/`;`/`,`, comillas, BOM) — lo reusan los próximos importers.
- **`npm run import:proveedores -- <archivo>`**: maestro de proveedores de 3c. Mapea `NUMERO`→`numero_3c`, `NOMBRE`→nombre, `CUIT`→cuit (`-`/vacío→null). Resto de columnas (ingbruto, tipo_iva, teléfono, mail, categoría…) ignoradas. Idempotente (upsert por `numero_3c`). **Migración `0003`**: agrega `proveedores.numero_3c` (unique, regla #1). Probado con muestra real (dedup, skip, nombre con coma, CUIT con/sin guiones).
- **`npm run import:ubicaciones -- <archivo>`**: `TIPO_DEPOSITO`(PROPIOS→DEPOSITO / EXTERNOS→AREA), `DENOMINACION`→nombre, `DEPOSITO_ID`→`dep_id_3c`. Idempotente (upsert por dep_id_3c, **migración `0004`** lo hace unique).
- **`npm run import:movimientos -- <archivo>`**: una fila = un renglón, agrupa por `NUMERO` (→`nro_3c`). Mapea `TIPO_DOC`→tipo, `FECHA` dd/mm/yyyy→ISO, `ORIGEN`/`DESTINO`→dep_id_3c, `ARTICU_ID`→producto, `CANTIDAD` (coma decimal es-AR). **Auto-crea** ubicaciones (DEPOSITO si es origen, si no AREA) y productos (desde TEXTO/UNIMED) que falten. Entra CONFIRMADO con su fecha + nro propio (`generar_nro`, crea seq del año on-demand) + `nro_3c`. Idempotente (saltea NUMERO ya importado). REFRESH al final. Avisa TIPO_DOC no mapeados.
- **Verificado e2e** con muestra real de J: 4 movimientos (RINT-2025-xxxxx + nro_3c), áreas 47/48/50 auto-creadas, 10 productos auto-creados, stock con decimales OK (-7.428), idempotencia OK.
- **Pendiente / a definir**: la lista de ubicaciones de J no traía las áreas de producción (47/48/50) — se auto-crean como AREA; si querés tipos/nombres finos, pasá un export más completo. Otros `TIPO_DOC` además de "Rint" (Recepcion/Ajuste): confirmar los textos exactos. **Precios = fase futura** (columna nueva en productos).
- ⚠️ **El dev DB se reseteó** (se borró la demo) y quedó con la muestra real de J. Para volver a la demo: `npm run db:seed:dev`. Para cargar todo lo real: correr los 4 imports + `db:reset` si te equivocás.

## 🎯 FASE DE PRECISIÓN DE STOCK (pendiente, próximo bloque)
Modelo de 3c confirmado por J (claves para que el stock dé bien):
- **Baldes virtuales**: `dep_id_3c = 101` = **AJUSTES**, `dep_id_3c = 102` = **PROVEEDORES**. Su stock propio no importa; el efecto cae siempre en el otro lado (depósito real).
- **Recepción** (`ReMe`/`Fcpr`): `102 → FABRICA`, suma al destino. ✅ ya funciona (RECEPCION).
- **Rint**: `FABRICA → área`, resta del origen. ✅ ya funciona.
- ✅ **HECHO — modelo de stock reescrito (migración `0005`)**: doble entrada restringida a `ubicaciones.lleva_stock`. La dirección define el signo (suma al destino, resta del origen, solo si lleva stock). Esto arregla de una los ajustes (101↔FABRICA), recepciones (102→FABRICA) y rint, sin importar el tipo. `npm run db:stock-en -- 1` define que **solo FABRICA** lleva stock. 50 tests verdes (2 nuevos del modelo).
- ✅ **Inventario inicial — HECHO (2026-06-22)** vía `npm run import:inventario -- <archivo> [--dry]` (`import-inventario.ts`). Columnas: `DEPOSITO` (= dep_id_3c; 1=FABRICA, resto=acopios de proveedores), `3C` (producto), `STOCK` (contado); opcionales `FECHA`/`DENOMINACION`/`AÑO`/`MES`. Por cada (producto, depósito) genera un **AJUSTE = contado − sistema** contra el balde 101 (entrada 101→D si falta, salida D→101 si sobra; a lo sumo 2 movs por depósito). **Activa `lleva_stock` en todos los depósitos del archivo** (additivo) → multi-depósito vivo. Auto-crea productos/depósitos faltantes. `--dry` muestra el plan sin escribir. Idempotente si se re-corre sin movimientos intermedios (delta=0 no genera mov). Verificado e2e con datos reales: FABRICA de 393 neg → 0; 15 depósitos con stock; 0 negativos totales tras poner en 0 los 5 acopios sin conteo.

## 🖥️ Front — crear movimiento (HECHO)
- **`POST /api/movimientos`** (back): crea un movimiento de cualquier tipo, **auto-confirmado** y transaccional (correlativo según tipo + cabecera CONFIRMADO + detalle + refresh de stock). Cualquier usuario logueado. Hermano de `registrarAbastecimiento` (caso M2M de RINT). 4 tests nuevos (RINT descuenta, RECEPCION suma, tipo inválido, producto inexistente) = **48 verdes**.
- **Front**: botón **+ Nuevo** en el listado → página `/movimientos/nuevo` con form vacío (defaults: RINT, depósito→área, hoy). Al crear, navega al detalle del nuevo movimiento.
- **Refactor**: form extraído a `movimientoForm.ts` (estado/payload) + `MovimientoFormFields.tsx` (componente), compartido entre crear y editar (sin duplicar).
- Verificado e2e: POST crea `REC-2026-00003`, stock 401 1380→1390; screenshot del form OK.

## 🖥️ Front — edición de movimientos (HECHO)
Adelanto de Fase 3 (UI). En branch `feat/movimientos-fase1-backend`.
- **Página de detalle/edición** (`/movimientos/:id`): form prefilleado, **todo editable** (tipo/origen/destino con selects de catálogo, fecha, turno, observaciones, renglones dinámicos con agregar/quitar), botón Guardar → `PUT`. Invalida queries (detalle, listado, stock, historial) al guardar. Si el movimiento está ANULADO, el form se deshabilita.
- **Historial de ediciones** visible abajo (quién/cuándo/qué cambió).
- **Endpoints de catálogo** (back): `GET /api/ubicaciones`, `/api/productos`, `/api/tipos` (requireAuth) para poblar los selects. `GET /:id` enriquecido para round-trip (tipo, dep_id_3c, turno, etc.).
- Las filas del listado son clickeables → llevan al detalle.
- **Verificado e2e** (Edge headless por CDP, login real por formulario): la página renderiza con datos vivos, catálogos poblados, y **F5 mantiene la sesión** (sin bug de deslogueo). 44 tests back verdes, front typecheck/lint/build ok.

## 🖥️ Front — preview read-only (HECHO, fuera de fase)
Adelanto para "ver algo" (el front formal es Fase 3). En branch `feat/movimientos-fase1-backend`.
- **Layout con nav** (Movimientos / Stock / Estado) + **`MovimientosPage`** (tabla con filtro por estado, consume `GET /api/movimientos`) + **`StockPage`** (consume `GET /api/stock`). TanStack Query, Tailwind v4.
- **API mejorada (additivo)**: el listado ahora devuelve `origen_nombre`/`destino_nombre` y el stock `producto_nombre`/`ubicacion_nombre` (joins en el back) para no hacer joins en el front. Tests siguen verdes (26).
- **Verificado end-to-end**: ambos servers levantados, proxy `/api` ok, screenshots de las dos páginas con datos reales.
- **Tipos en `shared/api/types.ts`**: réplica de los DTOs. Pendiente real de regla #8: paquete compartido de schemas Zod back/front (hoy duplicados).

---

## ✅ Fase 0 — CERRADA (2026-06-11)

Setup del monorepo + schema acordado. Los 4 comandos contra Postgres en Docker corrieron **en verde**:

```bash
docker compose up -d   # Postgres 16 healthy, puerto host 5433 ✅
npm run db:migrate     # migraciones 0000 + 0001 aplicadas ✅
npm run db:seed        # tipos_movimiento: RECEPCION(+1), RINT(-1), AJUSTE(0) ✅
npm test               # backend: test de conexión a DB de test ✅ (1 passed)
```

### Qué quedó en Fase 0
- **Monorepo** npm workspaces: `backend/` + `frontend/` + `docker-compose.yml` + `docs/`.
- **docker-compose.yml**: Postgres 16, volumen persistente, puerto host **5433**, credenciales desde `.env`. Script `docker/initdb/01-create-test-db.sql` crea la DB de test en el primer arranque.
- **Backend**: TypeScript estricto (ESM/nodenext) + Express 5 + Drizzle. Config validada con Zod. `GET /api/health` que verifica DB (503 si cae). Capas completas: routes → controllers → services → repositories + domain/middleware/db/config.
- **Schema Drizzle** con las **8 tablas** de §8 (`ubicaciones`, `productos`, `tipos_movimiento`, `movimientos`, `movimientos_detalle`, `usuarios`, `lotes`, `proveedores`), nombres/tipos exactos, índices y check `chk_real_positiva`.
- **Migraciones aplicadas**: `0000` (8 tablas + índices + FKs + check) y `0001` (secuencias de correlativos, función `generar_nro`, matview `stock_actual` + unique index).
- **Frontend**: Vite + React 19 + TS + Tailwind v4 + Router + TanStack Query, estructura por features. `HealthPage` placeholder.
- **Tooling**: ESLint + typecheck en ambos paquetes; Vitest en backend; GitHub Actions (lint + typecheck + tests con service de Postgres).

### Cambio de diseño aplicado en el cierre (11/06)
- **Se descartó el flujo n8n y la tabla `sugeridos_dia`** (migración `0002` eliminada). Motivo: la app del compañero ya muestra el sugerido y depósito carga el real ahí; ese número final entra a nuestra app **por API REST** y se materializa como **RINT auto-confirmado**. Ver `ARCHITECTURE.md` §8/§15. Schema reverificado: `db:generate` → "No schema changes".

## 🚧 Fase 1 — Backend de movimientos (EN CURSO)

Branch `feat/movimientos-fase1-backend`.

### ✅ Increment 1 — Ingreso de abastecimiento (HECHO, 13 tests verdes)
- **`POST /api/abastecimientos`**: recibe el abastecimiento de la app del compañero → crea **RINT** → **auto-confirma transaccional** (regla #6): correlativo `RINT-2026-xxxxx` (`generar_nro`) + cabecera CONFIRMADO + detalle + `REFRESH CONCURRENTLY stock_actual`, todo en una tx. Si algo falla → rollback total.
- **Descuento por `cantidad_real`** del depósito origen (regla #2); `cantidad_sugerida`/`stock_contado` quedan como referencia.
- **`GET /api/stock`**: stock actual (matview), filtrable por `ubicacion_id`/`producto_3c`.
- **Validación Zod** (`domain/movimientos.schema.ts`, regla #8) — pensado para compartir con el front.
- **Capas respetadas**: routes → controller → service (dueño de la tx) → repository.
- **Tests (regla #5)**: stock correcto, real-no-sugerida, rollback de validación, transaccionalidad (rollback tras insertar cabecera), **concurrencia** (2 ingresos simultáneos → nros distintos, stock = suma). Infra: `tests/globalSetup.ts` migra la DB de test; `tests/helpers/db.ts` limpia+siembra.
- **Verificado por HTTP** además de los tests: POST→201 (RINT-2026-00001), inválido→400, área inexistente→404, stock recalculado.
- **Verificado técnico**: `REFRESH MATERIALIZED VIEW CONCURRENTLY` SÍ corre dentro de la tx en PG16 (regla #6 viable tal cual).

### ✅ Increment 2 — Anulación (HECHO, 6 tests nuevos = 19 verdes)
- **`PUT /api/movimientos/:id/anular`**: CONFIRMADO → ANULADO transaccional. **DECISIÓN 2026-06-19: flip de estado, NO contramovimiento** (J eligió). Como `stock_actual` filtra `estado='CONFIRMADO'`, voltear el original + `REFRESH` ya revierte el stock; un contramovimiento duplicaría la reversión. Sella `anulado_por`/`anulado_en` (regla #7). Doc actualizada: `CLAUDE.md` regla #4, `ARCHITECTURE.md` §8 (justificación) y §9 (endpoint).
- **Guards**: inexistente → 404 `MOVIMIENTO_NO_ENCONTRADO`; ya anulado → 409 `YA_ANULADO`; estado ≠ CONFIRMADO → 409 `ESTADO_INVALIDO`. Lock `FOR UPDATE` serializa anulaciones simultáneas.
- **Tests**: revierte stock + sella auditoría, doble anulación, inexistente, reversión puntual (no toca otros movimientos), transaccionalidad (rollback deja CONFIRMADO), concurrencia (2 anular del mismo mov → una gana, otra YA_ANULADO, stock revierte 1 sola vez).

### ✅ Increment 3 — Listado + detalle (HECHO, 7 tests nuevos = 26 verdes)
- **`GET /api/movimientos`**: listado con filtros `desde`/`hasta` (rango de fecha inclusive), `tipo` (codigo del catálogo, string libre — extensible), `estado` (set fijo), `ubicacion` (matchea origen O destino) + paginado `page`/`limit` (default 1/50, máx 200). Devuelve `{items, page, limit, total}`; orden recientes primero (fecha desc, id desempata).
- **`GET /api/movimientos/:id`**: detalle (cabecera + renglones); 404 `MOVIMIENTO_NO_ENCONTRADO` si no existe.
- **Schema en `domain/movimientos.schema.ts`** (`MovimientosQuerySchema`, regla #8): el front reusa los filtros. Valida `desde <= hasta`.
- **Tests**: orden y total, filtro por estado, por ubicación (origen/destino), por rango de fechas, por tipo, paginado (total = del filtro completo), detalle + inexistente.
- **🐛 Fix de concurrencia (latente desde inc. 1)**: dos confirmaciones simultáneas podían dejar la matview sin uno de los movimientos (REFRESH con snapshots que no veían el commit ajeno). Solución: `pg_advisory_xact_lock` antes del `REFRESH` en `refrescarStock` (serializa refresh+commit). El test de concurrencia de abastecimientos dejó de ser flaky (3/3 estable). Blinda también la anulación.

### ✅ Increment 5 — Auth JWT (HECHO, 11 tests nuevos = 37 verdes)
- **JWT propio** (Bearer + localStorage). `POST /api/auth/login` (bcrypt + token firmado, expira en 8h) y `GET /api/auth/me`. Secreto en `JWT_SECRET` (.env + CI). Roles v1: ADMIN, DEPOSITO (+ SISTEMA = integración M2M).
- **Middleware** `requireAuth` (cuelga `req.user`) + `requireRole`. Protección: lecturas movimientos/stock = cualquier login; **anular = solo ADMIN** (audita al usuario del token, no al de integración); login público; `abastecimientos` M2M abierto (API key pendiente).
- **Front**: `LoginPage`, `AuthProvider` + `useAuth`, guarda `RequireAuth`, Bearer automático en el cliente HTTP + manejo de 401 (cierra sesión), header con usuario/rol + botón Salir.
- **Tests**: login OK/credenciales inválidas/usuario inactivo, firma+verificación de token, `requireAuth` (sin header / token malo / OK), `requireRole` (permite/deniega 403). Verificado end-to-end por HTTP: 401 sin token, 200 con token, 403 DEPOSITO→anular.
- **Usuarios dev** en `db:seed:dev` (admin/deposito, pass `laceleste123`).

### ✅ Increment 6 — Editar movimiento con historial (HECHO, 7 tests nuevos = 44 verdes)
- **Regla #4 relajada (decisión de J 2026-06-19)**: auditabilidad sobre inmutabilidad. Los movimientos **se editan** (cualquier usuario logueado, sin restricción de rol), pero **toda edición deja historial**. Anular sigue siendo solo-ADMIN y de vez en cuando.
- **`PUT /api/movimientos/:id`**: reemplazo completo (todo editable, incluido tipo/origen/destino). Transaccional (regla #6): valida refs → actualiza cabecera + renglones → registra diff en `movimientos_auditoria` → recalcula stock. 409 si el movimiento está ANULADO.
- **`GET /api/movimientos/:id/historial`**: lista las ediciones (quién/cuándo/qué cambió, valor antes/después).
- **Tabla nueva** `movimientos_auditoria` (migración `0002`): una fila por edición, `cambios` JSONB con el diff. Aplicada en dev; `globalSetup` la aplica en test.
- **Tests**: editar cantidad recalcula stock + historial, cambio de producto mueve stock, edición descriptiva no toca stock, edición sin cambios no genera historial, 404 inexistente, 409 anulado, rollback transaccional. Verificado e2e por HTTP (1350→1380 + historial con diff).

### ✅ Estructura git (HECHO)
- Creadas y pusheadas `main` (desde scaffold Fase 0 = baseline desplegable) y `dev` (desde main). Falta el paso manual: setear `main` como default branch en GitHub (no hay `gh`/token). Las fases mergean por PR a `dev`; `dev`→`main` al liberar.

### ⏳ Pendiente en Fase 1 (próximos increments)
- **Kardex por producto** (libro mayor con saldo corriendo) — único real pendiente del bloque export.
- **Sincronizar-3c** (empujar de vuelta a 3c / mapear `nro_3c`), si se decide hacerlo.
- (Ya HECHO: listado con filtros+paginado, detalle, export CSV/Excel, idempotencia + API key M2M,
  crear/editar/anular auto-confirmado. Ver arriba.)

### ❓ Supuestos del contrato del POST — VALIDAR con el compañero
1. **Área destino** identificada por su `dep_id_3c` de 3c (campo `destino_dep_id_3c`).
2. **Depósito origen**: `origen_dep_id_3c` opcional; si falta usa `DEPOSITO_PRINCIPAL_DEP_ID_3C` (.env). v1 = un solo depósito.
3. **Renglón**: `producto_3c`, `cantidad_real` (oblig.), `cantidad_sugerida`/`stock_contado` (opc.), `unidad`.
4. **Idempotencia**: NO implementada. Si la app del compañero re-empuja el mismo abastecimiento, se duplica. Falta acordar un id externo único para deduplicar (recomendado: que su app mande su propio id y lo guardemos para rechazar duplicados).

## 🧷 Recordatorios sueltos (cancha de J)
- **C: del equipo de J está al límite (~99% usado).** Conviene una limpieza a fondo del disco del sistema (Docker Desktop, descargas) cuando haya un rato; el cierre de Fase 0 necesitó liberar npm-cache+Temp para tener aire.
- Definir el **contrato fino del POST** con el compañero (campos exactos, auth, idempotencia si re-empuja el mismo abastecimiento).
- Falta poner `docs/demo-movimientos-internos.html` (referencia de UX para Fase 3).
- Cuando se sepa el **motor de DB del compañero**, anotarlo en §15 de `ARCHITECTURE.md` (no bloquea nada).
