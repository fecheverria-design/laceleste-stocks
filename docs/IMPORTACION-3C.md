# IMPORTACIÓN DE 3C — reglas, lógica y procedimientos

> **Fuente única de verdad de cómo se interpretan los datos de 3c.** Si un movimiento,
> stock o precio aparece mal, empezá por acá: la causa casi siempre es una regla de
> clasificación. Última actualización: 2026-06-25.

Los importers son scripts CLI en `backend/src/db/import-*.ts`. Cada uno acepta `--dry`
(muestra el plan, no escribe). Todos son idempotentes.

---

## Principios que rigen todo

1. **IDs de 3c = verdad** (regla #1 de CLAUDE.md). Nunca se inventan códigos de producto
   ni depósito.
2. **El stock = suma de movimientos `CONFIRMADO`** (vista materializada `stock_actual`).
   La **dirección** define el signo: suma al `destino` y resta del `origen`, pero **solo
   si ese lado tiene `lleva_stock=true`**. El tipo de movimiento NO define el signo.
3. **Baldes virtuales (no llevan stock)**: `101 = AJUSTES`, `102 = PROVEEDORES`. Son la
   contrapartida; su efecto cae siempre en el depósito real del otro lado.
4. **El stock real se ancla a conteos** (inventario físico), no al neto del histórico.
   El histórico de 3c es registro/trazabilidad; el inventario lo neutraliza (ver abajo).

---

## `import:movimientos -- <archivo> [--dry]`

Una fila del archivo = un renglón. Columnas: `FECHA, NUMERO, TIPO_DOC, ID ORIGEN,
ORIGEN_DENOMINACION, ID DESTINO, DESTINO_DENOMINACION, ID ARTICULO, TEXTO, UNIMED, CANTIDAD`.

### Clasificación del tipo (TIPO_DOC → nuestro tipo)
- `Rint` → **RINT**
- `ReMe`, `Fcpr` → **RECEPCION**
- `RINV` → **AJUSTE**
- `NCC` → **se excluye a propósito** (facturas, módulo futuro).
- **Override por balde de ajustes**: si el origen O el destino es `101 (AJUSTES)`, el
  movimiento es **AJUSTE** aunque el documento sea `Rint`. *(En 3c los ajustes se
  registran como Rint contra el balde 101: `101→FABRICA` suma, `FABRICA→101` resta.
  Decisión de J, 2026-06-25.)*

### Agrupación (clave compuesta) — CRÍTICO
Los renglones se agrupan por **`(TIPO_DOC + NUMERO + dirección efectiva)`**, NO solo por
NUMERO. Razones:
- **El NUMERO de 3c es único POR TIPO de documento, no global.** Un `Rint` y un `ReMe`
  pueden compartir número siendo movimientos distintos. Agrupar solo por NUMERO los
  fusionaba (se quedaba con el primero y perdía el otro). *(Bug detectado y corregido
  2026-06-25; afectaba ~484 movimientos.)*
- **Un mismo NUMERO puede traer renglones en direcciones distintas** (ajustes que suman
  unos productos y restan otros). Se separan por dirección para que cada movimiento tenga
  un signo consistente.

### Cantidades negativas = devoluciones
Una `CANTIDAD < 0` se interpreta como devolución: se **invierte la dirección**
(origen↔destino) y se vuelve positiva. *(Antes el modelo las rechazaba por
`cantidad ≥ 0`; decisión de J, 2026-06-25.)*

### Idempotencia
Por `(codigo de tipo + nro_3c + dirección)`. Re-correr el archivo no duplica.

### Se descarta un renglón si
No tiene número/fecha/tipo válido, origen/destino no numéricos, sin artículo, o cantidad
no finita. (NCC se cuenta aparte.) Los descartes se reportan al final.

---

## `import:inventario -- <archivo> [--dry] [--exclusivo]`

Carga la "foto" del stock físico contado. Columnas: `DEPOSITO (= dep_id_3c)`, código de
producto (`3C` / `ARTICULO` / `ARTICU_ID`), `STOCK` (+ opcionales `FECHA, DENOMINACION,
UNIMED, AÑO, MES`). El separador (`,` `;` `tab`) se autodetecta.

- Por cada `(producto, depósito)` genera un movimiento **INVENTARIO = contado − sistema**
  contra el balde 101 (tipo `INVENTARIO`, correlativo `INV-2026-…`; es un **recuento**, NO un
  AJUSTE operativo — decisión de J 2026-07-01). Esto **neutraliza el histórico**: deja el
  stock parado exacto en lo contado, sin importar qué netaba el historial.
- Activa `lleva_stock` en todos los depósitos del archivo (additivo).
- **`--exclusivo`**: el conteo es **autoritativo por depósito** → todo producto con stock
  en un depósito del archivo que NO esté listado se pone en **0**. Sin el flag, solo
  ajusta lo listado (los demás conservan su saldo histórico). *Usar `--exclusivo` para
  acopios: el conteo de hoy es la verdad completa de ese depósito.*

---

## `import:precios -- <archivo> [--dry]`

Histórico de precios. Columnas: `ID (producto), PRECIO_UNITARIO, PERSONAS_ID (proveedor),
PROVEEDORES (nombre), FECHA, TIPO (COMPRA|ACTUALIZACION)`.

- **Precio vigente = la última `COMPRA`** (lo que efectivamente se pagó). Si un producto
  nunca tuvo compra, cae a la última `ACTUALIZACION` como referencia.
- **El gráfico de evolución usa solo las `COMPRA`.**
- **`$0` = "sin precio"** (placeholder de 3c; se ignora para el vigente y la valorización).
- Idempotente por `(producto, proveedor, fecha, tipo)`.

---

## `import:compras -- <archivo> [--dry]`

Compras reales a proveedores (base del **gasto por proveedor**). Una fila = un renglón de
factura/orden. Columnas: `NUMERO, FECHA, ARTICU_ID (producto), CANTIDAD, PRECIO_UNITARIO,
PRECIO_TOTAL (neto), PERSONAS_ID (proveedor), FAMILIA, IVA, VALOR TOTAL (con IVA),
PROVEEDORES (nombre)`. Ignora DOC_ID/ID/PRECIO_LISTA/MES/AÑO.

- El **gasto** se mide por `precio_total` (neto, sin IVA); `total_con_iva` es lo pagado.
- Auto-crea productos (y **setea su `familia`**) y proveedores (numero_3c = PERSONAS_ID).
- Idempotente por `(numero, producto_3c, renglon)`. **El `renglon` importa:** un mismo remito
  puede traer el MISMO producto en varias líneas (cantidades o precios distintos) y 3c no
  exporta un id de línea — `DOC_ID` es del documento y se repite. Los numera
  `compras-lectura.ts` por orden de aparición en el archivo, así que es determinístico y
  reimportar el mismo export cae en las mismas filas. *(Con la clave vieja `(numero,
  producto_3c)` la segunda línea pisaba a la primera: 65 renglones y $60.705.167 que nunca
  entraron. Se detectó el 2026-07-31 porque el gasto de junio no cerraba; ver migración 0016.)*
- **Excluye familias que no son compras reales**: `SERVICIOS`, `TRANSPORTE TERCERIZADO`,
  `AJUSTE DE SALDO`, `GASTOS SOCIOS`, `IMPUESTOS`, `GASTOS BANCARIOS` (honorarios/servicios,
  flete tercerizado, ajuste de saldo contable, gastos de socios, impuestos y gastos
  bancarios). No entran al gasto por proveedor. La lista vive en
  `backend/src/domain/familias.ts` (`FAMILIAS_NO_COMPRA` / `esCompraReal`). *(Decisión de J,
  2026-07-01.)* El importer las reporta aparte como "excluidas por familia".
- La hoja **Proveedores** del front usa esto: lista con gasto total + ranking por familia
  (`GET /api/proveedores`, `/api/proveedores/gasto?familia=`). Alta de proveedor exige
  `numero_3c` (regla #1).

### Comparar el gasto contra el Informe de Compras de J (planilla)

Si un total no coincide, chequear estas tres cosas **en este orden** — las tres explicaron
diferencias reales el 2026-07-31:

1. **IVA.** El informe de la planilla suma la columna **`VALOR TOTAL` (con IVA)**; la app
   muestra el **neto**. Para junio 2026 eran $438,9M neto vs $530,8M con IVA: la misma plata.
   Para comparar hay que usar `coalesce(total_con_iva, precio_total)`.
2. **Atribución por comprador.** Sale de la familia del producto, no de un campo:
   `MATERIAS PRIMAS → Lautaro`; `PACKAGING | LIMPIEZA | MERCHANDISING | DESCARTABLES →
   Fausto`; el resto no suma a ningún comprador.
3. **Antigüedad del export.** Las compras solo llegan hasta la fecha en que J bajó el
   archivo. Si faltan semanas, el gasto aparece bajo y no hay bug que buscar.

Referencia verificada (junio 2026, export del 31/07): Lautaro **$530.798.232**, Fausto
**$74.153.348** — ambos con IVA y coincidentes con el informe.

### Precios: qué manda, y qué pasa si se cargan desde la app

El precio vigente es la **última `COMPRA`** (ver la sección de `import:precios`), y de ahí
cuelga todo lo que muestra plata: valorización del stock, Panel, hoja de Precios. La app
permite cargar y editar precios a mano (`POST/PUT /api/precios`), y eso impacta **al instante**
sin reimportar nada, porque todo lee la misma tabla.

⚠ **Son dos fuentes que no se hablan:** un precio cargado a mano y un reimport del export de la
planilla escriben en la misma tabla, y el import **pisa** si coincide
`(producto, proveedor, fecha, tipo)`. Mientras la planilla siga siendo la fuente, cargar a mano
sirve para tapar huecos, no para reemplazarla.

⚠ **Nunca valorizar sin excluir los productos ficticios.** El `480 PRUEBA` tiene stock inventado
y llegó a tener un precio de $462.842: él solo inflaba la valorización a $5.068M contra los
$490M reales. La app ya lo excluye (`PRODUCTOS_FICTICIOS` en `backend/src/domain/familias.ts`),
pero una consulta SQL a mano no.

---

## Procedimiento: cambiar lógica de import SIN mover el stock

El stock vigente está validado por J y debe mantenerse. Para reimportar movimientos
(p. ej. tras corregir una regla) sin alterar el stock:

1. **Foto**: exportar el `stock_actual` actual de los depósitos con `lleva_stock` a un
   archivo formato inventario (DEPOSITO, 3C, STOCK).
2. **Wipe**: `TRUNCATE movimientos_detalle, movimientos_auditoria, movimientos` + reset de
   las secuencias `seq_*` + `REFRESH`.
3. **Reimport**: `import:movimientos` con el archivo histórico.
4. **Re-anclar**: `import:inventario -- <foto> --exclusivo` → el stock vuelve EXACTO a la
   foto, sin importar el nuevo neto del histórico.

Verificar siempre con un `diff` entre la foto y el stock resultante (deben ser idénticos)
y `count(*) WHERE cantidad < 0` = 0. **Hacer `pg_dump` antes.**

---

## Bitácora de decisiones de lógica (para auditar dónde/cuándo cambió algo)

| Fecha | Cambio | Commit |
|---|---|---|
| 2026-07-31 | Compras: clave `(numero, producto_3c, renglon)` (mig. 0016). Un remito puede repetir el mismo producto en varias líneas y la clave vieja las pisaba: 65 renglones / $60,7M perdidos. Con esto el gasto de junio cierra con el informe de J (Lautaro $530.798.232, Fausto $74.153.348, ambos con IVA) | (este commit) |
| 2026-07-01 | Recuento de stock = tipo `INVENTARIO` (mig. 0015), separado del AJUSTE operativo; lo usan `import:inventario` y el módulo Inventarios. `import:inventario` acepta alias `ARTICULO` para el código | (este commit) |
| 2026-07-01 | Compras: excluir familias que no son compras reales (SERVICIOS, TRANSPORTE TERCERIZADO, AJUSTE DE SALDO, GASTOS SOCIOS, IMPUESTOS, GASTOS BANCARIOS) del gasto | (este commit) |
| 2026-06-25 | Compras reales (`import:compras`) + hoja Proveedores con gasto por familia; `familia` en productos | (este commit) |
| 2026-06-25 | Consumos por área (lo que sale de FABRICA a las áreas) + promedio semanal | `a3ef321` |
| 2026-06-25 | Movimientos: agrupar por (tipo+numero+dirección); ajustes vía balde 101; devoluciones (cantidad negativa) se invierten | `5ab66f4` |
| 2026-06-25 | Importer: fix colisión de NUMERO entre tipos de documento | `b917cd8` |
| 2026-06-25 | Inventario: modo `--exclusivo` (conteo autoritativo por depósito) | `fdf46da` |
| 2026-06-24 | Precios: histórico con tipo COMPRA/ACTUALIZACION; vigente = última compra | `07b3e6a` |
| 2026-06-24 | Precios: `$0` = sin precio; valorización del stock | `e21c36b` |
| 2026-06-22 | Inventario inicial multi-depósito; stock anclado a conteos | (ver PROGRESO) |

> El registro **autoritativo y completo** son los mensajes de commit de git
> (`git log --oneline`). Esta tabla es el índice de las decisiones de negocio.
