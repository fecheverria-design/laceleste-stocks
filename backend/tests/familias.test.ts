import { describe, expect, it } from 'vitest';
import { FAMILIAS_NO_COMPRA, esCompraReal } from '../src/domain/familias.js';

// Familias que no son compras reales (servicios, flete tercerizado, ajuste de saldo)
// se excluyen del análisis de gasto. Regla de negocio de J (2026-07-01).
describe('esCompraReal: exclusión de familias que no son compra real', () => {
  it('excluye las familias marcadas (exactas)', () => {
    for (const f of ['SERVICIOS', 'TRANSPORTE TERCERIZADO', 'AJUSTE DE SALDO', 'GASTOS SOCIOS', 'IMPUESTOS', 'GASTOS BANCARIOS']) {
      expect(esCompraReal(f)).toBe(false);
    }
  });

  it('normaliza mayúsculas y espacios sobrantes', () => {
    expect(esCompraReal(' servicios ')).toBe(false);
    expect(esCompraReal('Ajuste De Saldo')).toBe(false);
  });

  it('deja pasar las familias de insumos reales', () => {
    for (const f of ['PACKAGING', 'MATERIAS PRIMAS', 'DESCARTABLES', 'LIMPIEZA', 'TRANSPORTE PROPIO']) {
      expect(esCompraReal(f)).toBe(true);
    }
  });

  it('familia vacía/null cuenta como compra real (no se excluye por las dudas)', () => {
    expect(esCompraReal(null)).toBe(true);
    expect(esCompraReal(undefined)).toBe(true);
    expect(esCompraReal('')).toBe(true);
  });

  it('la lista tiene exactamente las familias acordadas', () => {
    expect([...FAMILIAS_NO_COMPRA]).toEqual([
      'SERVICIOS',
      'TRANSPORTE TERCERIZADO',
      'AJUSTE DE SALDO',
      'GASTOS SOCIOS',
      'IMPUESTOS',
      'GASTOS BANCARIOS',
    ]);
  });
});
