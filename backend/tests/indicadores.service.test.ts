import { describe, expect, it } from 'vitest';
import { alinearSerie, type IndicadorMensual } from '../src/services/indicadores.service.js';
import { GuardarIndicadorSchema } from '../src/domain/indicadores.schema.js';

// Ventas e inflación de carga manual. Lo que se testea es que los huecos se propaguen como
// "no sé" en vez de convertirse en ceros, y que la inflación entre como fracción.

const MESES = ['2026-01', '2026-02', '2026-03', '2026-04'];

function ind(periodo: string, ventas: number | null, inflacion: number | null): IndicadorMensual {
  return { periodo, ventas, inflacion, actualizado_en: '2026-08-03T00:00:00.000Z' };
}

describe('alineación contra la ventana del informe', () => {
  it('deja null los meses que no se cargaron, en vez de rellenar con cero', () => {
    const s = alinearSerie([ind('2026-02', 100, 0.02)], MESES);
    expect(s.ventas).toEqual([null, 100, null, null]);
    expect(s.inflacion).toEqual([null, 0.02, null, null]);
  });

  it('compone la inflación acumulada de los últimos meses', () => {
    const s = alinearSerie(
      [ind('2026-03', null, 0.02), ind('2026-04', null, 0.03)],
      MESES,
    );
    // 1,02 × 1,03 − 1 = 5,06%: se compone, no se suma.
    expect(s.acumulada(2)).toBeCloseTo(0.0506, 6);
    expect(s.acumulada(1)).toBeCloseTo(0.03, 6);
  });

  it('devuelve null si falta algún mes del tramo: una acumulada con huecos subestima', () => {
    const s = alinearSerie([ind('2026-04', null, 0.03)], MESES);
    expect(s.acumulada(1)).toBeCloseTo(0.03, 6);
    expect(s.acumulada(3)).toBeNull(); // faltan febrero y marzo
  });

  it('no acepta ventanas más largas que la serie', () => {
    const s = alinearSerie([], MESES);
    expect(s.acumulada(12)).toBeNull();
    expect(s.acumulada(0)).toBeNull();
  });
});

describe('validación de la carga', () => {
  const ok = (data: unknown) => GuardarIndicadorSchema.safeParse(data).success;

  it('acepta la inflación como fracción', () => {
    expect(ok({ periodo: '2026-07', inflacion: 0.021 })).toBe(true);
    expect(ok({ periodo: '2026-07', inflacion: -0.005 })).toBe(true); // deflación
  });

  it('rechaza la inflación tipeada como porcentaje, que es el error probable', () => {
    expect(ok({ periodo: '2026-07', inflacion: 2.1 })).toBe(false);
  });

  it('acepta cargar un solo campo: se cargan en momentos distintos del mes', () => {
    expect(ok({ periodo: '2026-07', ventas: 1000 })).toBe(true);
    expect(ok({ periodo: '2026-07', inflacion: 0.02 })).toBe(true);
  });

  it('acepta null para borrar un dato mal cargado', () => {
    expect(ok({ periodo: '2026-07', ventas: null })).toBe(true);
  });

  it('rechaza un período mal formado o vacío', () => {
    expect(ok({ periodo: '2026-13', ventas: 1 })).toBe(false);
    expect(ok({ periodo: 'julio', ventas: 1 })).toBe(false);
    expect(ok({ periodo: '2026-07' })).toBe(false); // nada para guardar
  });
});
