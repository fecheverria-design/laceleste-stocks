import { FAMILIAS_EXCLUIDAS_GASTO, PRODUCTOS_FICTICIOS } from './familias.js';
import { fichaGasto, fichaPrecio, type CoberturaCompras, type Ficha } from './procedencia.js';

// ─────────────────────────────────────────────────────────────────────────────
// EL CATÁLOGO: la ficha de cada número de la app, agrupada por hoja.
//
// Pedido de J (2026-09-08): tener el fundamento de todos los cálculos, sobre todo pensando
// en el día que dejemos de leer 3c. Este archivo es el acta.
//
// Vale la misma regla de oro que en procedencia.ts: todo lo que se afirma sale de una
// constante real o de un dato consultado en el momento. Nada está escrito a mano describiendo
// lo que el código "hace" — eso envejece sin avisar y termina mintiendo con autoridad.
//
// Los umbrales del informe de precios llegan por PARÁMETRO y no por import: viven en un
// service, y el dominio no puede depender de la capa de arriba (regla #3).
// ─────────────────────────────────────────────────────────────────────────────

export interface GrupoFichas {
  hoja: string;
  /** De qué va la hoja, en una línea. */
  resumen: string;
  fichas: Ficha[];
}

/** Lo que hay que consultar para que el catálogo diga números de verdad y no generalidades. */
export interface ContextoFichas {
  compras: CoberturaCompras;
  /** Renglones de compra del último mes con datos: para que la ficha del gasto no diga 0. */
  renglonesUltimoMes: number;
  productos: { total: number; conPrecio: number; creadosLocal: number };
  proveedores: number;
  stock: { filas: number; depositosConStock: number; ultimaFoto: string | null };
  precios: { filas: number; controlados: number };
  movimientos: { confirmados: number; desde: string | null; hasta: string | null; deTresC: number };
  umbrales: {
    diasVigente: number;
    diasFresca: number;
    objetivoCotizaciones: number;
    umbralSalto: number;
    outlierMax: number;
    anclaCanasta: string;
  };
}

const n = (v: number): string => v.toLocaleString('es-AR');

