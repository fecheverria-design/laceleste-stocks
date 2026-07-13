import { describe, expect, it } from 'vitest';
import { FAMILIAS_NO_COMPRA, cuentaEnGasto, esCompraReal, esProductoReal } from '../src/domain/familias.js';

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

// Filtro del gráfico de gasto por proveedor: solo insumos reales (2026-07-02).
describe('cuentaEnGasto: qué entra al gráfico de gasto', () => {
  it('excluye el producto PRUEBA (480) aunque su familia cuente', () => {
    expect(cuentaEnGasto('MATERIAS PRIMAS', '480')).toBe(false);
  });

  it('excluye familias no-compra + productos esporádicos', () => {
    const excluidas = [
      'SERVICIOS',
      'TRANSPORTE TERCERIZADO',
      'AJUSTE DE SALDO',
      'GASTOS SOCIOS',
      'IMPUESTOS',
      'GASTOS BANCARIOS',
      'PRODUCTOS ESPORADICOS',
    ];
    for (const f of excluidas) expect(cuentaEnGasto(f, '123')).toBe(false);
  });

  it('cuenta los insumos reales', () => {
    for (const f of ['MATERIAS PRIMAS', 'PACKAGING', 'DESCARTABLES', 'LIMPIEZA', 'MERCHANDISING']) {
      expect(cuentaEnGasto(f, '123')).toBe(true);
    }
  });

  it('un producto sin familia se conserva', () => {
    expect(cuentaEnGasto(null, '123')).toBe(true);
    expect(cuentaEnGasto('', '123')).toBe(true);
  });
});

// Ficticios fuera de la valorización / Panel (2026-07-02).
describe('esProductoReal: excluye ficticios de la valorización', () => {
  it('PRUEBA (480) no es producto real', () => {
    expect(esProductoReal('480')).toBe(false);
  });
  it('cualquier otro código sí es real', () => {
    expect(esProductoReal('428')).toBe(true);
    expect(esProductoReal('1')).toBe(true);
  });
});
