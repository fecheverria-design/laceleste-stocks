// Formateo y derivaciones del Informe de Compras. Son las funciones `fmt`, `fMjs`,
// `pctTxt` y `toMoM` del Apps Script de J, para que los números se lean igual que en su
// HTML. Las piezas visuales que las usan viven en piezas.tsx.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-06' → 'jun 2026'. */
export function mesLargo(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m} ${a}`;
}

/** 'jun 2026' → 'Jun 2026'. */
export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Moneda completa. Los importes chicos llevan decimales; los grandes, no. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${n.toLocaleString('es-AR', { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
}

/** Moneda abreviada para los KPI y las barras: $1,20B · $530M · $12k. */
export function fMjs(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const signo = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${signo}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${signo}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${signo}$${(abs / 1e3).toFixed(0)}k`;
  return `${signo}$${abs.toFixed(0)}`;
}

/** Porcentaje con signo. Recibe FRACCIÓN (0.12 → '+12,0%'). */
export function pctTxt(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return '—';
  const p = v * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(dec)}%`;
}

/** Clase de color de una variación: subir es malo (naranja), bajar es bueno (verde). */
export function claseVar(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'flat';
  const p = v * 100;
  return p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'flat';
}

/** '2026-06-10' → '10/06/26', como en el informe. */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a?.slice(2)}`;
}

/**
 * Deriva la variación mes a mes exacta a partir de la serie acumulada anclada.
 * Es el `toMoM` del script: descomponer el acumulado da el mismo número que calcular la
 * variación del mes directo, y evita mandar dos series desde el backend.
 */
export function aMensual(acumulada: Array<number | null>): Array<number | null> {
  const out: Array<number | null> = [null];
  for (let i = 1; i < acumulada.length; i++) {
    const hoy = acumulada[i];
    const ayer = acumulada[i - 1];
    if (hoy === null || hoy === undefined || ayer === null || ayer === undefined) {
      out.push(null);
      continue;
    }
    out.push((1 + hoy) / (1 + ayer) - 1);
  }
  return out;
}

/**
 * Convierte variaciones mes a mes en una serie acumulada con base 0 en el mes ancla.
 * Compone hacia adelante y descompone hacia atrás, igual que `anclar()` del backend: así la
 * inflación y la canasta se pueden comparar sobre el mismo eje.
 * Un mes sin dato corta la serie: de ahí en adelante es null, porque acumular salteando un
 * mes daría un número más chico que el real sin que se note.
 */
export function anclarSerie(varMensual: Array<number | null>, anclaIdx: number): Array<number | null> {
  const out: Array<number | null> = varMensual.map(() => null);
  if (anclaIdx < 0 || anclaIdx >= varMensual.length) return out;
  out[anclaIdx] = 0;

  let factor = 1;
  for (let i = anclaIdx + 1; i < varMensual.length; i++) {
    const v = varMensual[i];
    if (v === null || v === undefined) break;
    factor *= 1 + v;
    out[i] = factor - 1;
  }
  factor = 1;
  for (let j = anclaIdx - 1; j >= 0; j--) {
    const v = varMensual[j + 1];
    if (v === null || v === undefined) break;
    factor /= 1 + v;
    out[j] = factor - 1;
  }
  return out;
}

/**
 * Inflación acumulada de los últimos N meses de la ventana. null si falta algún mes del
 * tramo: una acumulada con huecos subestima y nadie se daría cuenta.
 */
export function inflacionAcumulada(inflacion: Array<number | null>, meses: number): number | null {
  if (meses <= 0 || meses > inflacion.length) return null;
  const tramo = inflacion.slice(inflacion.length - meses);
  if (tramo.some((v) => v === null || v === undefined)) return null;
  return tramo.reduce<number>((acc, v) => acc * (1 + v!), 1) - 1;
}