function listaEs(items: readonly string[]): string {
  if (items.length === 0) return 'ninguno';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]!}`;
}

export function catalogoFichas(ctx: ContextoFichas): GrupoFichas[] {
  const { compras, renglonesUltimoMes, productos, proveedores, stock, precios, movimientos, umbrales } = ctx;

  const fichaStock: Ficha = {
    titulo: 'La cantidad que ves en Stock',
    pasos: [
      {
        titulo: 'Cómo se calcula',
        detalle:
          `No es un número guardado: se recalcula reproduciendo TODOS los movimientos confirmados ` +
          `(${n(movimientos.confirmados)} hoy). Cada movimiento suma en su destino y resta en su origen, y ` +
          `siempre por la CANTIDAD REAL despachada, nunca por la sugerida: el egreso físico es la verdad. ` +
          `Un movimiento anulado deja de contar solo, sin contramovimiento.`,
      },
      {
        titulo: 'Quién manda al final',
        detalle:
          `3c. Cada hora entra la foto de stock de 3c y se aplica como un RECUENTO: genera un movimiento de ` +
          `INVENTARIO por la diferencia y deja la cantidad exacta en lo que dice 3c.` +
          (stock.ultimaFoto !== null ? ` La última entró el ${stock.ultimaFoto}.` : '') +
          ` Por eso, si la app y 3c difieren, gana 3c.`,
      },
      {
        titulo: 'Qué depósitos se llevan',
        detalle:
          `Solo los ${stock.depositosConStock} que la app stockea (hoy ${n(stock.filas)} combinaciones de ` +
          `producto y depósito). 3c tiene existencias en varios depósitos más —AJUSTES, PAÑOL, UNIFORMES, ` +
          `ADMINISTRACIÓN— que la app no lleva a propósito: no son un error, están fuera de alcance.`,
      },
    ],
  };

  const fichaMovimientos: Ficha = {
    titulo: 'De dónde sale cada movimiento',
    pasos: [
      {
        titulo: 'Las cuatro fuentes',
        detalle:
          `Hoy hay ${n(movimientos.confirmados)} movimientos confirmados` +
          (movimientos.desde !== null && movimientos.hasta !== null
            ? `, del ${movimientos.desde} al ${movimientos.hasta}`
            : '') +
          `, de los cuales ${n(movimientos.deTresC)} vinieron de 3c (son los que tienen número de documento de 3c).`,
        items: [
          'Sync de la app del compañero: los abastecimientos y recepciones del día, cada hora. No traen número de 3c.',
          'Importación de 3c: la información definitiva, cargada por semana. Traen su número de 3c y reemplazan a los anteriores.',
          'Foto de 3c: los INVENTARIO que ajustan el stock a lo que dice 3c, cada hora.',
          'Carga manual: los que se cargan a mano desde la hoja de Movimientos.',
        ],
      },
      {
        titulo: 'Por qué un movimiento puede aparecer anulado',
        detalle:
          'Anular no borra: cambia el estado, deja quién y cuándo, y el movimiento deja de contar en el stock ' +
          'sin necesidad de un contramovimiento. Las anulaciones de la importación semanal dejan su motivo en ' +
          'el historial del movimiento. Una anulación hecha por una persona nunca la revive el sync.',
      },
    ],
  };

  const fichaValorizacion: Ficha = {
    titulo: 'La valorización del stock',
    pasos: [
      {
        titulo: 'La cuenta',
        detalle:
          'Cantidad en stock × precio vigente del producto, sumado. Solo cuenta el stock POSITIVO: un ' +
          'negativo no resta plata, porque sería inventar un valor que no existe.',
      },
      {
        titulo: 'Qué precio usa',
        detalle:
          'El vigente al día de hoy con precio mayor que cero (un cero se trata como "sin precio", no como ' +
          'gratis), con la misma prelación que en toda la app: controlado, después última compra, después ' +
          'actualización.',
      },
      {
        titulo: 'Dónde queda corto',
        detalle:
          `De ${n(productos.total)} productos, ${n(productos.conPrecio)} tienen precio. Los ` +
          `${n(productos.total - productos.conPrecio)} que no lo tienen valen 0 en esta cuenta, así que la ` +
          `valorización SUBESTIMA. Se excluye además el producto ${listaEs(PRODUCTOS_FICTICIOS)} por ser ficticio.`,
      },
    ],
  };

  const fichaConsumos: Ficha = {
    titulo: 'El consumo por área',
    pasos: [
      {
        titulo: 'Qué cuenta como consumo',
        detalle:
          'Lo que SALE de FABRICA hacia un área de consumo, por producto. "Área de consumo" es un destino que ' +
          'no lleva stock y no es un balde virtual (101 AJUSTES / 102 PROVEEDORES). El filtro es por "lleva ' +
          'stock" y no por el tipo, porque en 3c hay áreas tipeadas como DEPOSITO que igual son consumo.',
      },
      {
        titulo: 'El costo',
        detalle:
          'Cantidad consumida × precio vigente, con la misma prelación de siempre. Si el producto no tiene ' +
          'precio, el costo queda vacío en vez de cero: no sabemos cuánto costó, y un cero mentiría.',
      },
    ],
  };

  const fichaArticulos: Ficha = {
    titulo: 'El maestro de productos',
    pasos: [
      {
        titulo: 'De dónde sale',
        detalle:
          `De 3c, sincronizado solo. Hoy son ${n(productos.total)} productos. El código, el nombre, la unidad ` +
          `y el rubro los manda 3c y se pisan en cada sincronización.`,
      },
      {
        titulo: 'Lo que 3c NO pisa',
        detalle:
          `La presentación de compra, las unidades por bulto, la clasificación ABC y el campo información son ` +
          `propios de la app: 3c no los conoce y la sincronización los conserva.` +
          (productos.creadosLocal > 0
            ? ` Además hay ${n(productos.creadosLocal)} producto(s) creado(s) acá con código propio, que no existen en 3c.`
            : ''),
      },
    ],
  };

  const fichaProveedores: Ficha = {
    titulo: 'El gasto por proveedor',
    pasos: [
      {
        titulo: 'De dónde sale',
        detalle:
          `De la tabla de compras leída de 3c, sumando el total CON IVA por proveedor. El maestro de ` +
          `proveedores también viene de 3c: hoy hay ${n(proveedores)}.`,
      },
      {
        titulo: 'Qué se deja afuera',
        detalle:
          `Las familias que no son compra de insumos, más los productos esporádicos y el producto ficticio ` +
          `${listaEs(PRODUCTOS_FICTICIOS)}. Sin esas exclusiones el gasto se infla con servicios, fletes e impuestos.`,
        items: [...FAMILIAS_EXCLUIDAS_GASTO],
      },
    ],
  };

  const fichaControl: Ficha = {
    titulo: 'Por qué un producto entra a Control de precios',
    pasos: [
      {
        titulo: 'Los umbrales',
        detalle:
          'Un producto entra a la lista de revisión cuando dispara alguna de estas alertas. Son los mismos ' +
          'números que usa el informe, no una copia aparte.',
        items: [
          `Cotización vencida: la última tiene más de ${umbrales.diasVigente} días y deja de contar como vigente.`,
          `Pocos proveedores: menos de ${umbrales.objetivoCotizaciones} cotizaciones frescas (frescas = de los últimos ${umbrales.diasFresca} días).`,
          `Salto de precio: la variación supera el ${Math.round(umbrales.umbralSalto * 100)}% de un mes al otro.`,
          'Sin compra en el período: hay precio de lista pero no se le compró.',
        ],
      },
      {
        titulo: 'El precio controlado',
        detalle:
          `De ${n(precios.filas)} precios cargados, ${n(precios.controlados)} están marcados como controlados. ` +
          `Esa marca le gana a cualquier compra posterior, y no cambia el tipo del precio: una actualización ` +
          `marcada sigue siendo una actualización.`,
      },
    ],
  };

  const fichaAhorro: Ficha = {
    titulo: 'El ahorro (a favor y en contra)',
    pasos: [
      {
        titulo: 'La comparación',
        detalle:
          `Por cada producto A comprado en el mes: el precio que se pagó contra la mejor cotización fresca de ` +
          `OTRO proveedor (fresca = de los últimos ${umbrales.diasFresca} días). Si la alternativa era más cara, ` +
          `se compró bien; si era más barata, había algo mejor disponible.`,
      },
      {
        titulo: 'Cómo se convierte en plata',
        detalle:
          'La diferencia porcentual se aplica sobre el gasto REAL del mes de ese producto. No es plata que ' +
          'entró o salió: es cuánto habría cambiado el gasto comprándole al otro, al mismo volumen.',
      },
      {
        titulo: 'Qué no dice',
        detalle:
          'No mira calidad, plazo de entrega, financiación ni el mínimo de compra del otro proveedor. Es una ' +
          'señal para ir a mirar, no un veredicto.',
      },
    ],
  };

  const fichaCanasta: Ficha = {
    titulo: 'El índice de la canasta',
    pasos: [
      {
        titulo: 'Cómo se arma',
        detalle:
          `Se toman los productos A y se sigue su precio mes a mes, con base 100 en ${umbrales.anclaCanasta}. ` +
          `El ancla es fija a propósito: si se moviera, los meses históricos cambiarían de valor cada vez que se ` +
          `recalcula y el gráfico dejaría de ser comparable.`,
      },
      {
        titulo: 'Qué se descarta',
        detalle:
          `Una variación mensual mayor al ${Math.round(umbrales.outlierMax * 100)}% se considera imposible y queda ` +
          `fuera del índice (se reporta aparte). Casi siempre es un precio mal cargado, y sin ese filtro un solo ` +
          `error deforma toda la serie.`,
      },
      {
        titulo: 'Contra qué se compara',
        detalle:
          'Contra la inflación que se carga a mano en la solapa de Datos. Se acepta cargada como variación ' +
          'mensual o como acumulada del año, y la serie que usa el gráfico se deriva de eso.',
      },
    ],
  };

  const mesUltimaCompra =
    compras.hasta !== null ? `${compras.hasta.slice(6, 10)}-${compras.hasta.slice(3, 5)}` : '';

  return [
    { hoja: 'Stock', resumen: 'Cuánto hay de cada producto en cada depósito.', fichas: [fichaStock] },
    {
      hoja: 'Movimientos',
      resumen: 'El historial: qué entró, qué salió, y de dónde salió cada registro.',
      fichas: [fichaMovimientos],
    },
    { hoja: 'Panel', resumen: 'La foto del día: cuánta plata hay parada en stock.', fichas: [fichaValorizacion] },
    { hoja: 'Consumos', resumen: 'Qué consume cada área y cuánto cuesta.', fichas: [fichaConsumos] },
    { hoja: 'Artículos', resumen: 'El maestro de productos.', fichas: [fichaArticulos] },
    { hoja: 'Proveedores', resumen: 'A quién le compramos y cuánto.', fichas: [fichaProveedores] },
    {
      hoja: 'Precios y Control de precios',
      resumen: 'Qué precio manda para cada producto, y cuáles hay que ir a revisar.',
      fichas: [fichaPrecio({ controlado: false, tipo: 'COMPRA', fecha: null, proveedor: null }), fichaControl],
    },
    {
      hoja: 'Informe de Compras',
      resumen: 'El gasto del mes por comprador, proveedor y producto.',
      fichas: [
        fichaGasto({
          mes: mesUltimaCompra,
          renglonesDelMes: renglonesUltimoMes,
          proveedores,
          productos: productos.total,
          cobertura: compras,
        }),
        fichaAhorro,
        fichaCanasta,
      ],
    },
  ];
}
