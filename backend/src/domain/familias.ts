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
