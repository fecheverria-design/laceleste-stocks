import type { GuardarIndicadorInput, IndicadoresQuery } from '../domain/indicadores.schema.js';
import { guardarIndicador, listarIndicadores } from '../repositories/indicadores.repository.js';

// Ventas e inflación por mes. La inflación viaja como FRACCIÓN (0.025 = 2,5%), igual que
// todas las variaciones de la app; el % se arma en pantalla.

export interface IndicadorMensual {
  periodo: string;
  ventas: number | null;
  inflacion: number | null;
  actualizado_en: string;
}

const aNumero = (s: string | null): number | null => {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export async function obtenerIndicadores(rango: IndicadoresQuery): Promise<IndicadorMensual[]> {
  const filas = await listarIndicadores(rango);
  return filas.map((f) => ({
    periodo: f.periodo,
    ventas: aNumero(f.ventas),
    inflacion: aNumero(f.inflacion),
    actualizado_en: f.actualizado_en.toISOString(),
  }));
}

export async function registrarIndicador(
  input: GuardarIndicadorInput,
  ctx: { usuarioId: number },
): Promise<IndicadorMensual> {
  const fila = await guardarIndicador({ ...input, usuarioId: ctx.usuarioId });
  return {
    periodo: fila.periodo,
    ventas: aNumero(fila.ventas),
    inflacion: aNumero(fila.inflacion),
    actualizado_en: fila.actualizado_en.toISOString(),
  };
}

export interface SerieIndicadores {
  /** Ventas de cada mes de la ventana; null donde no se cargó. */
  ventas: Array<number | null>;
  /** Inflación mensual (fracción) de cada mes; null donde no se cargó. */
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
  const inflacion = meses.map((m) => porMes.get(m)?.inflacion ?? null);

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
