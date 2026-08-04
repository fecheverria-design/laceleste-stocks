# GUÍA DE LA APP — de dónde sale cada número

Para leer dentro de seis meses cuando no te acordés cómo funcionaba algo. Hoja por hoja: qué
muestra, de dónde saca los datos y cómo hace la cuenta.

Los otros documentos, cuando quieras profundizar:

| Documento | Para qué |
|---|---|
| `IMPORTACION-3C.md` | Cómo se interpretan los archivos de 3c (tipos de movimiento, ajustes, precios) |
| `INFORME-COMPRAS.md` | Las fórmulas del Informe de Compras y del Control de precios |
| `OPERACION-SYNCS.md` | Cómo operar los syncs, los backups y el restore |
| `ARCHITECTURE.md` | El modelo de datos completo |
| `DEPLOY.md` | Cómo se despliega en el servidor |

---

## 1. La idea general

La app tiene **su propia base de datos**. No lee la de 3c ni la de la app de producción: se
alimenta de ellas y guarda su propia versión de la verdad. Hay **tres maneras** de que entre
información:

| Fuente | Cómo entra | Cada cuánto |
|---|---|---|
| **3c (el ERP)** | Vos exportás un CSV y se corre un import | A mano, cuando hace falta |
| **App de producción (la de Tincho)** | La app le pega a su API y trae los movimientos | Automático, cada hora |
| **Carga a mano** | Movimientos, inventarios, precios y artículos desde la pantalla | Cuando lo hacés |

Nada se pisa solo: los imports son **idempotentes** (podés correr el mismo archivo dos veces y no
duplica) y los syncs traen únicamente lo que falta.

---

## 2. Los cimientos: cómo se construye el stock

Todo el stock sale de **una sola tabla de movimientos**, y todo movimiento tiene un tipo:

| Tipo | Qué es | Efecto en stock |
|---|---|---|
| `RECEPCION` | Llega mercadería de un proveedor | **Suma** al depósito destino |
| `RINT` | Remito interno: sale del depósito hacia un área | **Resta** del depósito origen |
| `AJUSTE` | Corrección manual | Suma o resta según el renglón |
| `INVENTARIO` | Recuento físico | Deja el stock exacto en lo contado |

**El stock de un producto en un lugar = la suma de todos sus movimientos confirmados.** Se
recalcula solo cada vez que confirmás algo. Dos reglas que no se negocian:

- **Solo cuentan los movimientos CONFIRMADOS.** Un borrador o algo anulado no mueve el stock.
- **Se descuenta siempre por la cantidad REAL**, la que salió físicamente, nunca por la sugerida.

Los **lugares** son de dos clases: los **depósitos** (llevan stock: Fábrica, los acopios) y las
**áreas** (Panadería, Pastelería, Sandwichería…, que no llevan stock — lo que entra ahí se
considera consumido). Hay además dos "baldes" virtuales, el **101** y el **102**, que se usan
como contraparte de los ajustes e inventarios: sin ellos un ajuste no tendría de dónde salir.

---

## 3. Hoja por hoja

### Panel
Lo que vale el stock hoy. **Cuenta × precio vigente de cada producto**, sumado por depósito.
Solo cuenta stock positivo, y los productos sin precio quedan afuera (se muestran aparte como
"sin precio", porque valorizarlos en cero mentiría). Excluye el producto de prueba 480.

### Movimientos
El listado de todo lo que entró y salió. Filtros por tipo, fecha, lugar, producto y estado;
paginado y export a CSV que respeta los filtros. Entrando a un movimiento ves el detalle,
podés editarlo (queda historial de quién y qué cambió) y, si sos admin, anularlo.

**De dónde vienen:** los de la app de Tincho entran solos por el sync; los históricos, del import
de 3c; el resto, cargados a mano.

### Stock
La foto de cuánto hay de cada producto en cada lugar, con filtros por familia y depósito.
Sale de la suma de movimientos que explica el punto 2. Al abrir un producto ves los movimientos
que lo tocaron con el saldo después de cada uno (el kardex).

### Artículos
El maestro de productos: código de 3c, nombre, unidad, familia y subfamilia, clasificación ABC,
presentación de compra y cuántas unidades trae un bulto.

**De dónde viene:** del import del maestro de 3c. Si das de alta un artículo desde la app, se le
asigna el número que sigue en la numeración de 3c y queda marcado como creado localmente.

