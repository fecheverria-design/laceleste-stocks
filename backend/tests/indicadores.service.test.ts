import { describe, expect, it } from 'vitest';
import {
  alinearSerie,
  derivarInflacion,
  type IndicadorMensual,
  type InflacionModo,
} from '../src/services/indicadores.service.js';
import { GuardarIndicadorSchema } from '../src/domain/indicadores.schema.js';

// Ventas e inflación de carga manual. Lo que se testea es que los huecos se propaguen como
// "no sé" en vez de convertirse en ceros, que la inflación entre como fracción, y que
// cargarla acumulada o mensual dé exactamente la misma serie.

const MESES = ['2026-01', '2026-02', '2026-03', '2026-04'];

function ind(
  periodo: string,
  ventas: number | null,
  inflacionMensual: number | null,
): IndicadorMensual {
  return {
    periodo,
    ventas,
    inflacion: inflacionMensual,
    inflacion_modo: 'MENSUAL',
    inflacion_mensual: inflacionMensual,
    inflacion_acumulada: null,
    actualizado_en: '2026-08-03T00:00:00.000Z',
  };
}

const fila = (periodo: string, inflacion: number | null, inflacion_modo: InflacionModo = 'MENSUAL') => ({
  periodo,
  inflacion,
  inflacion_modo,
});

describe('derivación entre inflación mensual y acumulada', () => {
  it('en enero las dos coinciden: el acumulado del año arranca ahí', () => {
    const d = derivarInflacion([fila('2026-01', 0.029, 'ACUMULADA')]);
    expect(d.get('2026-01')!.mensual).toBeCloseTo(0.029, 9);
    expect(d.get('2026-01')!.acumulada).toBeCloseTo(0.029, 9);
  });

  it('descompone la acumulada del año en variaciones mensuales', () => {
    // La serie que J cargó el 05/08/2026, que es acumulada del año.
    const d = derivarInflacion([
      fila('2026-01', 0.029, 'ACUMULADA'),
      fila('2026-02', 0.059, 'ACUMULADA'),
      fila('2026-03', 0.095, 'ACUMULADA'),
    ]);
    expect(d.get('2026-01')!.mensual).toBeCloseTo(0.029, 6);
    expect(d.get('2026-02')!.mensual).toBeCloseTo(1.059 / 1.029 - 1, 9); // 2,92%
    expect(d.get('2026-03')!.mensual).toBeCloseTo(1.095 / 1.059 - 1, 9); // 3,40%
  });

  it('compone la acumulada cuando se carga mensual', () => {
    const d = derivarInflacion([fila('2026-01', 0.029), fila('2026-02', 0.0291545), fila('2026-03', 0.0339944)]);
    expect(d.get('2026-02')!.acumulada).toBeCloseTo(0.059, 5);
    expect(d.get('2026-03')!.acumulada).toBeCloseTo(0.095, 5);
  });

  it('cargar mensual o acumulada da la misma serie: es ida y vuelta exacta', () => {
    const acum = derivarInflacion([
      fila('2026-01', 0.029, 'ACUMULADA'),
      fila('2026-02', 0.059, 'ACUMULADA'),
      fila('2026-03', 0.095, 'ACUMULADA'),
    ]);
    const mens = derivarInflacion([
      fila('2026-01', acum.get('2026-01')!.mensual!),
      fila('2026-02', acum.get('2026-02')!.mensual!),
      fila('2026-03', acum.get('2026-03')!.mensual!),
    ]);
    for (const m of ['2026-01', '2026-02', '2026-03']) {
      expect(mens.get(m)!.acumulada).toBeCloseTo(acum.get(m)!.acumulada!, 9);
      expect(mens.get(m)!.mensual).toBeCloseTo(acum.get(m)!.mensual!, 9);
    }
  });

  it('cada enero reinicia el acumulado del año', () => {
    const d = derivarInflacion([
      fila('2025-12', 0.02),
      fila('2026-01', 0.03),
      fila('2026-02', 0.04),
    ]);
    // Enero no arrastra el 2% de diciembre: el acumulado del año nuevo empieza de cero.
    expect(d.get('2026-01')!.acumulada).toBeCloseTo(0.03, 9);
    expect(d.get('2026-02')!.acumulada).toBeCloseTo(1.03 * 1.04 - 1, 9);
  });

  it('un mes sin cargar corta la cadena en vez de derivar un número más chico', () => {
    const d = derivarInflacion([
      fila('2026-01', 0.03),
      fila('2026-02', null),
      fila('2026-03', 0.04),
    ]);
    expect(d.get('2026-02')!.acumulada).toBeNull();
    expect(d.get('2026-03')!.mensual).toBeCloseTo(0.04, 9); // el dato cargado se respeta
    expect(d.get('2026-03')!.acumulada).toBeNull(); // pero el acumulado ya no se sabe
  });

  it('un salto de meses también corta: febrero → abril no es consecutivo', () => {
    const d = derivarInflacion([fila('2026-02', 0.05, 'ACUMULADA'), fila('2026-04', 0.12, 'ACUMULADA')]);
    expect(d.get('2026-04')!.mensual).toBeNull();
    expect(d.get('2026-04')!.acumulada).toBeCloseTo(0.12, 9); // lo cargado, intacto
  });

  it('una acumulada que arranca a mitad de año no inventa el mensual del primer mes', () => {
    const d = derivarInflacion([fila('2026-06', 0.17, 'ACUMULADA'), fila('2026-07', 0.19, 'ACUMULADA')]);
    expect(d.get('2026-06')!.mensual).toBeNull(); // falta mayo para restarlo
    expect(d.get('2026-07')!.mensual).toBeCloseTo(1.19 / 1.17 - 1, 9);
  });

  it('mezcla los dos modos sin romperse', () => {
    const d = derivarInflacion([
      fila('2026-01', 0.029),
      fila('2026-02', 0.059, 'ACUMULADA'),
      fila('2026-03', 0.034),
    ]);
    expect(d.get('2026-02')!.mensual).toBeCloseTo(1.059 / 1.029 - 1, 9);
    expect(d.get('2026-03')!.acumulada).toBeCloseTo(1.059 * 1.034 - 1, 9);
  });

  it('no le importa el orden en que vengan las filas', () => {
    const d = derivarInflacion([
      fila('2026-03', 0.095, 'ACUMULADA'),
      fila('2026-01', 0.029, 'ACUMULADA'),
      fila('2026-02', 0.059, 'ACUMULADA'),
    ]);
    expect(d.get('2026-03')!.mensual).toBeCloseTo(1.095 / 1.059 - 1, 9);
  });

  it('la deflación no rompe la cuenta', () => {
    const d = derivarInflacion([fila('2026-01', 0.02), fila('2026-02', -0.01)]);
    expect(d.get('2026-02')!.acumulada).toBeCloseTo(1.02 * 0.99 - 1, 9);
  });
});

