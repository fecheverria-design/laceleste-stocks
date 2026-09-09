// ─────────────────────────────────────────────────────────────────────────────
// ¿Despachó lo que había que despachar?
//
// Compara el PEDIDO (lo que la app del compañero dijo que había que abastecer) contra el
// DESPACHO (lo que se cargó como abastecido realmente), por (día, área, producto). Las dos
// puntas salen del MISMO documento, así que no hay corrimiento de fecha ni problema de
// cobertura: es la única comparación limpia que tenemos. (Contra 3c no se puede día por día:
// medido sobre jul-sep 2026, el 64% de los casos no tiene contraparte el mismo día.)
//
// LA IDEA CENTRAL (decisión de J 2026-09-09): una diferencia se marca solo si NO la explica
// ninguna razón legítima. Y cuáles son legítimas depende de la UNIDAD DE MEDIDA:
//
//   · Lo que se pesa o se corta (KG, L): no se puede despachar exacto. Vale el redondeo a
//     la pieza entera Y una tolerancia porcentual.
//   · Lo que viene entero (UN, CJ): vale el redondeo al bulto y una unidad de diferencia,
//     pero NO un porcentaje — un 10% de un pedido de 3.600 bolsas serían 360 bolsas
//     perdonadas. (Medido: la tolerancia relativa no salvaba ni un caso de unidades enteras,
//     así que sacarla no cambia ningún número y evita ese agujero.)
//
// Lo que la regla NO puede resolver queda para la persona: cada caso marcado se revisa a
// mano y esa revisión le gana al automatismo (ver `abastecimiento_revisiones`).
// ─────────────────────────────────────────────────────────────────────────────

/** Diferencia porcentual perdonada en lo que se pesa o se corta. */
export const TOLERANCIA_RELATIVA = 0.1;

/** Diferencia absoluta perdonada siempre: un pedido de 6 y un despacho de 5 no es un error. */
export const TOLERANCIA_ABSOLUTA = 1;

/**
 * Unidades que se fraccionan (se pesan, se cortan, se sirven). Son las únicas donde la
 * tolerancia porcentual tiene sentido. El maestro de 3c trae KG, UN, L, CJ, M, LTS, UNIDAD.
 */
export const UNIDADES_FRACCIONABLES = ['KG', 'L', 'LT', 'LTS', 'M'] as const;

export function seFracciona(unidadBase: string | null): boolean {
  if (unidadBase === null) return false;
  return (UNIDADES_FRACCIONABLES as readonly string[]).includes(unidadBase.trim().toUpperCase());
}

export type Resultado = 'CUMPLE' | 'DE_MAS' | 'DE_MENOS';
/** Qué razón legítima explica la diferencia (null = ninguna, queda marcada). */
export type Motivo = 'EXACTO' | 'HORMA' | 'RELATIVA' | 'ABSOLUTA' | null;

export interface Veredicto {
  resultado: Resultado;
  motivo: Motivo;
  /** El pedido redondeado a piezas enteras: el rango de despacho que se considera correcto. */
  piso: number;
  techo: number;
}

// Ruido de redondeo del numeric(12,3).
const EPSILON = 0.001;

/**
 * Juzga un caso. `horma` son las unidades base que trae una pieza/bulto (25 kg la bolsa de
 * harina, 8 kg el salame, 12 rollos el bulto); 1 o null = se cuenta suelto.
 */
export function juzgar(
  pedido: number,
  despacho: number,
  horma: number | null,
  unidadBase: string | null,
): Veredicto {
  const pieza = horma !== null && horma > 0 ? horma : 1;
  const piso = Math.floor(pedido / pieza) * pieza;
  const techo = Math.ceil(pedido / pieza) * pieza;
  const dif = despacho - pedido;

  const cumple = (motivo: Motivo): Veredicto => ({ resultado: 'CUMPLE', motivo, piso, techo });

  if (Math.abs(dif) <= EPSILON) return cumple('EXACTO');
  // A) El despacho es el pedido redondeado a piezas enteras (el salame de 8 kg: pediste 15,
  // mandás 8 o 16, y cualquier cosa en el medio también está bien).
  //
  // OJO con el pedido MENOR a una pieza: ahí `piso` es 0 y el rango [0, pieza] se traga
  // cualquier despacho. Un pedido de 100 bolsas con bulto de 2.000 no justifica mandar 40:
  // se puede abrir el bulto y contar 100. Por eso, cuando el pedido no llega a una pieza,
  // lo único que la pieza justifica es mandar el bulto cerrado.
  if (piso > EPSILON && despacho >= piso - EPSILON && despacho <= techo + EPSILON) return cumple('HORMA');
  // Pedido menor a una pieza: lo único que la pieza justifica es mandar el bulto cerrado.
  // Con margen si se pesa —una caja que da 4,24 en la balanza y no los 4,268 nominales sigue
  // siendo la misma caja—; sin margen en lo que viene entero: 1.999 bolsas no son un bulto.
  if (pieza > 1 && piso <= EPSILON) {
    const margenPieza = seFracciona(unidadBase) ? techo * TOLERANCIA_RELATIVA : EPSILON;
    if (Math.abs(despacho - techo) <= margenPieza) return cumple('HORMA');
  }
  // B) Solo para lo que se pesa o se corta: la diferencia entra en la tolerancia porcentual.
  if (seFracciona(unidadBase) && Math.abs(dif) <= pedido * TOLERANCIA_RELATIVA) return cumple('RELATIVA');
  // C) Una unidad de diferencia no es un error, aunque en un pedido chico dé mucho %.
  if (Math.abs(dif) <= TOLERANCIA_ABSOLUTA) return cumple('ABSOLUTA');

  return { resultado: dif > 0 ? 'DE_MAS' : 'DE_MENOS', motivo: null, piso, techo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sesgo sistemático: el producto que falla casi todos los días, siempre para el mismo lado.
//
// Eso no es alguien despachando mal — nadie se equivoca 45 de 46 veces en la misma dirección.
// Es el sugerido calculado sobre otra base (BOLSA DE SANDWICH: pide 3.600 y se despachan 500,
// todos los días, ratio 0,23 con desvío 0,12). Estos productos salen del indicador y van a
// una lista propia: lo que hay que corregir ahí es el pedido, no el despacho.
// ─────────────────────────────────────────────────────────────────────────────

/** Días mínimos para poder hablar de "siempre". Con menos, es anécdota. */
export const SESGO_DIAS_MINIMOS = 5;
/** Proporción de días marcados a partir de la cual el problema es del producto. */
export const SESGO_PROPORCION = 0.8;

export interface SerieProducto {
  dias: number;
  marcados: number;
  deMas: number;
  deMenos: number;
}

export function tieneSesgoSistematico(s: SerieProducto): boolean {
  if (s.dias < SESGO_DIAS_MINIMOS) return false;
  if (s.marcados < SESGO_PROPORCION * s.dias) return false;
  // Y siempre para el mismo lado: si un día sobra y otro falta, es despacho, no parametrización.
  const dominante = Math.max(s.deMas, s.deMenos);
  return dominante >= SESGO_PROPORCION * s.marcados;
}
