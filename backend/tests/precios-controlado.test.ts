import { describe, expect, it } from 'vitest';
import { unoPorProducto, type FilaPrecio } from '../src/db/import-precios.js';

// `import:precios --controlado` marca lo que compras controló en el mes como EL precio del
// producto. Solo puede haber UN controlado por producto (índice parcial en la DB), así que
// cuando el archivo trae varias filas del mismo producto hay que elegir una sola. Elegir mal
// acá significa dejar fijo un precio viejo, que es peor que no marcar nada: le gana a toda
// compra posterior.

function fila(over: Partial<FilaPrecio> = {}): FilaPrecio {
  return {
    producto3c: '460',
    nombre: 'QUESO SARDO',
    proveedorNum: 100,
    proveedorNombre: 'FUENTES',
    precio: 1000,
    tipo: 'COMPRA',
    vigenteDesde: '2026-09-01',
    ...over,
  };
}

describe('unoPorProducto (qué precio se marca como controlado)', () => {
  it('deja una sola fila por producto', () => {
    const elegidos = unoPorProducto([
      fila({ producto3c: '460' }),
      fila({ producto3c: '461' }),
      fila({ producto3c: '460', precio: 1200 }),
    ]);

    expect([...elegidos.keys()].sort()).toEqual(['460', '461']);
  });

  it('gana la fecha más nueva, sin importar el orden del archivo', () => {
    const elegidos = unoPorProducto([
      fila({ vigenteDesde: '2026-09-05', precio: 1500 }),
      fila({ vigenteDesde: '2026-08-01', precio: 900 }),
      fila({ vigenteDesde: '2026-07-15', precio: 800 }),
    ]);

    expect(elegidos.get('460')?.precio).toBe(1500);
    expect(elegidos.get('460')?.vigenteDesde).toBe('2026-09-05');
  });

  it('a igualdad de fecha gana la última fila del archivo (la corrección de más abajo)', () => {
    const elegidos = unoPorProducto([
      fila({ vigenteDesde: '2026-09-05', precio: 1000 }),
      fila({ vigenteDesde: '2026-09-05', precio: 1111 }),
    ]);

    expect(elegidos.get('460')?.precio).toBe(1111);
  });

  it('distingue proveedores dentro del mismo producto: igual queda uno solo', () => {
    const elegidos = unoPorProducto([
      fila({ proveedorNum: 100, vigenteDesde: '2026-09-01', precio: 1000 }),
      fila({ proveedorNum: 200, vigenteDesde: '2026-09-03', precio: 1300 }),
    ]);

    expect(elegidos.size).toBe(1);
    expect(elegidos.get('460')?.proveedorNum).toBe(200);
  });

  it('sin filas devuelve vacío (no rompe)', () => {
    expect(unoPorProducto([]).size).toBe(0);
  });
});