### Inventarios
El conteo físico. Elegís depósito y familias, te arma la hoja con el stock que el sistema cree
que hay, contás **en bultos y sueltas** (multiplica por las unidades por bulto) y al confirmar
genera un movimiento de tipo `INVENTARIO` con la diferencia contra el balde 101.

**Deja el stock exacto en lo que contaste.** Lo que no contás no se toca (no se pone en cero).

### Consumos
Cuánto consume cada área. Es **todo lo que salió de Fábrica hacia un área** en el período,
excluyendo lo que va a otros depósitos y a los baldes. Muestra el total, el **promedio semanal**
(el total dividido por las semanas del período) y el **costo** valorizado al precio vigente.
Los productos sin precio suman cantidad pero no suman costo.

### Precios
El historial de precios de cada producto. Cada fila es **un precio, de un proveedor, en una
fecha**, y tiene un tipo:

- **Compra** — lo que efectivamente se pagó.
- **Actualización** — precio de lista o cotización.

**Cuál de todos es "el precio" del producto se decide en este orden:**

1. **El precio controlado** — el que marcaste a mano en *Control precios*. Le gana a todo.
2. Si no hay ninguno marcado, **la última Compra**.
3. Si nunca hubo una compra, **la última Actualización**, como respaldo.

Esto vale para TODA la app: el Panel, los Consumos y el Informe usan el mismo criterio.

**Por qué existe la marca:** una compra puede ser vieja (se compró hace seis meses y todavía
queda stock de esa compra) y tanto una compra como una actualización pueden estar mal cargadas.
Marcar un precio es decir *"este es el número, decidido por nosotros"*, y eso vale más que la
regla automática. La marca **no le cambia la categoría a la fila**: una actualización marcada
sigue figurando como actualización, pero es la que manda. Hay **una sola por producto**: marcar
otra desmarca la anterior, y sacándole la marca el producto vuelve a la regla automática.

**De dónde viene:** del import del histórico de precios de 3c (`precios - Precios.csv`), y de lo
que cargues a mano.

### Control precios
La hoja de trabajo del área de compras: **qué precios hay que revisar y por qué**. Cada producto
llega con sus alertas y la lista arranca filtrada por los que tienen alguna.

| Alerta | Qué significa |
|---|---|
| sin precio de compra | Nunca se registró una compra: se está usando una cotización como respaldo |
| precio vencido | El precio que se usa tiene más de 90 días |
| faltan cotizaciones | Menos de 3 proveedores con cotización vigente (últimos 6 meses) |
| salto de precio | Saltó más de 40% en un mes: casi siempre un error de carga o un cambio de unidad |
| sin proveedor | El precio usado no tiene proveedor, así que no se puede comparar con otros |

Abriendo un producto ves la última cotización de cada proveedor. Desde ahí cargás una nueva con
su proveedor, o tocás **«Usar este precio»** para fijar cuál es el precio del producto — el
equivalente del tick `Usar` de la planilla. **Se puede marcar cualquier fila, sea compra o
actualización**, y la marca no le cambia la categoría. El ✓ verde indica la que está en uso.
**Lo que corregís acá mueve el informe en la próxima carga**, sin reimportar nada.

Dos detalles de las alertas cuando marcás un precio a mano:

- **«sin precio de compra» se apaga**: si lo marcaste vos no es un respaldo por falta de datos,
  es una decisión.
- **«precio vencido» NO se apaga**: aunque lo marques, si tiene más de 90 días lo vas a seguir
  viendo en la lista. Es a propósito — el caso típico de marcar es justamente un precio viejo.

### Proveedores
Cuánto se le compró a cada uno. Sale de las **compras reales importadas de 3c**, no de los
movimientos. Cada proveedor se abre y muestra qué productos le comprás.

### Informe
El Informe de Compras — Prioridad A, el mismo que se hacía con la planilla. Cinco solapas: gasto
**Por Comprador**, **Ahorro potencial**, **Matriz & Variación**, **Canasta A** y **Ventas e
inflación**. Las fórmulas están en `INFORME-COMPRAS.md`.

La última es de **carga a mano**: ventas del mes e inflación oficial son los dos únicos datos del
informe que no salen de ningún lado automáticamente. Se cargan una vez por mes y sin ellos el
informe funciona igual, solo que no puede decirte qué subió por encima de la inflación ni
comparar la canasta contra el mercado. **La inflación se escribe en porcentaje** (2,1 = 2,1%).

