import { inArray } from 'drizzle-orm';
import { db } from './client.js';
import { productos } from './schema.js';

// Chequeo del maestro compartido por los dos syncs (abastecimientos y recepciones).
//
// POR QUÉ EXISTE: los movimientos vienen de la app del compañero, que usa el maestro de 3c.
// Cuando en 3c dan de alta un producto nuevo y nuestro maestro todavía no lo tiene, el
// service rechaza el movimiento COMPLETO (PRODUCTO_NO_ENCONTRADO, regla #1: no inventamos
// códigos). Para un POST manual eso está bien; para el sync es una bomba: un solo artículo
// nuevo hacía perder el abastecimiento entero de un área (caso real: el 26/07/2026 el RINT
// de Recetas no entró nunca por el producto 1189 GOMA XANTICA, que no estaba en el maestro).
//
// Regla del sync: un producto que falta saltea SU renglón, nunca el movimiento. Lo que se
// saltea se avisa por consola y queda anotado en las observaciones del movimiento, así el
// agujero se ve desde la app y no solo en el log. Cuando el producto se da de alta, el modo
// reconciliar reedita el movimiento dentro de la ventana móvil y el renglón entra solo.

// Códigos de producto que SÍ existen en nuestro maestro (los demás no se pueden mover).
export async function existentesEnMaestro(codigos: string[]): Promise<Set<string>> {
  const unicos = [...new Set(codigos)];
  if (unicos.length === 0) return new Set();
  const rows = await db
    .select({ c: productos.codigo3c })
    .from(productos)
    .where(inArray(productos.codigo3c, unicos));
  return new Set(rows.map((r) => r.c));
}

// Parte los renglones en los que se pueden materializar y los códigos que faltan.
// `faltantes` viene sin repetir y en el orden en que aparecieron (para el aviso).
export function separarPorMaestro<T extends { producto_3c: string }>(
  renglones: T[],
  existentes: Set<string>,
): { detalle: T[]; faltantes: string[] } {
  const detalle: T[] = [];
  const faltantes: string[] = [];
  for (const r of renglones) {
    if (existentes.has(r.producto_3c)) {
      detalle.push(r);
    } else if (!faltantes.includes(r.producto_3c)) {
      faltantes.push(r.producto_3c);
    }
  }
  return { detalle, faltantes };
}

// Sufijo para las observaciones del movimiento: deja el rastro de lo que quedó afuera.
// Vacío cuando no falta nada → las observaciones quedan idénticas a las de siempre y el
// diff del modo reconciliar no se ensucia.
export function notaFaltantes(faltantes: string[]): string {
  return faltantes.length > 0 ? ` — SIN ALTA EN EL MAESTRO (renglón salteado): ${faltantes.join(', ')}` : '';
}
