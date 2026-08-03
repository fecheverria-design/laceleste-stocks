import { describe, expect, it } from 'vitest';
import {
  anclar,
  armarAhorro,
  armarCanasta,
  armarCobertura,
  armarControl,
  armarMatriz,
  armarVariacionVentanas,
  indexarSerie,
  type FilaMatriz,
} from '../src/services/informe-precios.service.js';
import type {
  FilaCotizacion,
  FilaPrecioMesCargado,
  FilaPrecioUsado,
} from '../src/repositories/informe.repository.js';

// Informe de Compras — solapas de precios. Se testean las reglas del Apps Script de J:
// qué cotización cuenta como vigente, cuál es el precio usado, cómo se calcula el ahorro
// contra otro proveedor y cómo se pondera la canasta.

const MESES = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

let proximoId = 1;

function cot(over: Partial<FilaCotizacion> = {}): FilaCotizacion {
  return {
    id: proximoId++,
    producto_3c: '460',
    producto: 'QUESO SARDO',
    familia: 'MATERIAS PRIMAS',
    proveedor_id: 1,
    proveedor: 'FUENTES S.A.',
    precio: '1000',
    fecha: '2026-06-10',
    tipo: 'COMPRA',
    dias: 10,
    ...over,
  };
}

function usado(over: Partial<FilaPrecioUsado> = {}): FilaPrecioUsado {
  return {
    producto_3c: '460',
    proveedor_id: 1,
    proveedor: 'FUENTES S.A.',
    precio: '1000',
    fecha: '2026-06-10',
    dias: 10,
    sin_compra: false,
    ...over,
  };
}

describe('matriz de precios', () => {
  it('cuenta como vigentes solo las cotizaciones de hasta 180 días', () => {
    const matriz = armarMatriz(
      [
        cot({ proveedor_id: 1, proveedor: 'FUENTES', dias: 10 }),
        cot({ proveedor_id: 2, proveedor: 'LA SERENISIMA', dias: 179, precio: '1100' }),
        cot({ proveedor_id: 3, proveedor: 'VIEJO S.A.', dias: 200, precio: '900' }),
      ],
      [usado()],
    );

    expect(matriz[0]!.n_prov).toBe(2); // el de 200 días no cuenta
    expect(matriz[0]!.n_prov_hist).toBe(3); // pero sigue visible al expandir
    expect(matriz[0]!.cotizaciones.find((c) => c.proveedor === 'VIEJO S.A.')!.vigente).toBe(false);
  });

  it('marca cuál es la cotización que se está usando', () => {
    const matriz = armarMatriz(
      [cot({ proveedor_id: 1, proveedor: 'FUENTES' }), cot({ proveedor_id: 2, proveedor: 'OTRO', precio: '900' })],
      [usado({ proveedor_id: 1, proveedor: 'FUENTES' })],
    );

    const usada = matriz[0]!.cotizaciones.filter((c) => c.es_usado);
    expect(usada).toHaveLength(1);
    expect(usada[0]!.proveedor).toBe('FUENTES');
    expect(matriz[0]!.precio).toBe(1000);
  });

  it('ordena las cotizaciones de más barata a más cara', () => {
    const matriz = armarMatriz(
      [
        cot({ proveedor_id: 1, proveedor: 'CARO', precio: '1500' }),
        cot({ proveedor_id: 2, proveedor: 'BARATO', precio: '800' }),
      ],
      [usado()],
    );
    expect(matriz[0]!.cotizaciones.map((c) => c.proveedor)).toEqual(['BARATO', 'CARO']);
  });

  it('un producto sin precio de tipo COMPRA queda marcado para revisar', () => {
    const matriz = armarMatriz([cot()], [usado({ sin_compra: true })]);
    expect(matriz[0]!.sin_compra).toBe(true);
    expect(armarControl(matriz, indexarSerie([], new Map()), MESES).sin_compra).toHaveLength(1);
  });
});

describe('cobertura de cotizaciones', () => {
  it('clasifica por cantidad de proveedores vigentes y lista los que están por debajo de 3', () => {
    const matriz = [
      { producto: 'A', familia: 'MATERIAS PRIMAS', n_prov: 3 },
      { producto: 'B', familia: 'PACKAGING', n_prov: 2 },
      { producto: 'C', familia: 'PACKAGING', n_prov: 1 },
    ] as FilaMatriz[];

    const cob = armarCobertura(matriz);
    expect([cob.c3, cob.c2, cob.c1]).toEqual([1, 1, 1]);
    expect(cob.riesgo.map((r) => r.producto)).toEqual(['C', 'B']); // el más expuesto primero
  });
});

