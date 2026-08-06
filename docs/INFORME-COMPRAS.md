# INFORME DE COMPRAS — cómo se calcula cada número

Reproduce dentro de la app el "Informe de Compras — Prioridad A" que J generaba con un Google
Apps Script sobre planillas. Hoja `/informe` · backend en `services/informe.service.ts`.

**Estado (2026-08-03):** implementadas 5 solapas — **Por Comprador**, **Ahorro potencial**,
**Matriz & Variación** (con cobertura y control de datos), **Canasta A** y **Ventas e
inflación** (la carga manual). Pendiente: **Indicadores vs Ventas**, que ya tiene los datos
pero le faltan los ratios. Objetivos y Plan de acción quedaron para más adelante.

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

**Precio del mes** = el **precio VIGENTE al cierre de ese mes**: entre las filas de `precios` con
`vigente_desde <= fin de mes`, la que gana la prelación de `ordenPrecio()` — la controlada a
mano, si no la última de tipo `COMPRA` (el "tick `Usar`" del script), si no la última
`ACTUALIZACION`. Es el mismo criterio que el precio vigente del resto de la app. **Sale de la tabla `precios`, no de las compras** — por eso corregir un precio a mano en la
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

**El precio de compra** ("tick `Usar`") = el **controlado a mano** si lo hay; si no, la última
fila de tipo `COMPRA`. Si un producto nunca tuvo COMPRA cae a la última `ACTUALIZACION` y se lo
reporta en el control de datos. Ver «El precio controlado» más abajo.

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
test que lo fija.

**Cómo se descartan los precios mal cargados.** Un precio erróneo ensucia el índice dos veces:
cuando aparece y cuando se corrige. Por eso hay dos reglas, y lo que se marca por cualquiera de
las dos queda fuera del índice **como destino y como base de comparación**:

1. **Salto** contra el mes inmediatamente anterior mayor a `OUTLIER_MAX`.
2. **Pico aislado**: el precio se dispara respecto del anterior *y* vuelve con el siguiente,
   aunque entre medio haya meses sin compras.

La segunda regla existe por un caso real: MARGARINA MTK MASA valía $2.756 en diciembre, pasó
cuatro meses sin compras, apareció a **$23.665** en mayo y volvió a $3.910 en junio. Como no
había un mes anterior contiguo, el pico no se detectaba; la vuelta entraba como un **−79%** y
hundía el índice de junio 2,1 puntos (−3,14% cuando era −1,03%).

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
- **Canasta A vs inflación** (el `chCanasta`): barras + línea en modo mensual, dos líneas en
  acumulado (la inflación punteada).
- **Evolución del gasto** (12 meses) sigue en Recharts, en el resto de la app.

La **"Evolución de precios"** del original (el `chProv`) **no se hizo**: la hoja de Precios ya
muestra la serie de cada producto y duplicarla no aportaba nada. Decisión de J, 2026-08-03.

⚠ **La ventana de 1/3/6 meses se cuenta desde el MES DEL PRECIO, no desde el mes del informe.**
Si el producto se compró en julio pero su último precio cargado es de mayo, "1 mes" compara mayo
contra abril. Anclarla al mes del informe hacía que el precio de mayo se comparara contra el de
junio: contra sí mismo (0% falso) o con el signo dado vuelta. Era el bug del gráfico de 1 mes
(2026-08-03). Hay dos tests que lo fijan.

Cuando el precio usado es de un mes anterior al del informe, la pantalla lo avisa arriba del
gráfico: o se compró sin registrar el precio, o **la base no tiene el último export de precios**.

> **Antes de culpar a los datos, chequeá que la base esté al día.** El 2026-08-03 se diagnosticó
> que "en julio los 41 productos A comprados no dejaron precio de compra" y era falso: la base
> local tenía el export viejo. El CSV del 31/07 traía 456 filas COMPRA de julio y 640 de junio.
> Se importó y el informe quedó completo: 41 barras, 0 productos con precio atrasado, 0 sin
> precio de compra. **La clasificación COMPRA/ACTUALIZACION del export de J está bien.**

## Qué precio se toma, exactamente

Lo pedido por J (2026-08-03) y verificado con datos reales:

- **El precio CONTROLADO**, si el área de compras marcó uno a mano. Le gana a todo, sea COMPRA o
  ACTUALIZACION (agregado 2026-08-04, ver abajo).
