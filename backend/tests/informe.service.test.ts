import { describe, expect, it } from 'vitest';
import { armarEvolucion, armarInforme, mesAnteriorDe, variacion, ventanaMeses } from '../src/services/informe.service.js';
import type { FilaGastoMensual, FilaGastoMes, FilaPrecioMes } from '../src/repositories/informe.repository.js';

// Informe de Compras, solapa "Por Comprador". Se testea la lógica pura: atribución por
// familia, gasto con IVA, variación de precio sobre el neto y la ponderación por gasto.

const MES = '2026-06';
const PREVIO = '2026-05';

// Precio VIGENTE al cierre del mes (lo que manda la variación).
function precio(producto_3c: string, mes: string, monto: number): FilaPrecioMes {
  return { mes, producto_3c, precio: String(monto) };
}

function fila(over: Partial<FilaGastoMes> = {}): FilaGastoMes {
  return {
    mes: MES,
    proveedor_id: 1,
    proveedor: 'FUENTES S.A.',
    producto_3c: '460',
    producto: 'QUESO SARDO',
    familia: 'MATERIAS PRIMAS',
    clasificacion_abc: 'A',
    gasto: '1210', // con IVA
    gasto_neto: '1000',
    cantidad: '10',
    renglones: 1,
    ...over,
  };
}

describe('atribución por comprador', () => {
  it('imputa por familia: Materias Primas a Lautaro, Packaging a Fausto', () => {
    const inf = armarInforme(
      [
        fila({ familia: 'MATERIAS PRIMAS', gasto: '1000', gasto_neto: '826' }),
        fila({ producto_3c: '525', familia: 'PACKAGING', gasto: '400', gasto_neto: '330' }),
      ],
      [],
      MES,
      PREVIO,
    );

    expect(inf.por_comprador.map((c) => c.comprador)).toEqual(['Lautaro', 'Fausto']);
    expect(inf.por_comprador.find((c) => c.comprador === 'Lautaro')!.gasto).toBe(1000);
    expect(inf.por_comprador.find((c) => c.comprador === 'Fausto')!.gasto).toBe(400);
  });

  it('lo que no tiene comprador queda afuera del informe (servicios, esporádicos)', () => {
    const inf = armarInforme(
      [fila(), fila({ producto_3c: '900', familia: 'SERVICIOS', gasto: '99999', gasto_neto: '82644' })],
      [],
      MES,
      PREVIO,
    );

    expect(inf.productos.map((p) => p.producto_3c)).toEqual(['460']);
    expect(inf.resumen.gasto).toBe(1210);
  });

  it('filtrando por comprador solo entra ese', () => {
    const inf = armarInforme(
      [fila({ familia: 'MATERIAS PRIMAS' }), fila({ producto_3c: '525', familia: 'PACKAGING' })],
      [],
      MES,
      PREVIO,
      'Fausto',
    );

    expect(inf.productos.map((p) => p.producto_3c)).toEqual(['525']);
    expect(inf.por_comprador.map((c) => c.comprador)).toEqual(['Fausto']);
  });
});

describe('gasto y variación', () => {
  it('el gasto se mide CON IVA (columna VALOR TOTAL del informe de J)', () => {
    const inf = armarInforme([fila({ gasto: '1210', gasto_neto: '1000' })], [], MES, PREVIO);
    expect(inf.resumen.gasto).toBe(1210);
  });

  it('la variación sale del precio VIGENTE (la tabla precios), no de lo que se pagó', () => {
    // Lo pagado no cambió (mismo gasto y cantidad los dos meses), pero el precio de lista sí:
    // de $100 a $130. Es el caso de corregir un precio a mano en la hoja de Precios.
    const inf = armarInforme(
      [
        fila({ mes: PREVIO, gasto_neto: '1000', cantidad: '10' }),
        fila({ mes: MES, gasto_neto: '1000', cantidad: '10' }),
      ],
      [precio('460', PREVIO, 100), precio('460', MES, 130)],
      MES,
      PREVIO,
    );

    expect(inf.productos[0]!.precio).toBe(130);
    expect(inf.productos[0]!.var_precio).toBeCloseTo(0.3, 10);
    // Lo pagado queda al lado como referencia, sin mandar en la variación.
    expect(inf.productos[0]!.precio_pagado).toBe(100);
  });

  it('el IVA no ensucia la variación: el precio vigente es neto', () => {
    const inf = armarInforme(
      [
        // El IVA cambió de 10,5% a 21%, pero el precio de lista es el mismo.
        fila({ mes: PREVIO, gasto: '1105', gasto_neto: '1000', cantidad: '10' }),
        fila({ mes: MES, gasto: '1210', gasto_neto: '1000', cantidad: '10' }),
      ],
      [precio('460', PREVIO, 100), precio('460', MES, 100)],
      MES,
      PREVIO,
    );

    expect(inf.productos[0]!.var_precio).toBe(0);
    expect(inf.productos[0]!.gasto).toBe(1210); // el gasto sí refleja lo pagado
  });

  it('sin precio en alguno de los dos meses la variación es null, no 0', () => {
    const inf = armarInforme([fila()], [precio('460', MES, 130)], MES, PREVIO);
    expect(inf.productos[0]!.precio).toBe(130);
    expect(inf.productos[0]!.precio_anterior).toBeNull();
    expect(inf.productos[0]!.var_precio).toBeNull();
  });

  it('sin mes anterior el gasto anterior es 0 y su variación null', () => {
    const inf = armarInforme([fila()], [], MES, PREVIO);
    expect(inf.productos[0]!.gasto_anterior).toBe(0);
    expect(inf.resumen.var_gasto).toBeNull();
  });

  it('variacion() no divide por cero', () => {
    expect(variacion(100, 0)).toBeNull();
    expect(variacion(150, 100)).toBeCloseTo(0.5, 10);
  });
});

