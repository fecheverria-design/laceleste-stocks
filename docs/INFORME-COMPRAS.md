# INFORME DE COMPRAS — cómo se calcula cada número

Reproduce dentro de la app el "Informe de Compras — Prioridad A" que J generaba con un Google
Apps Script sobre planillas. Hoja `/informe` · backend en `services/informe.service.ts`.

**Estado:** implementada la solapa **Por Comprador** (v1, 2026-07-31). Faltan: Ahorro potencial,
Canasta A, Plan de acción. Fuera de alcance hasta que haya datos: Indicadores vs Ventas e
Inflación (las dos hojas se cargan a mano y todavía no existen en la app).

## Qué entra y qué no

- Solo las familias que tienen **comprador** asignado: `MATERIAS PRIMAS → Lautaro`;
  `PACKAGING · LIMPIEZA · MERCHANDISING · DESCARTABLES → Fausto`. La regla vive en
  `domain/familias.ts` y es la misma del `buyerOf()` del script.
- **No** entran servicios, esporádicos, impuestos ni ajustes de saldo (no son compra real), ni
  los **productos ficticios** (`480 PRUEBA`). Decisión de J, 2026-07-02.
  ⚠ Por eso Lautaro da **$299.159 menos** que la planilla en junio 2026: son 4 compras falsas
  del 480 que el Excel suma y la app no. Es a propósito.

## Las dos platas, y por qué son distintas

| | Se mide con | Por qué |
|---|---|---|
| **Gasto** | `total_con_iva` (columna "Valor total" de 3c) | Es lo que se pagó, y es la columna que usa el informe de la planilla. Sin esto no cierra contra el Excel. |
| **Precio / variación** | `precio_total` (neto) ÷ cantidad | Un cambio de alícuota de IVA no es un aumento del proveedor. Mezclarlos inventa variaciones que no existen. |

## Las fórmulas

**Precio del mes** = el **precio VIGENTE al cierre de ese mes**: la última fila de `precios` de
tipo `COMPRA` con `vigente_desde <= fin de mes` (el "tick `Usar`" del script). Si un producto
nunca tuvo COMPRA, cae a la última `ACTUALIZACION`, igual que el precio vigente del resto de la
app. **Sale de la tabla `precios`, no de las compras** — por eso corregir un precio a mano en la
hoja de Precios mueve el informe en la corrida siguiente, sin reimportar nada.

Al lado se muestra **`precio_pagado`**: el promedio de lo que efectivamente se pagó ese mes
(`gasto neto / cantidad`, de `compras`). Es solo referencia y aparece cuando difiere del precio
de lista en más de 1% — ahí es donde hay algo para mirar (lista desactualizada, bonificación,
compra a otro proveedor). **No manda en la variación.**

> **Se probó al revés y estaba mal.** La v1 calculaba el precio como promedio de lo pagado,
> derivado de `compras`. J corrigió un precio en la hoja de Precios, el informe no se movió, y
> ahí quedó claro: el informe tiene que mirar la tabla de precios, como hace el script.
> *(Decisión de J, 2026-07-31.)*

**Variación de precio de un producto** = `precio del mes / precio del mes anterior − 1`.
Si no hubo compras el mes anterior → **`null`, que en pantalla es "—"**, nunca 0%: *"no compré"*
no es *"no cambió"*.

**Variación de precio de un proveedor** = promedio de las variaciones de sus productos
**ponderado por el gasto del mes** de cada uno:

```
var_proveedor = Σ (var_producto × gasto_producto) / Σ gasto_producto
```

Solo entran los productos que tienen con qué comparar. Así un insumo de $900.000 que subió 10%
pesa mucho más que uno de $1.000 que subió 100% (da ≈10,1%, no 55%).

**Variación de gasto** = `gasto del mes / gasto del mes anterior − 1`. Es información, no un
juicio: comprar más un mes no es ni bueno ni malo, por eso en la pantalla va en gris y no en
rojo/verde como las de precio.

## Los gráficos

Copian los del informe original (que usa Chart.js; acá es Recharts):

- **Evolución del gasto** (12 meses, el `chProv` del HTML). Dos vistas: total, o una línea por
  cada uno de los 6 proveedores más grandes de la ventana. Un mes sin compras a ese proveedor
  va **`null` y corta la línea**, en vez de dibujar una caída a cero que no pasó.
- **Qué se movió de precio** (el `chVar`): barras horizontales con las 6 mayores subas y las 6
  mayores bajas del mes. Rojo sube, verde baja. *El original pinta de rojo lo que supera la
  inflación del período; cuando carguemos inflación, ese es el cambio.*

## Referencia verificada (junio 2026, export del 31/07)

| | Informe de J | App |
|---|---|---|
| Lautaro | $530.798.232 | $530.499.072 (−$299.159 del 480 PRUEBA) |
| Fausto | $74.153.348 | $74.153.348 ✔ |

Ver también `docs/IMPORTACION-3C.md` (de dónde salen compras y precios) y los tests en
`backend/tests/informe.service.test.ts`, que fijan cada una de estas reglas.
