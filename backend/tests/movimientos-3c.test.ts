import { describe, expect, it } from 'vitest';
import { interpretarMovimientos3c } from '../src/db/import-movimientos-3c.js';

// El espejo de movimientos de 3c: lo que el encargado cargó realmente, para poder comparar
// contra lo que la app del compañero dice que se despachó.
//
// Lo delicado acá es el RENGLÓN. 3c no lo numera, y un mismo documento puede repetir el
// mismo artículo en dos renglones (dos despachos distintos del mismo producto). Si el
// importador no los distingue, el upsert por (numero, producto, renglon) pisa el segundo con
// el primero y se PIERDE cantidad despachada — justo el dato que queremos medir.

const CAB = ['FECHA_RECEPCION', 'NUMERO', 'TIPO_DOC', 'ORIGEN', 'DESTINO', 'ARTICU_ID', 'CANTIDAD', 'UNIMED'];
const fila = (numero: string, art: string, cant: string, destino = '47', fecha = '01/08/2026') => [
  fecha,
  numero,
  'Rint',
  '1',
  destino,
  art,
  cant,
  'UNIDAD',
];

describe('interpretarMovimientos3c', () => {
  it('numera los renglones repetidos del mismo artículo en un documento', () => {
    const { registros } = interpretarMovimientos3c([
      CAB,
      fila('X 0001-00005992', '460', '10'),
      fila('X 0001-00005992', '460', '25'),
      fila('X 0001-00005992', '461', '5'),
    ]);

    expect(registros.map((r) => [r.producto3c, r.renglon, r.cantidad])).toEqual([
      ['460', 1, 10],
      ['460', 2, 25],
      ['461', 1, 5],
    ]);
  });

  it('el renglón se cuenta por documento, no global', () => {
    const { registros } = interpretarMovimientos3c([
      CAB,
      fila('X 0001-00000001', '460', '10'),
      fila('X 0001-00000002', '460', '10'),
    ]);

    expect(registros.map((r) => r.renglon)).toEqual([1, 1]);
  });

  it('convierte la fecha dd/mm/yyyy a ISO', () => {
    const { registros } = interpretarMovimientos3c([CAB, fila('X 1', '460', '1', '47', '05/08/2026')]);

    expect(registros[0]?.fecha).toBe('2026-08-05');
  });

  it('lee los decimales con punto (3c manda "89.55") y con coma', () => {
    const { registros } = interpretarMovimientos3c([
      CAB,
      fila('X 1', '460', '89.55'),
      fila('X 2', '461', '1.234,50'),
    ]);

    expect(registros[0]?.cantidad).toBeCloseTo(89.55);
    expect(registros[1]?.cantidad).toBeCloseTo(1234.5);
  });

  it('guarda origen y destino como números de depósito de 3c', () => {
    const { registros } = interpretarMovimientos3c([CAB, fila('X 1', '460', '1', '49')]);

    expect(registros[0]?.origenDep3c).toBe(1);
    expect(registros[0]?.destinoDep3c).toBe(49);
  });

  it('saltea la fila sin fecha, sin número, sin producto o sin cantidad, y las cuenta', () => {
    const { registros, saltadas } = interpretarMovimientos3c([
      CAB,
      fila('X 1', '460', '1'),
      ['', 'X 2', 'Rint', '1', '47', '460', '1', 'UN'],
      ['01/08/2026', '', 'Rint', '1', '47', '460', '1', 'UN'],
      ['01/08/2026', 'X 3', 'Rint', '1', '47', '', '1', 'UN'],
      ['01/08/2026', 'X 4', 'Rint', '1', '47', '460', '', 'UN'],
    ]);

    expect(registros).toHaveLength(1);
    expect(saltadas).toBe(4);
  });

  it('acepta cantidad 0 y negativa: 3c las usa para correcciones', () => {
    const { registros, saltadas } = interpretarMovimientos3c([
      CAB,
      fila('X 1', '460', '0'),
      fila('X 2', '461', '-3'),
    ]);

    expect(saltadas).toBe(0);
    expect(registros.map((r) => r.cantidad)).toEqual([0, -3]);
  });

  it('exige las columnas que importan y dice cuáles vio', () => {
    expect(() => interpretarMovimientos3c([['FECHA_RECEPCION', 'NUMERO'], ['01/08/2026', 'X 1']])).toThrow(
      /TIPO_DOC|Falta la columna/,
    );
  });
});