describe('alineación contra la ventana del informe', () => {
  it('deja null los meses que no se cargaron, en vez de rellenar con cero', () => {
    const s = alinearSerie([ind('2026-02', 100, 0.02)], MESES);
    expect(s.ventas).toEqual([null, 100, null, null]);
    expect(s.inflacion).toEqual([null, 0.02, null, null]);
  });

  it('usa la serie MENSUAL, no lo tipeado: el informe no se entera de cómo se cargó', () => {
    const cargadoAcumulado: IndicadorMensual = {
      periodo: '2026-02',
      ventas: null,
      inflacion: 0.059, // acumulada del año, que es lo que se ve en pantalla
      inflacion_modo: 'ACUMULADA',
      inflacion_mensual: 0.0291545, // lo que vale de verdad como variación del mes
      inflacion_acumulada: 0.059,
      actualizado_en: '2026-08-05T00:00:00.000Z',
    };
    const s = alinearSerie([cargadoAcumulado], MESES);
    expect(s.inflacion[1]).toBeCloseTo(0.0291545, 9);
  });

  it('compone la inflación acumulada de los últimos meses', () => {
    const s = alinearSerie([ind('2026-03', null, 0.02), ind('2026-04', null, 0.03)], MESES);
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
    expect(ok({ periodo: '2026-07', inflacion: 0.021, inflacion_modo: 'MENSUAL' })).toBe(true);
    expect(ok({ periodo: '2026-07', inflacion: -0.005, inflacion_modo: 'MENSUAL' })).toBe(true); // deflación
  });

  it('rechaza la inflación tipeada como porcentaje, que es el error probable', () => {
    expect(ok({ periodo: '2026-07', inflacion: 2.1, inflacion_modo: 'MENSUAL' })).toBe(false);
  });

  it('exige el modo junto al número: sin él, 0,17 puede ser un mes o un año', () => {
    expect(ok({ periodo: '2026-07', inflacion: 0.17 })).toBe(false);
    expect(ok({ periodo: '2026-07', inflacion: 0.17, inflacion_modo: 'ACUMULADA' })).toBe(true);
  });

  it('deja pasar acumuladas grandes que como mensuales serían un disparate', () => {
    // 2,11 = la acumulada real de 2023. Como variación de UN mes no existe.
    expect(ok({ periodo: '2026-12', inflacion: 2.11, inflacion_modo: 'ACUMULADA' })).toBe(true);
    expect(ok({ periodo: '2026-12', inflacion: 2.11, inflacion_modo: 'MENSUAL' })).toBe(false);
    expect(ok({ periodo: '2026-12', inflacion: 11, inflacion_modo: 'ACUMULADA' })).toBe(false);
  });

  it('acepta cargar un solo campo: se cargan en momentos distintos del mes', () => {
    expect(ok({ periodo: '2026-07', ventas: 1000 })).toBe(true);
    expect(ok({ periodo: '2026-07', inflacion: 0.02, inflacion_modo: 'MENSUAL' })).toBe(true);
  });

  it('acepta null para borrar un dato mal cargado, sin pedir modo', () => {
    expect(ok({ periodo: '2026-07', ventas: null })).toBe(true);
    expect(ok({ periodo: '2026-07', inflacion: null })).toBe(true);
  });

  it('rechaza un período mal formado o vacío', () => {
    expect(ok({ periodo: '2026-13', ventas: 1 })).toBe(false);
    expect(ok({ periodo: 'julio', ventas: 1 })).toBe(false);
    expect(ok({ periodo: '2026-07' })).toBe(false); // nada para guardar
  });

  it('rechaza un modo inventado', () => {
    expect(ok({ periodo: '2026-07', inflacion: 0.02, inflacion_modo: 'INTERANUAL' })).toBe(false);
  });
});
