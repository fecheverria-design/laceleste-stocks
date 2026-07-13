import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anularMovimiento,
  listarMovimientos,
  obtenerMovimientosDeProducto,
  obtenerMovimientosExport,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

async function crearMov(fx: Fixtures, fecha: string, producto3c: string, real: number): Promise<number> {
  const mov = await registrarAbastecimiento(
    {
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha,
      detalle: [{ producto_3c: producto3c, cantidad_real: real, unidad: 'KG' }],
    },
    { usuarioId: fx.usuarioId },
  );
  return mov.id;
}

describe('obtenerMovimientosDeProducto + dep_id en listado', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('trae solo los movimientos del producto pedido, recientes primero, con dep ids y cantidad', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    const id1 = await crearMov(fx, '2026-06-10', '401', 10);
    const id2 = await crearMov(fx, '2026-06-12', '401', 25);
    await crearMov(fx, '2026-06-13', '402', 99); // otro producto: no debe aparecer

    const movs = await obtenerMovimientosDeProducto('401');

    expect(movs.map((m) => m.id)).toEqual([id2, id1]); // fecha desc
    const primero = movs[0]!;
    expect(primero.origen_dep_id_3c).toBe(fx.deposito.depId3c);
    expect(primero.destino_dep_id_3c).toBe(fx.area.depId3c);
    expect(primero.cantidad_real).toBe('25.000');
    expect(primero.unidad).toBe('KG');
  });

  it('filtra por ubicación (entra o sale de esa ubicación)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearMov(fx, '2026-06-10', '401', 10);

    // El depósito es origen → aparece; un id de ubicación inexistente → vacío.
    expect(await obtenerMovimientosDeProducto('401', fx.deposito.id)).toHaveLength(1);
    expect(await obtenerMovimientosDeProducto('401', fx.area.id)).toHaveLength(1);
    expect(await obtenerMovimientosDeProducto('401', 99999)).toHaveLength(0);
  });

  it('el listado expone origen_dep_id_3c y destino_dep_id_3c', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearMov(fx, '2026-06-10', '401', 10);

    const r = await listarMovimientos({ page: 1, limit: 50 });
    const m = r.items[0]!;
    expect(m.origen_dep_id_3c).toBe(fx.deposito.depId3c);
    expect(m.destino_dep_id_3c).toBe(fx.area.depId3c);
  });

  it('kardex: calcula el saldo acumulado anclado al stock; un ANULADO no lo mueve', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    // Salidas del depósito (origen lleva stock): 10 y 25 → stock -35.
    await crearMov(fx, '2026-06-10', '401', 10);
    await crearMov(fx, '2026-06-12', '401', 25);
    // Filtrado por el depósito → saldo presente (sin filtro de ubicación, saldo null).
    const sinUbic = await obtenerMovimientosDeProducto('401');
    expect(sinUbic.every((m) => m.saldo === null)).toBe(true);

    const k = await obtenerMovimientosDeProducto('401', fx.deposito.id);
    // Recientes primero: el más nuevo (25) deja el saldo de hoy (-35); el viejo (10) -10.
    expect(k.map((m) => m.saldo)).toEqual([-35, -10]);

    // Un tercer movimiento anulado no debe alterar el saldo del resto.
    const id3 = await crearMov(fx, '2026-06-15', '401', 5);
    await anularMovimiento(id3, { usuarioId: fx.usuarioId });
    const k2 = await obtenerMovimientosDeProducto('401', fx.deposito.id);
    const anulada = k2.find((m) => m.id === id3)!;
    expect(anulada.estado).toBe('ANULADO');
    // Stock sigue -35; el anulado arrastra el saldo (no lo cambia).
    expect(anulada.saldo).toBe(-35);
    expect(k2.find((m) => m.cantidad_real === '25.000')!.saldo).toBe(-35);
    expect(k2.find((m) => m.cantidad_real === '10.000')!.saldo).toBe(-10);
  });

  it('export: una fila por renglón con cabecera + producto, respetando filtros', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    await crearMov(fx, '2026-06-10', '401', 10);
    await crearMov(fx, '2026-06-12', '402', 20);

    const todos = await obtenerMovimientosExport({});
    expect(todos).toHaveLength(2);
    const fila = todos[0]!; // recientes primero → el de 402
    expect(fila.producto_3c).toBe('402');
    expect(fila.producto_nombre).toBe('Producto 402');
    expect(fila.cantidad_real).toBe('20.000');
    expect(fila.origen_dep_id_3c).toBe(fx.deposito.depId3c);

    // El filtro de fecha aplica también al export.
    const soloViejo = await obtenerMovimientosExport({ hasta: '2026-06-10' });
    expect(soloViejo.map((r) => r.producto_3c)).toEqual(['401']);
  });
});
