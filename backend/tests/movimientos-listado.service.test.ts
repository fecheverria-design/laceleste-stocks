import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { ubicaciones } from '../src/db/schema.js';
import {
  anularMovimiento,
  listarMovimientos,
  obtenerMovimientoPorId,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

// Crea un RINT CONFIRMADO con fecha y área destino explícitas.
async function crearMov(fx: Fixtures, fecha: string, destinoDep3c: number, real: number): Promise<number> {
  const mov = await registrarAbastecimiento(
    {
      destino_dep_id_3c: destinoDep3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha,
      detalle: [{ producto_3c: '401', cantidad_real: real, unidad: 'KG' }],
    },
    { usuarioId: fx.usuarioId },
  );
  return mov.id;
}

describe('listarMovimientos + obtenerMovimientoPorId', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  // Escenario común: 3 movimientos (uno a una segunda área), el del medio anulado.
  async function escenario(): Promise<{
    fx: Fixtures;
    area2Id: number;
    area2Dep3c: number;
    id1: number;
    id2: number;
    id3: number;
  }> {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const area2Dep3c = 48;
    const [area2] = await db
      .insert(ubicaciones)
      .values({ nombre: 'Cocina', tipo: 'AREA', depId3c: area2Dep3c })
      .returning({ id: ubicaciones.id });

    const id1 = await crearMov(fx, '2026-06-10', fx.area.depId3c, 10);
    const id2 = await crearMov(fx, '2026-06-12', fx.area.depId3c, 20);
    const id3 = await crearMov(fx, '2026-06-15', area2Dep3c, 30);
    await anularMovimiento(id2, { usuarioId: fx.usuarioId });

    return { fx, area2Id: area2!.id, area2Dep3c, id1, id2, id3 };
  }

  it('lista todos, recientes primero, con total y forma esperada', async () => {
    const { id1, id2, id3 } = await escenario();

    const r = await listarMovimientos({ page: 1, limit: 50 });

    expect(r.total).toBe(3);
    expect(r.items).toHaveLength(3);
    expect(r.items.map((m) => m.id)).toEqual([id3, id2, id1]); // fecha desc

    const primero = r.items[0]!;
    expect(primero.tipo).toBe('RINT');
    expect(primero.nro).toMatch(/^RINT-\d{4}-\d{5}$/);
    expect(primero.estado).toBe('CONFIRMADO');
  });

  it('filtra por estado', async () => {
    const { id1, id2, id3 } = await escenario();

    const conf = await listarMovimientos({ estado: 'CONFIRMADO', page: 1, limit: 50 });
    expect(conf.total).toBe(2);
    expect(conf.items.map((m) => m.id).sort()).toEqual([id1, id3].sort());

    const anul = await listarMovimientos({ estado: 'ANULADO', page: 1, limit: 50 });
    expect(anul.total).toBe(1);
    expect(anul.items[0]!.id).toBe(id2);
  });

  it('filtra por ubicación matcheando origen O destino', async () => {
    const { fx, area2Id, id1, id2, id3 } = await escenario();

    // El depósito es origen de los 3.
    const porDeposito = await listarMovimientos({ ubicacionId: fx.deposito.id, page: 1, limit: 50 });
    expect(porDeposito.total).toBe(3);

    // El área 1 es destino solo de id1 e id2 (id3 fue a la cocina).
    const porArea1 = await listarMovimientos({ ubicacionId: fx.area.id, page: 1, limit: 50 });
    expect(porArea1.items.map((m) => m.id).sort()).toEqual([id1, id2].sort());

    // El área 2 es destino solo de id3.
    const porArea2 = await listarMovimientos({ ubicacionId: area2Id, page: 1, limit: 50 });
    expect(porArea2.items.map((m) => m.id)).toEqual([id3]);
  });

  it('filtra por rango de fechas (desde/hasta inclusive)', async () => {
    const { id1, id2, id3 } = await escenario();

    expect((await listarMovimientos({ desde: '2026-06-12', page: 1, limit: 50 })).items.map((m) => m.id)).toEqual(
      [id3, id2],
    );
    expect((await listarMovimientos({ hasta: '2026-06-12', page: 1, limit: 50 })).items.map((m) => m.id)).toEqual(
      [id2, id1],
    );
    const soloMedio = await listarMovimientos({ desde: '2026-06-12', hasta: '2026-06-12', page: 1, limit: 50 });
    expect(soloMedio.items.map((m) => m.id)).toEqual([id2]);
  });

  it('filtra por tipo (codigo del catálogo)', async () => {
    await escenario();
    expect((await listarMovimientos({ tipo: 'RINT', page: 1, limit: 50 })).total).toBe(3);
    expect((await listarMovimientos({ tipo: 'RECEPCION', page: 1, limit: 50 })).total).toBe(0);
  });

  it('pagina: total es el del filtro completo, items respeta limit/offset', async () => {
    const { id1, id2, id3 } = await escenario();

    const p1 = await listarMovimientos({ page: 1, limit: 2 });
    expect(p1.total).toBe(3);
    expect(p1.items.map((m) => m.id)).toEqual([id3, id2]);

    const p2 = await listarMovimientos({ page: 2, limit: 2 });
    expect(p2.total).toBe(3);
    expect(p2.items.map((m) => m.id)).toEqual([id1]);
  });

  it('obtenerMovimientoPorId devuelve el detalle; inexistente lanza MOVIMIENTO_NO_ENCONTRADO', async () => {
    const { id1 } = await escenario();

    const mov = await obtenerMovimientoPorId(id1);
    expect(mov.id).toBe(id1);
    expect(mov.detalle).toHaveLength(1);
    expect(mov.detalle[0]!.producto_3c).toBe('401');
    expect(mov.detalle[0]!.cantidad_real).toBe('10.000');

    await expect(obtenerMovimientoPorId(99999)).rejects.toMatchObject({
      code: 'MOVIMIENTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });
});
