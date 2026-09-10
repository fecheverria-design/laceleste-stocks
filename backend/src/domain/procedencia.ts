import {
  COMPRADORES,
  FAMILIAS_EXCLUIDAS_GASTO,
  FAMILIAS_POR_COMPRADOR,
  PRODUCTOS_FICTICIOS,
  type Comprador,
} from './familias.js';

// ─────────────────────────────────────────────────────────────────────────────
// De dónde sale cada número del informe.
//
// El objetivo (pedido de J, 2026-09-08) es poder AUDITAR la lógica: para cada monto que
// muestra la app, ver de qué tabla salió, hasta qué fecha llega el dato, qué se incluyó,
// qué se dejó afuera y cómo se trató el IVA. Sirve sobre todo para el día que dejemos de
// leer 3c: la ficha es el acta de cómo se calculaba.
//
// REGLA DE ORO de este módulo: la ficha se ARMA CON LAS MISMAS CONSTANTES que usa la query.
// Nunca con texto escrito a mano describiendo lo que la query "hace". Si mañana alguien
// agrega una familia a FAMILIAS_EXCLUIDAS_GASTO, la ficha lo dice sola. Una ficha copiada
// a mano es peor que no tener ficha: envejece sin avisar y termina mintiendo con autoridad.
// ─────────────────────────────────────────────────────────────────────────────

/** Un renglón del fundamento: qué se hizo y con qué. `items` es para las listas largas. */
export interface PasoFicha {
  titulo: string;
  detalle: string;
  items?: string[];
}

export interface Ficha {
  /** Qué número explica esta ficha. */
  titulo: string;
  pasos: PasoFicha[];
}

/** Lo que la app sabe de la tabla `compras` al momento de responder. */
export interface CoberturaCompras {
  renglones: number;
  /** Fecha de la compra más vieja y más nueva cargadas (todas, no solo del mes). */
  desde: string | null;
  hasta: string | null;
  /** Renglones sin `total_con_iva`: entraron antes de que el sync reconstruyera el IVA. */
  sin_iva: number;
}

function listaEs(items: readonly string[]): string {
  if (items.length === 0) return 'ninguna';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]!}`;
}

function mesLegible(mes: string): string {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [anio, m] = mes.split('-');
  const i = Number(m) - 1;
  return MESES[i] === undefined ? mes : `${MESES[i]} ${anio}`;
}

/**
 * Ficha del GASTO del informe de compras (el número de "lo que compró Fausto", el total del
 * mes y el de cada proveedor: los tres salen de la misma query con distinto agrupamiento).
 *
 * @param comprador si viene, la ficha explica el recorte de ese comprador; si no, el total.
 */
export function fichaGasto(opts: {
  mes: string;
  comprador?: Comprador;
  renglonesDelMes: number;
  proveedores: number;
  productos: number;
  cobertura: CoberturaCompras;
}): Ficha {
  const { mes, comprador, renglonesDelMes, proveedores, productos, cobertura } = opts;
  const familiasDelComprador = comprador ? FAMILIAS_POR_COMPRADOR[comprador] : null;
  const todasLasDeCompradores = COMPRADORES.flatMap((c) => FAMILIAS_POR_COMPRADOR[c]);

  const pasos: PasoFicha[] = [
    {
      titulo: 'De dónde sale el dato',
      detalle:
        `De la tabla \`compras\`, que se llena leyendo 3c en vivo (vista \`V_COMP_PRECIOS_CPRA\` ` +
        `por el proxy SQL de solo lectura). Hoy hay ${cobertura.renglones.toLocaleString('es-AR')} renglones cargados` +
        (cobertura.desde && cobertura.hasta ? `, del ${cobertura.desde} al ${cobertura.hasta}` : '') +
        `. Este número usa los ${renglonesDelMes.toLocaleString('es-AR')} renglones de ${mesLegible(mes)}, ` +
        `de ${proveedores} proveedor(es) y ${productos} producto(s).`,
    },
    {
      titulo: 'Qué se incluye',
      detalle: comprador
        ? `Solo las familias que compra ${comprador}. Lo que no cae en la lista de ningún comprador ` +
          `(servicios, esporádicos, etc.) no suma a nadie y queda fuera del informe.`
        : `Solo las familias que tienen comprador asignado. Lo que no cae en ninguna lista no suma a nadie.`,
      items: [...(familiasDelComprador ?? todasLasDeCompradores)],
    },
    {
      titulo: 'Qué se deja afuera',
      detalle:
        `Estas familias NO son compra de insumos (honorarios, fletes tercerizados, ajustes contables, ` +
        `impuestos) y contarlas infla el gasto real. Además se excluye el producto ` +
        `${listaEs(PRODUCTOS_FICTICIOS)} por ser ficticio / de prueba.`,
      items: [...FAMILIAS_EXCLUIDAS_GASTO],
    },
    {
      titulo: '¿Tiene IVA?',
      detalle:
        `Sí. El monto es el total CON IVA. 3c da el neto y las bases gravada y exenta, pero no la ` +
        `alícuota, así que se reconstruye: con_iva = exento + gravado × (1 + alícuota), con la ` +
        `alícuota por producto de \`V_PRECIO_BASE\` (21, 10,5 o 27) y 21% de fallback si el producto ` +
        `no está en esa foto.` +
        (cobertura.sin_iva > 0
          ? ` ⚠ Hay ${cobertura.sin_iva.toLocaleString('es-AR')} renglón(es) sin IVA reconstruido (entraron ` +
            `antes de que el sync lo trajera): para esos se usa el neto, así que el total queda apenas corto.`
          : ''),
    },
  ];

  return {
    titulo: comprador ? `Gasto de ${comprador} — ${mesLegible(mes)}` : `Gasto total — ${mesLegible(mes)}`,
    pasos,
  };
}

