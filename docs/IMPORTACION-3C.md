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

## `sync:3c -- --fuente=productos [--dry]` — el maestro de 3c, en vivo

Reemplaza el export de productos que había que bajar a mano cada vez que daban un artículo de
alta. Lee `LACELESTE.V_ARTICULO` por el proxy y lo pasa por `import:productos` (mismos alias de
encabezado), así que la lógica de upsert es una sola.

- En **esta** vista `ID` **es el `codigo_3c`** (1 = AJUSTE CENTAVO, 10 = BOLSA RESIDUOS…).
  Tiene además una columna `ARTICU_ID` que viene vacía: no es esa.
- Pisa **nombre, unidad, familia y subfamilia** (3c manda, regla #1).
- **NO toca el enriquecimiento propio de la app**: presentación de compra, unidades por bulto,
  clasificación ABC e información se conservan, porque esas columnas no vienen en las filas y
  el upsert las mantiene con `COALESCE`. Verificado el 2026-09-08 sobre 1.196 productos: los
  contadores de esas 4 columnas quedaron idénticos.
- Aborta si el maestro trae menos de 500 productos (lectura cortada).
- Va **en las fuentes por defecto**, antes de compras: ni compras ni la foto de stock crean
  productos, así que el maestro tiene que ir primero.

---

## `sync:3c -- --fuente=proveedores [--dry]` — el maestro de proveedores, en vivo

Lee `LACELESTE.LC_V_PROVEEDORES` y lo pasa por `import:proveedores`. Antes solo se creaban
los proveedores que aparecían en la ventana de compras, así que uno dado de alta hace poco y
sin compras recientes no existía en la app (al 2026-09-08 faltaban 24, casi todos personas con
numeración 7657+).

- ⚠ En esa vista **el nombre está en `APELLIDO`**; la columna `NOMBRE` viene vacía. Es el mismo
  gotcha que en la query de compras.
- El **CUIT usa `0`** como placeholder de "no cargado" → se manda vacío para que quede `null`.
- Aborta si trae menos de 500 proveedores. Va en las fuentes por defecto.

---

## `sync:3c -- --fuente=stock [--dry]` — la FOTO de stock de 3c, en vivo

Misma mecánica que `import:inventario --exclusivo`, pero la foto no viene de un CSV bajado a
mano: se lee **en vivo** de `LACELESTE.V_LACELESTE_STOCK` por el proxy SQL. 3c es la fuente de
verdad del stock (Opción A, decisión de J 2026-09-04) y esa vista **se refresca sola**
(verificado el 2026-09-08: 34 claves cambiaron entre dos lecturas separadas 17 h).

- En esa vista, `ARTICU_ID` **es el `codigo_3c`** del producto (≠ `V_ARTICULO`/`V_COMP_PRECIOS_CPRA`,
  donde `ARTICU_ID` es el id interno de Oracle).
- **Alcance: solo los depósitos con `lleva_stock`.** 3c tiene 36 depósitos con existencias
  (AJUSTES 101, PAÑOL, UNIFORMES, ADMINISTRACIÓN, Panadería…) que la app no stockea a
  propósito; traerlos sería ampliar el alcance, no sincronizar.
- **No crea productos ni depósitos.** Un código de la foto que no está en el maestro se avisa
  y se saltea (el alta va por `import:productos`, con nombre y rubro de verdad).
- Es **autoritativa**: lo que la app tiene y la foto no lista queda en 0. Por eso aborta si la
  foto trae menos de 500 filas o si no queda ninguna fila aplicable — una lectura cortada
  borraría stock.
- **No está en las fuentes por defecto**: `npm run sync:3c` trae productos, proveedores y
  compras. La foto se pide explícita (`--fuente=stock`) — y así corre en el cron horario.
- Los movimientos que genera llevan **`Foto 3c <fecha>`** en observaciones (el conteo físico a
  mano dice `Inventario <fecha>`), para distinguir en la hoja de Movimientos lo que vino de 3c
  de lo que vino de la app del compañero. Decisión de J 2026-09-08: prefiere verlos marcados
  antes que filtrados.

⚠ Sigue valiendo el modo de falla de toda foto: si la app tiene una recepción que 3c todavía no
cargó, la foto la borra. Bajo Opción A eso es *la decisión* (3c manda), pero si el número
aparece raro, ese es el primer sospechoso.

---

## `import:precios -- <archivo> [--dry] [--controlado]`

Histórico de precios. Columnas: `ID (producto), PRECIO_UNITARIO, PERSONAS_ID (proveedor),
PROVEEDORES (nombre), FECHA, TIPO (COMPRA|ACTUALIZACION)`.

- **Precio vigente = la última `COMPRA`** (lo que efectivamente se pagó). Si un producto
  nunca tuvo compra, cae a la última `ACTUALIZACION` como referencia.
- **El gráfico de evolución usa solo las `COMPRA`.**
- **`$0` = "sin precio"** (placeholder de 3c): se saltea, no se guarda.
- Idempotente por `(producto, proveedor, fecha, tipo)`.
- Acepta **CSV/TSV y `.xlsx` directo**. Del Excel lee los valores **crudos**, no los que
  muestra la celda: con formato moneda, `5831,83` se ve `$5.832` y ahí ya se perdieron los
  centavos.


### La planilla de compras (columna `Usar` en vez de `TIPO`)

`precios.xlsx` (hoja **PRECIOS DEFINITIVOS**) es la planilla donde compras tilda, mes a mes,
qué precio se usa de cada producto. No tiene columna `TIPO`: tiene el tilde **`Usar`**.

- **Tildado = `COMPRA`, sin tildar = `ACTUALIZACION`** (regla de J).
- Es una **foto por mes**: el mismo precio se repite una fila por mes. Cuando el tipo sale del
  tilde, las filas de un mismo `(producto, proveedor, fecha)` **se colapsan en una sola** y
  **basta que esté tildada en un mes** para que sea COMPRA. Sin ese colapso, un precio tildado
  en enero y no en marzo entraría dos veces —como compra y como actualización del mismo día—
  e inflaría el conteo de cotizaciones del Control de precios.
- Si el precio de esa misma fecha cambió entre meses (alguien corrigió la planilla), **gana el
  del mes más nuevo**: el archivo viene ordenado por mes ascendente y la última fila manda.
- Con `--controlado` **solo se marca lo tildado**: un producto sin ningún tilde en todo el
  archivo se deja como está. Marcarle la última cotización suelta sería inventarle una decisión
  que nadie tomó, y esa marca le gana a toda compra futura.


### `--controlado` — marcar de una lo que compras controló en el mes

Además de importarlos, marca cada precio como **EL precio controlado** de su producto: el que
le gana a todo en la prelación (controlado > última COMPRA > última ACTUALIZACION, ver
`repositories/precio-vigente.ts`). Sirve para cargar de un saque lo controlado del mes en vez
de marcarlo a mano de a uno en la hoja de Control de precios.

- Solo puede haber **UN controlado por producto** (índice parcial `uq_precio_controlado_producto`).
  Si el archivo trae varias filas del mismo producto, **gana la `COMPRA` más nueva** —y solo si
  no hay ninguna compra, la última actualización—, que es el mismo orden con el que la app
  resuelve el precio vigente. A igualdad, la última fila del archivo. Se avisa cuántas quedaron
  sin marcar; las demás se importan igual, solo que sin la marca.
- ⚠ **La marca congela el precio**: le gana a cualquier compra posterior de 3c. Después de una
  carga masiva conviene revisar los casos donde el controlado quedó viejo y hay una compra más
  nueva muy distinta (query en la bitácora, entrada del 2026-09-10).
- Desmarca el controlado anterior de esos productos, misma semántica que el botón de la hoja.
- Todo en una transacción.
- Probalo con `--dry` primero: dice cuántos se van a marcar antes de tocar nada.

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
| 2026-09-10 | Precios: `import:precios` lee `.xlsx` (valores crudos) y acepta el tilde `Usar` de la planilla de compras en vez de `TIPO` (tildado=COMPRA, resto=ACTUALIZACION, decisión de J). Con el tilde, las filas del mismo `(producto, proveedor, fecha)` se colapsan —es una foto por mes— y basta un mes tildado para que sea COMPRA. `--controlado` marca la COMPRA más nueva (antes: la fila más nueva, que podía ser una cotización sin tildar) y **solo lo tildado**. Precio `0` pasa a saltearse en vez de guardarse | (este commit) |
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
