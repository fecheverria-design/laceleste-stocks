import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  listarMovimientos,
  obtenerMovimientosDeProducto,
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
});
