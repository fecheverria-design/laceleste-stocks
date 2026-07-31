import { describe, expect, it } from 'vitest';
import { interpretarCompras, type FilaCompra } from '../src/db/compras-lectura.js';
import { parseDelimited } from '../src/db/csv.js';

// Lectura del export de compras de 3c. Lo que se testea acá es el NUMERADO DE RENGLONES:
// un mismo remito puede traer el mismo producto en varias líneas y 3c no exporta un id de
// línea, así que sin numerarlas la segunda pisaba a la primera y la compra se perdía
// (65 renglones / $60.705.167 en el export del 31/07/2026). Ver migración 0016.

const ENCABEZADO =
  'NUMERO;FECHA;ARTICU_ID;CANTIDAD;PRECIO_UNITARIO;PRECIO_TOTAL;PERSONAS_ID;PROVEEDORES;DENOMINACION;FAMILIA;IVA;VALOR TOTAL';

function csv(...lineas: string[]): string[][] {
  return parseDelimited([ENCABEZADO, ...lineas].join('\n'));
}

// Caso real: el remito A 0002-00001718 trae STICKER REDONDO tres veces.
const STICKER_1 = 'A 0002-00001718;15/06/2026;504;21280;33,28;708092;2;ASTUPRINT SRL;STICKER REDONDO;PACKAGING;0,21;856791';
const STICKER_2 = 'A 0002-00001718;15/06/2026;504;12160;33,28;404624;2;ASTUPRINT SRL;STICKER REDONDO;PACKAGING;0,21;489595';
const STICKER_3 = 'A 0002-00001718;15/06/2026;504;8400;33,28;279510;2;ASTUPRINT SRL;STICKER REDONDO;PACKAGING;0,21;338207';

describe('interpretarCompras: renglones repetidos del mismo producto', () => {
  it('conserva las tres líneas del mismo producto en el mismo remito, numeradas 1, 2 y 3', () => {
    const { registros } = interpretarCompras(csv(STICKER_1, STICKER_2, STICKER_3));

    expect(registros).toHaveLength(3);
    expect(registros.map((r) => r.renglon)).toEqual([1, 2, 3]);
    // Lo que importa: no se pierde plata. 708092 + 404624 + 279510.
    expect(registros.reduce((a, r) => a + r.precioTotal, 0)).toBe(1392226);
  });

  it('el renglón se cuenta por (remito, producto): otro producto del mismo remito arranca en 1', () => {
    const otro = 'A 0002-00001718;15/06/2026;525;100;10;1000;2;ASTUPRINT SRL;POLI PROPILENO;PACKAGING;0,21;1210';
    const { registros } = interpretarCompras(csv(STICKER_1, otro, STICKER_2));

    const porProducto = (cod: string) => registros.filter((r) => r.producto3c === cod).map((r) => r.renglon);
    expect(porProducto('504')).toEqual([1, 2]);
    expect(porProducto('525')).toEqual([1]);
  });

  it('el mismo producto en OTRO remito también arranca en 1', () => {
    const otroRemito = 'A 0009-00070564;16/06/2026;504;500;33,28;16640;2;ASTUPRINT SRL;STICKER REDONDO;PACKAGING;0,21;20134';
    const { registros } = interpretarCompras(csv(STICKER_1, otroRemito));

    expect(registros.map((r) => `${r.numero}#${r.renglon}`)).toEqual([
      'A 0002-00001718#1',
      'A 0009-00070564#1',
    ]);
  });

  it('es determinístico: el mismo archivo leído dos veces da los mismos renglones (idempotencia)', () => {
    const clave = (filas: string[][]) =>
      interpretarCompras(filas)
        .registros.map((r: FilaCompra) => `${r.numero}|${r.producto3c}|${r.renglon}|${r.precioTotal}`)
        .join(',');

    expect(clave(csv(STICKER_1, STICKER_2, STICKER_3))).toBe(clave(csv(STICKER_1, STICKER_2, STICKER_3)));
  });

  it('cuenta las saltadas y las excluidas por familia sin frenar el resto', () => {
    const sinProveedor = 'A 0003-00000001;15/06/2026;504;10;5;50;;;STICKER;PACKAGING;0,21;60';
    const servicio = 'A 0004-00000002;15/06/2026;900;1;1000;1000;7;GASISTA;SERVICIO DE GAS;SERVICIOS;0,21;1210';
    const { registros, saltadas, excluidasFamilia } = interpretarCompras(csv(STICKER_1, sinProveedor, servicio));

    expect(registros).toHaveLength(1);
    expect(saltadas).toBe(1);
    expect(excluidasFamilia).toBe(1);
  });
});
