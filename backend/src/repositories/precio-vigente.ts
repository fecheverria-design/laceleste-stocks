import { sql, type SQL } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// La prelación de precios, en un solo lugar.
//
// Un producto puede tener muchas filas en `precios` (varios proveedores, compras y
// actualizaciones, meses distintos). Cuál de todas es "el precio del producto" se
// decide SIEMPRE con este orden:
//
//   1. el precio CONTROLADO (marcado a mano en la hoja de Control de precios)
//   2. si no hay, la última COMPRA (lo que efectivamente se pagó)
//   3. si nunca hubo compra, la última ACTUALIZACION (precio de lista, como referencia)
//
// Por qué la marca manual va primero (decisión de J, 2026-08-04): tanto una compra como
// una actualización pueden ser un error de carga. Lo que compras marcó a mano es la
// verdad absoluta. Y es INDEPENDIENTE del tipo: una actualización marcada sigue siendo
// una actualización —no se le miente a la categoría—, pero manda.
//
// Antes esta regla estaba copiada en seis queries (precios vigentes, valorización del
// panel, consumos, matriz del informe, precio usado y serie mensual). Vive acá para que
// cambiarla siga siendo un solo lugar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cláusula ORDER BY que deja primero la fila que manda.
 *
 * @param alias cómo entró la tabla `precios` a la query (`'p'`), o nada si va sin alias.
 */
export function ordenPrecio(alias?: string): SQL {
  const col = (nombre: string) => sql.raw(alias ? `${alias}.${nombre}` : nombre);
  return sql`(${col('controlado_en')} IS NOT NULL) DESC, (${col('tipo')} = 'COMPRA') DESC, ${col('vigente_desde')} DESC, ${col('id')} DESC`;
}

/** `true` cuando la fila es la que el área de compras marcó como precio controlado. */
export function esControlado(alias?: string): SQL {
  return sql`(${sql.raw(alias ? `${alias}.controlado_en` : 'controlado_en')} IS NOT NULL)`;
}
