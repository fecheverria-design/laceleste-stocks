// Reglas de negocio sobre familias de productos (rubros de 3c).

// Familias que NO son compras reales de insumos: honorarios/servicios, flete
// tercerizado, ajustes de saldo contable (redondeo de centavos, notas de crédito),
// gastos de socios, impuestos y gastos bancarios.
// Se EXCLUYEN del análisis de compras/gasto por proveedor (decisión de J, 2026-07-01).
// No son productos que se compren y stockeen: contarlos infla el gasto real.
// Los nombres son EXACTOS como vienen en 3c (mayúsculas). Se comparan normalizados.
export const FAMILIAS_NO_COMPRA = [
  'SERVICIOS',
  'TRANSPORTE TERCERIZADO',
  'AJUSTE DE SALDO',
  'GASTOS SOCIOS',
  'IMPUESTOS',
  'GASTOS BANCARIOS',
] as const;

const EXCLUIDAS = new Set<string>(FAMILIAS_NO_COMPRA.map((f) => f.toUpperCase()));

// true si esa familia SÍ cuenta como compra real (para filtrar en el análisis de gasto).
export function esCompraReal(familia: string | null | undefined): boolean {
  return !EXCLUIDAS.has((familia ?? '').trim().toUpperCase());
}

// Familias que NO se muestran en el GRÁFICO de gasto por proveedor: las que no son compra
// real (arriba) + los productos esporádicos (compras no recurrentes, no de insumos
// productivos, que J no quiere en el gráfico). Decisión de J, 2026-07-02.
export const FAMILIAS_EXCLUIDAS_GASTO = [...FAMILIAS_NO_COMPRA, 'PRODUCTOS ESPORADICOS'] as const;

// Productos FICTICIOS / de prueba (por codigo_3c): no cuentan en NINGÚN reporte de plata —
// ni gasto, ni valorización del Panel. PRUEBA (480) tenía ~$12 M de compras falsas y stock
// inventado. Decisión de J, 2026-07-02.
export const PRODUCTOS_FICTICIOS = ['480'] as const;

const FAMILIAS_GASTO_SET = new Set<string>(FAMILIAS_EXCLUIDAS_GASTO.map((f) => f.toUpperCase()));
const FICTICIOS_SET = new Set<string>(PRODUCTOS_FICTICIOS);

// true si el producto NO es ficticio (cuenta en la valorización / Panel y demás reportes).
export function esProductoReal(codigo3c: string): boolean {
  return !FICTICIOS_SET.has(codigo3c);
}

// true si esa compra (por familia del producto + código) cuenta en el gráfico de gasto.
// Un producto sin familia se conserva (no cae en la lista de familias excluidas).
export function cuentaEnGasto(familia: string | null | undefined, codigo3c: string): boolean {
  if (FICTICIOS_SET.has(codigo3c)) return false;
  return !FAMILIAS_GASTO_SET.has((familia ?? '').trim().toUpperCase());
}