describe('variación ponderada por proveedor', () => {
  it('pesa cada producto por su gasto: el insumo grande manda sobre el chico', () => {
    const inf = armarInforme(
      [
        // Producto grande: $900.000 de gasto este mes, precio +10%.
        fila({ producto_3c: 'A', mes: PREVIO, gasto: '1' }),
        fila({ producto_3c: 'A', mes: MES, gasto: '900000' }),
        // Producto chico: $1.000 de gasto, precio +100%.
        fila({ producto_3c: 'B', mes: PREVIO, gasto: '1' }),
        fila({ producto_3c: 'B', mes: MES, gasto: '1000' }),
      ],
      [
        precio('A', PREVIO, 100),
        precio('A', MES, 110),
        precio('B', PREVIO, 100),
        precio('B', MES, 200),
      ],
      MES,
      PREVIO,
    );

    // (0,10 × 900000 + 1,00 × 1000) / 901000 ≈ 0,101
    expect(inf.proveedores[0]!.var_precio).toBeCloseTo(0.101, 3);
  });

  it('un proveedor sin nada con qué comparar queda con variación null', () => {
    const inf = armarInforme([fila()], [], MES, PREVIO);
    expect(inf.proveedores[0]!.var_precio).toBeNull();
  });

  it('agrupa por proveedor y ordena por gasto descendente', () => {
    const inf = armarInforme(
      [
        fila({ proveedor_id: 1, proveedor: 'CHICO', gasto: '100' }),
        fila({ proveedor_id: 2, proveedor: 'GRANDE', producto_3c: '461', gasto: '5000' }),
      ],
      [],
      MES,
      PREVIO,
    );

    expect(inf.proveedores.map((p) => p.nombre)).toEqual(['GRANDE', 'CHICO']);
  });
});

describe('evolución del gasto (gráfico de 12 meses)', () => {
  const mensual = (over: Partial<FilaGastoMensual> = {}): FilaGastoMensual => ({
    mes: MES,
    proveedor_id: 1,
    proveedor: 'FUENTES S.A.',
    familia: 'MATERIAS PRIMAS',
    gasto: '1000',
    ...over,
  });

  it('ventanaMeses devuelve los N meses que terminan en el pedido, del más viejo al más nuevo', () => {
    expect(ventanaMeses('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  });

  it('arma la serie total mes a mes, con 0 en los meses sin compras', () => {
    const meses = ['2026-04', '2026-05', '2026-06'];
    const evo = armarEvolucion([mensual({ mes: '2026-04', gasto: '100' }), mensual({ mes: '2026-06', gasto: '300' })], meses);

    expect(evo.meses).toEqual(meses);
    expect(evo.total).toEqual([100, 0, 300]);
  });

  it('un mes sin compras a un proveedor es null, no 0: la línea se corta en vez de caer al piso', () => {
    const meses = ['2026-04', '2026-05', '2026-06'];
    const evo = armarEvolucion([mensual({ mes: '2026-04', gasto: '100' }), mensual({ mes: '2026-06', gasto: '300' })], meses);

    expect(evo.proveedores[0]!.serie).toEqual([100, null, 300]);
  });

  it('deja los N proveedores más grandes de la ventana, ordenados por total', () => {
    const meses = ['2026-05', '2026-06'];
    const evo = armarEvolucion(
      [
        mensual({ proveedor_id: 1, proveedor: 'CHICO', gasto: '10' }),
        mensual({ proveedor_id: 2, proveedor: 'GRANDE', gasto: '900' }),
        mensual({ proveedor_id: 3, proveedor: 'MEDIO', gasto: '400' }),
      ],
      meses,
      undefined,
      2,
    );

    expect(evo.proveedores.map((p) => p.nombre)).toEqual(['GRANDE', 'MEDIO']);
  });

  it('respeta el filtro de comprador y deja afuera lo que no tiene comprador', () => {
    const meses = ['2026-06'];
    const evo = armarEvolucion(
      [
        mensual({ familia: 'MATERIAS PRIMAS', gasto: '100' }),
        mensual({ familia: 'PACKAGING', gasto: '200', proveedor: 'PACK S.A.', proveedor_id: 9 }),
        mensual({ familia: 'SERVICIOS', gasto: '99999', proveedor: 'GASISTA', proveedor_id: 7 }),
      ],
      meses,
      'Fausto',
    );

    expect(evo.total).toEqual([200]);
    expect(evo.proveedores.map((p) => p.nombre)).toEqual(['PACK S.A.']);
  });
});

describe('mesAnteriorDe', () => {
  it('resuelve el mes anterior, incluso cruzando el año', () => {
    expect(mesAnteriorDe('2026-06')).toBe('2026-05');
    expect(mesAnteriorDe('2026-01')).toBe('2025-12');
  });

  it('rechaza un mes con formato inválido', () => {
    expect(() => mesAnteriorDe('junio')).toThrow();
  });
});