describe('ahorro potencial', () => {
  const gasto = new Map([['460', 1_000_000]]);

  it('cuenta a favor cuando la alternativa de otro proveedor es más cara', () => {
    const matriz = armarMatriz(
      [
        cot({ proveedor_id: 1, proveedor: 'FUENTES', precio: '1000', dias: 10 }),
        cot({ proveedor_id: 2, proveedor: 'OTRO', precio: '1200', dias: 30 }),
      ],
      [usado({ precio: '1000' })],
    );

    const ah = armarAhorro(matriz, gasto);
    expect(ah.contra).toHaveLength(0);
    expect(ah.favor[0]!.gap).toBeCloseTo(0.2, 5);
    expect(ah.favor[0]!.monto).toBeCloseTo(200_000, 5); // 20% sobre el gasto del mes
    expect(ah.neto).toBeCloseTo(200_000, 5);
  });

  it('cuenta en contra cuando había algo más barato disponible', () => {
    const matriz = armarMatriz(
      [
        cot({ proveedor_id: 1, proveedor: 'FUENTES', precio: '1000', dias: 10 }),
        cot({ proveedor_id: 2, proveedor: 'OTRO', precio: '800', dias: 30 }),
      ],
      [usado({ precio: '1000' })],
    );

    const ah = armarAhorro(matriz, gasto);
    expect(ah.favor).toHaveLength(0);
    expect(ah.contra[0]!.mejor_proveedor).toBe('OTRO');
    expect(ah.contra[0]!.monto).toBeCloseTo(200_000, 5);
    expect(ah.neto).toBeCloseTo(-200_000, 5);
  });

  it('ignora las cotizaciones que no son frescas: comparar contra un precio viejo no sirve', () => {
    const matriz = armarMatriz(
      [
        cot({ proveedor_id: 1, proveedor: 'FUENTES', precio: '1000', dias: 10 }),
        cot({ proveedor_id: 2, proveedor: 'RANCIO', precio: '500', dias: 120 }),
      ],
      [usado({ precio: '1000' })],
    );
    expect(armarAhorro(matriz, gasto).contra).toHaveLength(0);
  });

  it('no compara contra el propio proveedor que se está usando', () => {
    const matriz = armarMatriz([cot({ proveedor_id: 1, proveedor: 'FUENTES', precio: '1000' })], [usado()]);
    const ah = armarAhorro(matriz, gasto);
    expect(ah.favor).toHaveLength(0);
    expect(ah.contra).toHaveLength(0);
  });

  it('deja afuera los productos sin gasto en el mes', () => {
    const matriz = armarMatriz(
      [cot({ proveedor_id: 1, precio: '1000' }), cot({ proveedor_id: 2, proveedor: 'OTRO', precio: '800', dias: 20 })],
      [usado()],
    );
    expect(armarAhorro(matriz, new Map()).contra).toHaveLength(0);
  });
});

describe('serie de precios de compra', () => {
  function precio(producto_3c: string, mes: string, monto: number, familia = 'MATERIAS PRIMAS'): FilaPrecioMesCargado {
    return { mes, producto_3c, familia, precio: String(monto) };
  }

  const nombres = new Map([['460', 'QUESO SARDO']]);

  it('calcula la variación a 1, 3 y 6 meses contra el precio de ese mes', () => {
    const serie = indexarSerie(
      [
        precio('460', '2026-01', 100),
        precio('460', '2026-03', 120),
        precio('460', '2026-05', 150),
        precio('460', '2026-06', 200),
      ],
      nombres,
    );

    const [fila] = armarVariacionVentanas(serie, MESES, new Map([['460', 500]]));
    expect(fila!.var_1).toBeCloseTo(200 / 150 - 1, 5);
    expect(fila!.var_3).toBeCloseTo(200 / 120 - 1, 5);
    expect(fila!.var_6).toBeNull(); // 6 meses atrás cae fuera de la ventana
  });

  it('devuelve null cuando el mes de comparación no tiene precio cargado: no inventa un 0%', () => {
    const serie = indexarSerie([precio('460', '2026-06', 200)], nombres);
    const [fila] = armarVariacionVentanas(serie, MESES, new Map([['460', 500]]));
    expect(fila!.var_1).toBeNull();
    expect(fila!.var_3).toBeNull();
  });

  it('solo incluye productos con gasto en el mes', () => {
    const serie = indexarSerie([precio('460', '2026-06', 200)], nombres);
    expect(armarVariacionVentanas(serie, MESES, new Map())).toHaveLength(0);
  });

  // El bug del gráfico de 1 mes: si el producto se compró en junio pero su último precio
  // cargado es de mayo, la ventana se cuenta desde MAYO. Antes se contaba desde junio, así
  // que "1 mes atrás" caía justo en mayo y el precio se comparaba contra sí mismo → 0%.
  it('cuenta la ventana desde el mes del precio, no desde el mes del informe', () => {
    const serie = indexarSerie(
      [precio('460', '2026-04', 100), precio('460', '2026-05', 150)],
      nombres,
    );
    // Mes del informe: junio (sin precio cargado) → usa el de mayo.
    const [fila] = armarVariacionVentanas(serie, MESES, new Map([['460', 500]]));

    expect(fila!.mes_precio).toBe('2026-05');
    expect(fila!.precio).toBe(150);
    expect(fila!.var_1).toBeCloseTo(0.5, 5); // mayo contra abril, no contra sí mismo
  });

  it('nunca compara un precio contra sí mismo', () => {
    const serie = indexarSerie([precio('460', '2026-05', 150)], nombres);
    const [fila] = armarVariacionVentanas(serie, MESES, new Map([['460', 500]]));
    expect(fila!.var_1).toBeNull(); // no hay abril cargado: "sin dato", nunca 0%
    expect(fila!.var_3).toBeNull();
  });

  it('detecta saltos bruscos del precio usado para revisar la carga', () => {
    const serie = indexarSerie([precio('460', '2026-05', 100), precio('460', '2026-06', 500)], nombres);
    const control = armarControl([], serie, MESES);
    expect(control.saltos).toHaveLength(1);
    expect(control.saltos[0]!.var).toBeCloseTo(4, 5);
    expect(control.saltos[0]!.mes).toBe('2026-06');
  });
});