### Estado
Muestra si la app y la base están respondiendo. Es distinto del **vigía**, que corre solo todas
las mañanas en el servidor y avisa si: el sync dejó de traer movimientos, llegó mercadería de un
producto que no está dado de alta (esos renglones no afectan el stock), o algún área cargó
sugeridos sin cerrar la sesión (y entonces ese día no descontó nada).

---

## 4. Lo que se repite en todas las hojas

**Qué queda afuera de los reportes de plata.** No todo lo que 3c llama compra lo es:

- Familias que **no son compra real**: Servicios, Transporte Tercerizado, Ajuste de Saldo, Gastos
  Socios, Impuestos, Gastos Bancarios.
- **Productos Esporádicos**: bolsas de gasto genéricas (infraestructura, mantenimiento, RRHH).
  Quedan fuera del gráfico de gasto.
- El **producto 480 (PRUEBA)**: tenía compras falsas y stock inventado.

**Quién compra qué**, para el informe: `Materias Primas → Lautaro` · `Packaging, Limpieza,
Merchandising, Descartables → Fausto`. Sale de la familia del producto, no hay un campo aparte.
Lo que no cae en ninguna de esas familias no se le imputa a nadie.

**⚠ El gasto se mide de dos maneras distintas, y es a propósito:**

| Dónde | Con qué | Por qué |
|---|---|---|
| **Informe** | **Con IVA** | Es la columna "Valor total" de tu planilla. Sin esto no cerraba contra el Excel |
| **Proveedores** | **Neto** | Es el resto de la app mirando el gasto sin impuesto |

Si comparás las dos pantallas y no dan igual, es esto. **No es un error.**

---

## 5. Lo que se hace solo

| Qué | Cuándo | Dónde |
|---|---|---|
| Trae abastecimientos de la app de Tincho | Cada hora, en el minuto 00 | Servidor |
| Trae recepciones | Cada hora, :05 | Servidor |
| Trae los extras del encargado | Cada hora, :10 | Servidor |
| Backup de la base | Todos los días 3:30 AM (se guardan 14 días) | Servidor |
| Copia del backup a Dropbox | **Los domingos** 4:00 AM | Tu PC (tiene que estar prendida) |
| Vigía (chequeo diario) | Todos los días 9:30 AM | Servidor |

Los syncs son **acumulativos y no duplican**: si algo ya entró, lo saltean. Si en la app de
Tincho borran un movimiento, el sync lo anula acá también.

---

## 6. Cuando un número no cuadra

Por orden, que es el orden en que suelen aparecer los problemas:

1. **¿La base está al día?** Si estás mirando la copia local en tu PC, puede estar vieja. El
   servidor es el que tiene los datos buenos. *(Pasó el 03/08: un análisis entero salió mal por
   esto.)*
2. **¿Estás comparando gasto con IVA contra gasto neto?** Ver el punto 4.
3. **¿El producto está excluido?** Fijate si cae en una familia que no cuenta o si es el 480.
4. **¿El precio es de tipo Compra?** Si el último precio cargado es una Actualización, el informe
   usa la Compra anterior, que puede ser vieja. Se ve en **Control precios**.
5. **¿El movimiento está confirmado?** Un borrador no mueve stock.
6. **¿Hay un salto de precio raro?** Mirá las alertas de Control precios: un dedazo en un precio
   arrastra la valorización, el costo de consumos y el informe a la vez.

---

## 7. Los archivos que exportás de 3c

| Import | Archivo | Qué actualiza |
|---|---|---|
| `import:productos` | Maestro de productos | Nombres, familias, ABC, bultos |
| `import:precios` | `precios - Precios.csv` | Todo el histórico de precios |
| `import:compras` | `Base Datos - Compras` | Las compras reales (gasto por proveedor e informe) |
| `import:movimientos` | `HISTORICO MOVIMIENTOS` | Movimientos históricos de 3c |
| `import:inventario` | `STOCKSDEFINITIVO` | La foto del stock contado |
| `import:proveedores` | Maestro de proveedores | Nombres y CUIT |

Todos son idempotentes. **La excepción a tener en cuenta:** el import de movimientos deduplica por
el número de 3c, y los movimientos que trae el sync no tienen ese número — así que importar un
período que el sync ya trajo **duplica**. Antes de importar un rango así, hay que anular lo que el
sync trajo. El procedimiento está en `IMPORTACION-3C.md`.

**Y el que más importa:** mientras sigas reimportando `precios - Precios.csv`, la planilla le gana
a la app. Si corregís un precio en Control precios y después reimportás, se pisa. El día que
quieras que la app sea la fuente de verdad de los precios, hay que dejar de correr ese import.