- Si no hay ninguno marcado, **el último precio de tipo COMPRA**, sin importar de qué mes sea.
- **Si hay varias compras en el mismo mes, la última.** Verificado con BONDIOLA, que en julio
  2026 tiene compras el 03, el 10 y el 19: el informe toma la del **19/07 ($15.442,64)**.

**La prelación completa vive en un solo lugar**: `ordenPrecio()` en
`repositories/precio-vigente.ts`. Estaba copiada en seis queries (precios vigentes, valorización
del panel, consumos, matriz del informe, precio usado y serie mensual); ahora las seis la
importan, así que cambiarla sigue siendo un solo archivo.

### El precio controlado (2026-08-04)

Hasta acá, elegir el precio de un producto en la pantalla de Control lo pasaba a `tipo='COMPRA'`:
para elegirlo había que mentir sobre qué era, y una actualización legítima no se podía elegir sin
eso. **Decisión de J:** lo que marca compras es la verdad absoluta —tanto una compra como una
actualización pueden ser un error de carga—, así que la marca es un campo propio
(`precios.controlado_en` / `controlado_por`), independiente del tipo, y le gana a la regla
automática **en todos lados**: precio vigente, valorización del panel, consumos, matriz del
informe y la serie mensual que alimenta la canasta A, la variación 1/3/6m y la detección de
saltos. Un índice parcial (`uq_precio_controlado_producto`) garantiza uno solo por producto.

En la serie mensual esto significa que una fila marcada entra **aunque sea ACTUALIZACION**, y que
dentro de su mes le gana a la compra que hubiera. El resto de los meses sigue igual: solo compras
reales, y un mes sin compra sigue quedando **sin dato** (comparar contra un precio arrastrado
daría 0% de variación, y "no compré" no es "no cambió").

Lo hacen `preciosUsadosProductosA` (el precio vigente) y `preciosCompraPorMesCargado` (la serie
mensual), las dos con `DISTINCT ON ... ORDER BY vigente_desde DESC, id DESC`. El `id DESC`
desempata dos cargas del mismo día: gana la que se cargó después.

## Ventas e inflación (solapa de carga manual)

Los dos únicos datos del informe que no salen de 3c ni de ningún sync. Viven en
`indicadores_mensuales` (una fila por mes, los dos campos nullable) y se cargan desde la solapa
**Ventas e inflación**: los últimos 24 meses, cada campo se guarda al salir del foco.

⚠ **La inflación se guarda como FRACCIÓN** (0.021 = 2,1%), igual que todas las variaciones de la
app. La pantalla la muestra y la recibe en **porcentaje** y hace la conversión.

### Mensual o acumulada: se carga cualquiera de las dos

La tabla tiene **dos columnas de inflación** —*mensual* y *acumulada del año*— y se escribe en la
que uno tenga a mano; la otra aparece **calculada, en gris**. Lo que se guarda es el número
tipeado más `inflacion_modo` (`MENSUAL` | `ACUMULADA`), y las dos series se derivan al servir:

```
ACUMULADA → mensual_m   = (1 + acum_m) / (1 + acum_m-1) − 1
MENSUAL   → acumulada_m = (1 + acum_m-1) × (1 + mensual_m) − 1
```

con **base 0 en diciembre del año anterior**: el acumulado del año calendario arranca de cero
cada enero, así que enero es el único mes donde las dos coinciden. **El informe consume siempre
`inflacion_mensual`** y no se entera de cómo se cargó el dato.

Si falta un mes, la cadena se corta: de ahí en adelante solo se conoce el dato del modo en que
vino y el otro queda en `null` hasta el enero siguiente. Derivar salteando un mes daría un
número más chico que el real sin que se note.

**Por qué el modo es obligatorio junto al número:** hasta el 05/08/2026 había una sola columna y
qué significaba vivía en un comentario del código. Ese día se cargó la serie acumulada del año
(2,9 / 5,9 / 9,5 / 12,2 / 14,6 / 17,0) en el campo mensual y nada avisó —el validador solo
miraba ±100%, y 17% en un mes es posible—, así que el informe comparó la canasta contra una
inflación mensual del 17% y una ventana de 3 meses de ~40%.

Los límites del validador van por modo: **±100% mensual** (fuera de ahí es un porcentaje mal
tipeado, el clásico `2,1` donde va `0,021`) y **hasta 1000% acumulado del año** (acá la
acumulada llegó a 211% en 2023, el techo tiene que dejarla entrar).

