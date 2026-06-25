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

Carga la "foto" del stock físico contado. Columnas: `DEPOSITO (= dep_id_3c), 3C, STOCK`
(+ opcionales `FECHA, DENOMINACION, AÑO, MES`).

- Por cada `(producto, depósito)` genera un **AJUSTE = contado − sistema** contra el balde
  101. Esto **neutraliza el histórico**: deja el stock parado exacto en lo contado, sin
  importar qué netaba el historial.
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
| 2026-06-25 | Movimientos: agrupar por (tipo+numero+dirección); ajustes vía balde 101; devoluciones (cantidad negativa) se invierten | `5ab66f4` |
| 2026-06-25 | Importer: fix colisión de NUMERO entre tipos de documento | `b917cd8` |
| 2026-06-25 | Inventario: modo `--exclusivo` (conteo autoritativo por depósito) | `fdf46da` |
| 2026-06-24 | Precios: histórico con tipo COMPRA/ACTUALIZACION; vigente = última compra | `07b3e6a` |
| 2026-06-24 | Precios: `$0` = sin precio; valorización del stock | `e21c36b` |
| 2026-06-22 | Inventario inicial multi-depósito; stock anclado a conteos | (ver PROGRESO) |

> El registro **autoritativo y completo** son los mensajes de commit de git
> (`git log --oneline`). Esta tabla es el índice de las decisiones de negocio.