/**
 * Ficha del PRECIO que la app usa para un producto. Explica la prelación de
 * `repositories/precio-vigente.ts`, que es la regla que más se olvida y la que más discute
 * compras cuando un número no le cierra.
 *
 * Sirve en dos modos, con el mismo texto de la regla:
 * - **genérico** (catálogo "Cómo se calcula"): sin producto, explica la prelación a secas;
 * - **concreto** (una fila de la hoja de Precios): con `producto` y `descartados`, dice cuál
 *   de todos los precios cargados ganó y cuántos quedaron abajo.
 */
export function fichaPrecio(opts: {
  controlado: boolean;
  tipo: string | null;
  fecha: string | null;
  proveedor: string | null;
  /** Nombre del producto, cuando la ficha explica una fila concreta y no la regla en general. */
  producto?: string;
  /** Cuántos precios más tiene cargados el producto (los que perdieron la prelación). */
  descartados?: number;
}): Ficha {
  const { controlado, tipo, fecha, proveedor, producto, descartados } = opts;
  const cual = controlado
    ? 'el precio CONTROLADO, marcado a mano por compras'
    : tipo === 'COMPRA'
      ? 'la última COMPRA (lo que efectivamente se pagó)'
      : tipo === 'ACTUALIZACION'
        ? 'la última ACTUALIZACION (precio de lista), porque nunca hubo una compra'
        : 'ninguno: el producto no tiene precio cargado';

  return {
    titulo: producto ? `De dónde sale el precio de ${producto}` : 'De dónde sale este precio',
    pasos: [
      {
        titulo: 'Cuál se está usando',
        detalle:
          `Se está usando ${cual}` +
          (fecha ? `, del ${fecha}` : '') +
          (proveedor ? `, de ${proveedor}` : '') +
          '.' +
          (descartados !== undefined && descartados > 0
            ? ` El producto tiene ${descartados + 1} precio(s) cargado(s) en total: los otros ` +
              `${descartados} quedan como historial y no se usan para valorizar.`
            : ''),
      },
      {
        titulo: 'La prelación, siempre en este orden',
        detalle:
          'Un producto puede tener muchos precios (varios proveedores, compras y actualizaciones, ' +
          'meses distintos). Cuál manda se decide siempre así. La marca manual va primero porque ' +
          'tanto una compra como una actualización pueden ser un error de carga; lo que compras ' +
          'marcó a mano es la verdad.',
        items: [
          '1. el precio CONTROLADO (marcado a mano en la hoja de Control de precios)',
          '2. si no hay, la última COMPRA (lo que efectivamente se pagó)',
          '3. si nunca hubo compra, la última ACTUALIZACION (precio de lista, como referencia)',
        ],
      },
      {
        titulo: 'Ojo con esto',
        detalle:
          'La marca de controlado NO cambia el tipo: una actualización marcada sigue siendo una ' +
          'actualización (no se le miente a la categoría), pero manda igual.',
      },
    ],
  };
}
