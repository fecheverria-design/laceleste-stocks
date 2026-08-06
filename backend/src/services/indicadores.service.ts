import type { GuardarIndicadorInput, IndicadoresQuery } from '../domain/indicadores.schema.js';
import { guardarIndicador, listarIndicadores } from '../repositories/indicadores.repository.js';

// Ventas e inflación por mes. La inflación viaja como FRACCIÓN (0.025 = 2,5%), igual que
// todas las variaciones de la app; el % se arma en pantalla.
//
// Se puede cargar de las dos formas en que se publica —mensual o acumulada del año— porque
// según de dónde salga el dato uno tiene una o la otra a mano. `inflacion` es lo que se
// tipeó, `inflacion_modo` dice qué significa, y las DOS series salen derivadas: el informe
// consume siempre `inflacion_mensual` y no se entera de cómo se cargó.

export type InflacionModo = 'MENSUAL' | 'ACUMULADA';

export interface IndicadorMensual {
  periodo: string;
  ventas: number | null;
  /** Lo que se cargó, tal cual. Su significado lo da `inflacion_modo`. */
  inflacion: number | null;
  inflacion_modo: InflacionModo;
  /** Variación del mes. Derivada si se cargó acumulada. */
  inflacion_mensual: number | null;
  /** Acumulada del año calendario. Derivada si se cargó mensual. */
  inflacion_acumulada: number | null;
  actualizado_en: string;
}

const aNumero = (s: string | null): number | null => {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const anio = (periodo: string): string => periodo.slice(0, 4);

/**
 * Completa las dos series de inflación a partir de lo cargado.
 *
 * El acumulado del año arranca en 0 en diciembre del año anterior (convención del "acumulado
 * del año" que publica el INDEC), así que enero es el único mes donde acumulada y mensual
 * coinciden, y cada 1° de enero la cuenta vuelve a empezar.
 *
 * Un mes sin cargar rompe la cadena: de ahí en adelante solo se conoce el dato del modo en
 * que vino, y el otro queda en null hasta el enero siguiente. Es a propósito: derivar
 * salteando un mes da un número más chico que el real sin que nadie se dé cuenta.
 *
 * Recibe TODAS las filas (no un rango recortado): la derivación de marzo necesita febrero.
 */
export function derivarInflacion(
  filas: Array<{ periodo: string; inflacion: number | null; inflacion_modo: InflacionModo }>,
): Map<string, { mensual: number | null; acumulada: number | null }> {
  const out = new Map<string, { mensual: number | null; acumulada: number | null }>();
  const ordenadas = [...filas].sort((a, b) => a.periodo.localeCompare(b.periodo));

  // Acumulada del mes anterior. null = desconocida (falta un mes o no se pudo derivar).
  let acumPrevia: number | null = null;
  let anioPrevio = '';
  let mesPrevio = '';

  for (const fila of ordenadas) {
    const anioActual = anio(fila.periodo);
    // Enero reinicia el acumulado; un salto de meses (feb → abr) lo corta.
    if (anioActual !== anioPrevio) {
      acumPrevia = fila.periodo.endsWith('-01') ? 0 : null;
    } else if (mesSiguiente(mesPrevio) !== fila.periodo) {
      acumPrevia = null;
    }

    let mensual: number | null = null;
    let acumulada: number | null = null;

    if (fila.inflacion !== null) {
      if (fila.inflacion_modo === 'ACUMULADA') {
        acumulada = fila.inflacion;
        mensual = acumPrevia === null ? null : (1 + acumulada) / (1 + acumPrevia) - 1;
      } else {
        mensual = fila.inflacion;
        acumulada = acumPrevia === null ? null : (1 + acumPrevia) * (1 + mensual) - 1;
      }
    }

    out.set(fila.periodo, { mensual, acumulada });
    acumPrevia = acumulada;
    anioPrevio = anioActual;
    mesPrevio = fila.periodo;
  }

  return out;
}

/** '2026-01' → '2026-02'. */
function mesSiguiente(periodo: string): string {
  if (!periodo) return '';
  const [a, m] = periodo.split('-');
  const mes = Number(m);
  return mes === 12 ? `${Number(a) + 1}-01` : `${a}-${String(mes + 1).padStart(2, '0')}`;
}

export async function obtenerIndicadores(rango: IndicadoresQuery): Promise<IndicadorMensual[]> {
  // Se leen todas las filas y el rango se aplica DESPUÉS: derivar marzo necesita febrero, y
  // recortar antes daría null en el primer mes del rango. La tabla son doce filas por año.
  const filas = await listarIndicadores();
  const derivadas = derivarInflacion(
    filas.map((f) => ({
      periodo: f.periodo,
      inflacion: aNumero(f.inflacion),
      inflacion_modo: f.inflacion_modo,
    })),
  );

  return filas
    .filter((f) => (!rango.desde || f.periodo >= rango.desde) && (!rango.hasta || f.periodo <= rango.hasta))
    .map((f) => {
      const d = derivadas.get(f.periodo);
      return {
        periodo: f.periodo,
        ventas: aNumero(f.ventas),
        inflacion: aNumero(f.inflacion),
        inflacion_modo: f.inflacion_modo,
        inflacion_mensual: d?.mensual ?? null,
        inflacion_acumulada: d?.acumulada ?? null,
        actualizado_en: f.actualizado_en.toISOString(),
      };
    });
}

export async function registrarIndicador(
  input: GuardarIndicadorInput,
  ctx: { usuarioId: number },
): Promise<IndicadorMensual> {
  await guardarIndicador({ ...input, usuarioId: ctx.usuarioId });
  // Se devuelve leyendo de nuevo: guardar un mes cambia las derivadas de los que siguen, y
  // la fila del insert sola no las conoce.
  const [fila] = await obtenerIndicadores({ desde: input.periodo, hasta: input.periodo });
  if (!fila) throw new Error('No se pudo guardar el indicador mensual');
  return fila;
}

export interface SerieIndicadores {
  /** Ventas de cada mes de la ventana; null donde no se cargó. */
  ventas: Array<number | null>;
  /** Inflación MENSUAL (fracción) de cada mes; null donde no se pudo saber. */
  inflacion: Array<number | null>;
  /** Inflación acumulada de las últimas N ventanas que terminan en el último mes. */
  acumulada: (meses: number) => number | null;
}

/**
 * Alinea lo cargado contra una ventana de meses, para que el informe pueda usarlo sin
 * preocuparse por los huecos. Un mes sin cargar queda en null y se propaga como "—".
 */
export function alinearSerie(indicadores: IndicadorMensual[], meses: string[]): SerieIndicadores {
  const porMes = new Map(indicadores.map((i) => [i.periodo, i]));
  const ventas = meses.map((m) => porMes.get(m)?.ventas ?? null);
  const inflacion = meses.map((m) => porMes.get(m)?.inflacion_mensual ?? null);

  // Inflación compuesta de los últimos N meses. Si falta algún mes del tramo se devuelve
  // null: una acumulada con huecos subestima y nadie se daría cuenta.
  const acumulada = (n: number): number | null => {
    if (n <= 0 || n > inflacion.length) return null;
    const tramo = inflacion.slice(inflacion.length - n);
    if (tramo.some((v) => v === null)) return null;
    return tramo.reduce<number>((acc, v) => acc * (1 + v!), 1) - 1;
  };

  return { ventas, inflacion, acumulada };
}