describe('canasta A', () => {
  const nombres = new Map([
    ['460', 'QUESO SARDO'],
    ['525', 'CAJA'],
  ]);

  function precio(producto_3c: string, mes: string, monto: number, familia = 'MATERIAS PRIMAS'): FilaPrecioMesCargado {
    return { mes, producto_3c, familia, precio: String(monto) };
  }

  it('pondera por gasto: lo que se compra poco casi no mueve el índice', () => {
    const serie = indexarSerie(
      [
        // El grande sube 10%, el chico sube 100%.
        precio('460', '2026-05', 100),
        precio('460', '2026-06', 110),
        precio('525', '2026-05', 10, 'PACKAGING'),
        precio('525', '2026-06', 20, 'PACKAGING'),
      ],
      nombres,
    );

    const canasta = armarCanasta(
      serie,
      MESES,
      new Map([
        ['460', 990_000],
        ['525', 10_000],
      ]),
    );

    // ≈ 10,9%: la ponderación por gasto evita que el chico arrastre el índice a 55%.
    expect(canasta.contrib.TOTAL!.var_indice).toBeCloseTo(0.109, 3);
    const aportes = canasta.contrib.TOTAL!.items;
    expect(aportes.reduce((a, x) => a + x.aporte, 0)).toBeCloseTo(canasta.contrib.TOTAL!.var_indice, 6);
  });

  it('excluye del índice las variaciones imposibles y las reporta como anomalía', () => {
    const serie = indexarSerie([precio('460', '2026-05', 100), precio('460', '2026-06', 1000)], nombres);
    const canasta = armarCanasta(serie, MESES, new Map([['460', 500_000]]));

    expect(canasta.anomalias).toHaveLength(1);
    expect(canasta.anomalias[0]!.var).toBeCloseTo(9, 5);
    expect(canasta.contrib.TOTAL!.items).toHaveLength(0); // no ensucia el índice
  });

  it('separa el índice por familia', () => {
    const serie = indexarSerie(
      [
        precio('460', '2026-05', 100),
        precio('460', '2026-06', 110),
        precio('525', '2026-05', 100, 'PACKAGING'),
        precio('525', '2026-06', 90, 'PACKAGING'),
      ],
      nombres,
    );
    const canasta = armarCanasta(
      serie,
      MESES,
      new Map([
        ['460', 1000],
        ['525', 1000],
      ]),
    );

    expect(canasta.contrib['MATERIAS PRIMAS']!.var_indice).toBeCloseTo(0.1, 5);
    expect(canasta.contrib.PACKAGING!.var_indice).toBeCloseTo(-0.1, 5);
  });

  it('ancla el índice en el mes base y reconstruye los meses previos', () => {
    // +10% en el índice 1, +10% en el 2, con ancla en el índice 1.
    const serie = anclar([0, 0.1, 0.1], 1);
    expect(serie[1]).toBe(0);
    expect(serie[2]).toBeCloseTo(0.1, 5);
    expect(serie[0]).toBeCloseTo(1 / 1.1 - 1, 5); // hacia atrás se descompone
  });
});
