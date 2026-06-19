import { describe, expect, it } from 'vitest';
import { AbastecimientoSchema } from '../src/domain/movimientos.schema.js';

// Validación del contrato del POST (regla #8). No toca la DB.
describe('AbastecimientoSchema', () => {
  const base = {
    destino_dep_id_3c: 47,
    detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }],
  };

  it('acepta un payload mínimo válido', () => {
    expect(AbastecimientoSchema.safeParse(base).success).toBe(true);
  });

  it('rechaza detalle vacío', () => {
    expect(AbastecimientoSchema.safeParse({ ...base, detalle: [] }).success).toBe(false);
  });

  it('rechaza cantidad_real negativa (regla #2: no hay egreso negativo)', () => {
    const r = AbastecimientoSchema.safeParse({
      ...base,
      detalle: [{ producto_3c: '401', cantidad_real: -5, unidad: 'KG' }],
    });
    expect(r.success).toBe(false);
  });

  it('exige producto_3c y unidad en cada renglón', () => {
    const r = AbastecimientoSchema.safeParse({
      ...base,
      detalle: [{ cantidad_real: 10 }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza fecha con formato inválido', () => {
    expect(AbastecimientoSchema.safeParse({ ...base, fecha: '11-06-2026' }).success).toBe(false);
  });

  it('acepta cantidad_sugerida y stock_contado opcionales', () => {
    const r = AbastecimientoSchema.safeParse({
      ...base,
      detalle: [{ producto_3c: '401', cantidad_real: 150, cantidad_sugerida: 145, stock_contado: 35, unidad: 'KG' }],
    });
    expect(r.success).toBe(true);
  });
});
