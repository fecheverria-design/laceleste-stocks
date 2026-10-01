import { describe, expect, it } from 'vitest';
import { interpretarPlanillaPrecios, unoPorProducto, type FilaPrecio } from '../src/db/import-precios.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// La planilla de compras (`precios.xlsx`): en vez de una columna TIPO trae el tilde `Usar`
// —"este es el precio que usamos"— y es una FOTO POR MES, así que el mismo precio aparece
// repetido una vez por mes. Interpretarla mal tiene consecuencias caras: si el tilde no gana,
// queda controlado un precio que compras nunca verificó, y le gana a toda compra posterior.
// ─────────────────────────────────────────────────────────────────────────────

const CAB_USAR = ['CODIGO', 'DENOMINACION', 'PRECIO_LISTA', 'Cod. Proveedor', 'PROVEEDOR', 'ULTIMA_ACT_PRECIO', 'Usar', 'MES'];
/** Una fila de la planilla: código, precio, proveedor, fecha del precio, tilde y mes de la foto. */
const filaUsar = (cod: string, precio: string, prov: string, fecha: string, usar: string, mes: string): string[] => [
  cod,
  `Producto ${cod}`,
  precio,
  prov,
  `Proveedor ${prov}`,
  fecha,
  usar,
  mes,
];

describe('interpretarPlanillaPrecios (planilla de compras, tilde USAR)', () => {
  it('el tilde define el tipo: marcada = COMPRA, sin marcar = ACTUALIZACION', () => {
    const { registros, desdeUsar } = interpretarPlanillaPrecios([
      CAB_USAR,
      filaUsar('460', '1000', '100', '05/01/2026', 'true', '1'),
      filaUsar('461', '2000', '100', '05/01/2026', 'false', '1'),
    ]);

    expect(desdeUsar).toBe(true);
    expect(registros.map((r) => [r.producto3c, r.tipo])).toEqual([
      ['460', 'COMPRA'],
      ['461', 'ACTUALIZACION'],
    ]);
  });

  it('colapsa la foto de cada mes en un solo precio y alcanza UN mes tildado para que sea COMPRA', () => {
    const { registros } = interpretarPlanillaPrecios([
      CAB_USAR,
      filaUsar('460', '1000', '100', '05/01/2026', 'true', '1'),
      filaUsar('460', '1000', '100', '05/01/2026', 'false', '2'),
      filaUsar('460', '1000', '100', '05/01/2026', 'false', '3'),
    ]);

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ tipo: 'COMPRA', precio: 1000, vigenteDesde: '2026-01-05' });
  });

  it('si el precio de esa fecha cambió entre meses, gana el del mes más nuevo (la última fila)', () => {
    const { registros } = interpretarPlanillaPrecios([
      CAB_USAR,
      filaUsar('460', '281.87', '100', '04/09/2025', 'true', '1'),
      filaUsar('460', '4120', '100', '04/09/2025', 'false', '8'),
    ]);

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ precio: 4120, tipo: 'COMPRA' });
  });

  it('con columna TIPO no colapsa: compra y actualización del mismo día son dos hechos', () => {
    const { registros, desdeUsar } = interpretarPlanillaPrecios([
      ['ID', 'DENOMINACION', 'PRECIO_UNITARIO', 'PERSONAS_ID', 'PROVEEDORES', 'FECHA', 'TIPO'],
      ['460', 'QUESO', '1000', '100', 'FUENTES', '05/01/2026', 'COMPRA'],
      ['460', 'QUESO', '1100', '100', 'FUENTES', '05/01/2026', 'ACTUALIZACION'],
    ]);

    expect(desdeUsar).toBe(false);
    expect(registros).toHaveLength(2);
  });

  it('saltea precio 0 y filas sin número de proveedor', () => {
    const { registros, saltados } = interpretarPlanillaPrecios([
      CAB_USAR,
      filaUsar('460', '0', '100', '05/01/2026', 'false', '1'),
      filaUsar('461', '1000', '', '05/01/2026', 'true', '1'),
      filaUsar('462', '1000', '100', '05/01/2026', 'true', '1'),
    ]);

    expect(saltados).toBe(2);
    expect(registros.map((r) => r.producto3c)).toEqual(['462']);
  });

  it('sin TIPO ni USAR avisa qué falta, con los encabezados que sí vinieron', () => {
    expect(() =>
      interpretarPlanillaPrecios([
        ['ID', 'DENOMINACION', 'PRECIO', 'PERSONAS_ID', 'PROVEEDORES', 'FECHA'],
        ['460', 'QUESO', '1000', '100', 'FUENTES', '05/01/2026'],
      ]),
    ).toThrow(/TIPO.*USAR/s);
  });
});

describe('unoPorProducto con tipos mezclados', () => {
  it('el tildado le gana a una cotización sin tildar más nueva', () => {
    const elegidos = unoPorProducto([
      fila({ tipo: 'COMPRA', vigenteDesde: '2026-01-05', precio: 1000 }),
      fila({ tipo: 'ACTUALIZACION', vigenteDesde: '2026-08-30', precio: 9999 }),
    ]);

    expect(elegidos.get('460')).toMatchObject({ tipo: 'COMPRA', precio: 1000 });
  });

  it('entre dos tildados gana el más nuevo', () => {
    const elegidos = unoPorProducto([
      fila({ tipo: 'COMPRA', vigenteDesde: '2026-01-05', precio: 1000 }),
      fila({ tipo: 'COMPRA', vigenteDesde: '2026-08-30', precio: 1800 }),
    ]);

    expect(elegidos.get('460')?.precio).toBe(1800);
  });
});