**Un mes sin cargar es `null`, nunca cero.** La inflación acumulada de N meses devuelve `null`
si falta cualquier mes del tramo: acumular salteando un mes da un número más chico que el real
y nadie se daría cuenta. Lo mismo con la serie anclada de la canasta, que se corta en el hueco.

Con la inflación cargada se encienden tres cosas: el **rojo** del gráfico de variación (lo que
subió por encima de la inflación de la ventana), el KPI **"Sobre inflación"** y la **línea de
comparación** de la canasta.

## Lo que falta y por qué

| Solapa | Necesita | Estado |
|---|---|---|
| Indicadores vs Ventas | los ratios compras/consumo/stock/ajustes contra ventas | las ventas ya se cargan; faltan los ratios |
| Objetivos del mes | hoja OBJETIVOS | postergada (decisión de J, 2026-08-03) |
| Plan de acción | tabla `acciones` + las señales del informe | pendiente |

La solapa **Variaciones del Mes** del original no se hizo aparte: su contenido (variación del mes
contra la inflación) ya está en **Matriz & Variación**, que además deja elegir la ventana.

## Referencia verificada (junio 2026, export del 31/07)

| | Informe de J | App |
|---|---|---|
| Lautaro | $530.798.232 | $530.499.072 (−$299.159 del 480 PRUEBA) |
| Fausto | $74.153.348 | $74.153.348 ✔ |

Ver también `docs/IMPORTACION-3C.md` (de dónde salen compras y precios) y los tests en
`backend/tests/informe.service.test.ts`, que fijan cada una de estas reglas.

## Control de precios (hoja `/control-precios`)

La hoja de trabajo del área de compras: la misma información que la matriz, pero ordenada
para responder **qué hay que revisar y por qué**. Backend en `services/control-precios.service.ts`,
endpoint `GET /api/precios/control?abc=A[&familia=]`.

Cada producto trae sus **alertas**, y la lista arranca filtrada por los que tienen alguna,
ordenada por cantidad de alertas (lo más urgente arriba):

| Alerta | Cuándo | Por qué importa |
|---|---|---|
| `SIN_COMPRA` | ningún precio de tipo COMPRA **y ninguno controlado** | el informe está usando un fallback |
| `VENCIDO` | el precio usado tiene más de `DIAS_VENCIDO` (controlado o no) | el número que valoriza está viejo |
| `POCAS_COTIZACIONES` | menos de `OBJETIVO_COTIZACIONES` proveedores vigentes | no hay con qué comparar |
| `SALTO` | el precio saltó más de `UMBRAL_SALTO` en un mes | casi siempre dedazo o cambio de unidad |
| `SIN_PROVEEDOR` | el precio usado no tiene proveedor | queda fuera del ahorro y de la cobertura |

Los umbrales **se importan de `informe-precios.service.ts`**, no se repiten: si cambia el
objetivo de cotizaciones, cambia en la pantalla y en el informe a la vez.

Desde la fila se puede **cargar una cotización con proveedor** y **marcar cuál es el precio del
producto** (`PUT /api/precios/:id/controlado {controlado:true|false}`), que es el equivalente del
tick `Usar`. Se puede marcar **cualquier fila, sea COMPRA o ACTUALIZACION**, y la marca **no le
cambia el `tipo`**. Una sola por producto: marcar otra desmarca la anterior en la misma
transacción, y sacarle la marca devuelve el producto a la regla automática.

Ojo con el efecto en las alertas: un precio controlado **deja de reportarse como `SIN_COMPRA`**
(no es un fallback, es una decisión) pero **sigue disparando `VENCIDO`** si tiene más de
`DIAS_VENCIDO` — decisión explícita de J, porque el caso típico de marcar a mano es justamente
un precio viejo.

⚠ **El alta de precios acepta `proveedor_id` desde 2026-08-03.** Antes toda carga manual
quedaba sin proveedor, y una cotización sin proveedor no se puede comparar contra las de otros:
no suma a la cobertura ni entra al ahorro potencial.

⚠ **Mientras se siga reimportando `precios - Precios.csv`, la planilla pisa lo que se corrija
acá** (el upsert va por `producto + proveedor + fecha + tipo`). Para que la app sea la fuente de
verdad hay que dejar de reimportar precios.
