# INFORME DE COMPRAS — cómo se calcula cada número

Reproduce dentro de la app el "Informe de Compras — Prioridad A" que J generaba con un Google
Apps Script sobre planillas. Hoja `/informe` · backend en `services/informe.service.ts`.

**Estado (2026-08-03):** implementadas 5 solapas — **Por Comprador**, **Ahorro potencial**,
**Matriz & Variación** (con cobertura y control de datos), **Canasta A** y **Evolución de
precios**. Pendientes por falta de datos de carga manual: Indicadores vs Ventas y Variaciones
del Mes. Objetivos y Plan de acción quedaron para más adelante. Ver "Lo que falta y por qué".

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

## Las solapas de precios (`services/informe-precios.service.ts`)

Todo lo que sigue sale de la tabla `precios` y se limita a los productos con
`clasificacion_abc = 'A'`, igual que la hoja Prioridad del original.

**El precio de compra** ("tick `Usar`") = la última fila de tipo `COMPRA`. Si un producto nunca
tuvo COMPRA cae a la última `ACTUALIZACION` y se lo reporta en el control de datos.

Los umbrales, todos del script y todos exportados como constantes para no repetirlos:

| Constante | Valor | Para qué |
|---|---|---|
| `DIAS_VIGENTE` | 180 | Una cotización más vieja no cuenta para el objetivo de 3 proveedores |
| `DIAS_RECIENTE` | 60 | Marca visual "+60d": vigente pero ya no fresca |
| `DIAS_FRESCA` | 90 | Solo una cotización así de nueva sirve para comparar en el ahorro |
| `DIAS_VENCIDO` | 90 | Precio usado con más días → control de datos |
| `UMBRAL_SALTO` | 40% | Salto mes a mes que amerita revisar la carga |
| `OUTLIER_MAX` | 100% | Variación imposible: se excluye del índice y se reporta aparte |
| `ANCLA_CANASTA` | `2026-01` | Mes base del índice, fijo para que el histórico no se mueva |

**Ahorro potencial.** Por cada A con gasto en el mes: precio de compra vs la mejor cotización
**fresca de OTRO proveedor**. Si la alternativa es más cara, el mes va *a favor*; si es más
barata, es una *mala compra*. `monto = |gap%| × gasto del mes`. Sin alternativa fresca el
producto no entra: comparar contra un precio de hace medio año no dice nada.

**Canasta A.** Variación mensual ponderada por gasto (`aporte = peso × var`, con
`peso = gasto del producto ÷ gasto de la canasta`), anclada a enero 2026 y compuesta hacia
adelante y hacia atrás. La suma de los aportes es exactamente la variación del índice — hay un
test que lo fija. Se excluyen las variaciones de más de `OUTLIER_MAX`, que en la práctica son
dedazos: en mayo 2026 apareció BOLSA DE PAPEL KRAFT NRO 6 con **+82.949%**.

⚠ **La serie de precios de compra NO arrastra el último precio conocido.** Un mes sin compra
queda sin dato, no en 0%: `preciosCompraPorMesCargado` toma el precio *cargado en ese mes*, a
diferencia de `preciosVigentesPorMes` (que sí arrastra y es la que usa Por Comprador). Mezclarlas
inventaría variaciones de 0% que diluyen el índice.

## Los gráficos

Portados uno a uno del HTML de J, con la misma librería (**Chart.js**) y la misma paleta. El
CSS del informe está en `frontend/src/features/informe/informe.css`, que es su hoja de estilos
copiada tal cual y scopeada bajo `.inf`: por eso la pantalla se ve igual y no "parecida".

- **Variación del precio de compra a 1/3/6 meses** (el `chVar`): barras horizontales, rojo si
  superó la inflación de la ventana, celeste si no. Solo productos A comprados en el mes.
- **Evolución de precios** (el `chProv`): 12 meses, por proveedor o por producto, leyenda
  clickeable. Un mes sin cotización queda en `null` (la línea se une con `spanGaps`).
- **Canasta A vs inflación** (el `chCanasta`): barras + línea en modo mensual, dos líneas en
  acumulado (la inflación punteada).
- **Evolución del gasto** (12 meses) sigue en Recharts, en el resto de la app.

## Lo que falta y por qué

Dos solapas del original no se pueden calcular todavía. Se muestran en pantalla apagadas, con el
motivo, en vez de esconderlas:

| Solapa | Necesita | Estado |
|---|---|---|
| Indicadores vs Ventas | ventas mensuales | carga manual, tabla por crear |
| Variaciones del Mes | inflación oficial mensual | carga manual, tabla por crear |
| Objetivos del mes | hoja OBJETIVOS | postergada (decisión de J, 2026-08-03) |
| Plan de acción | tabla `acciones` + las señales de arriba | pendiente |

La inflación además destraba el rojo del gráfico de variación, el KPI "Sobre inflación" y la
línea de comparación de la canasta.

## Referencia verificada (junio 2026, export del 31/07)

| | Informe de J | App |
|---|---|---|
| Lautaro | $530.798.232 | $530.499.072 (−$299.159 del 480 PRUEBA) |
| Fausto | $74.153.348 | $74.153.348 ✔ |

Ver también `docs/IMPORTACION-3C.md` (de dónde salen compras y precios) y los tests en
`backend/tests/informe.service.test.ts`, que fijan cada una de estas reglas.
