import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { crearMovimiento, obtenerStock } from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

async function contarMovimientos(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movimientos`);
  return res.rows[0]?.n ?? 0;
}

describe('crearMovimiento (auto-confirmado, cualquier tipo)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('crea un RINT CONFIRMADO con correlativo y descuenta stock del origen', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const mov = await crearMovimiento(
      {
        tipo: 'RINT',
        origen_dep_id_3c: fx.deposito.depId3c,
        destino_dep_id_3c: fx.area.depId3c,
        fecha: '2026-06-19',
        detalle: [{ producto_3c: '401', cantidad_real: 50, unidad: 'KG' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.estado).toBe('CONFIRMADO');
    expect(mov.nro).toMatch(/^RINT-2026-\d{5}$/);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-50);
  });

  it('crea una RECEPCION que SUMA stock al destino, con correlativo REC', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const mov = await crearMovimiento(
      {
        tipo: 'RECEPCION',
        origen_dep_id_3c: fx.deposito.depId3c,
        destino_dep_id_3c: fx.deposito.depId3c,
        fecha: '2026-06-19',
        detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.nro).toMatch(/^REC-2026-\d{5}$/);
    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock[0]!.ubicacion_id).toBe(fx.deposito.id);
    expect(stock[0]!.cantidad).toBe(100);
  });

  it('falla con tipo desconocido (400) y no deja movimiento', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await expect(
      crearMovimiento(
        {
          tipo: 'INVENTADO',
          origen_dep_id_3c: fx.deposito.depId3c,
          destino_dep_id_3c: fx.area.depId3c,
          fecha: '2026-06-19',
          detalle: [{ producto_3c: '401', cantidad_real: 10, unidad: 'KG' }],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toMatchObject({ code: 'TIPO_INVALIDO', statusCode: 400 });
    expect(await contarMovimientos()).toBe(0);
  });

  it('falla si un producto no existe (404) y hace rollback', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await expect(
      crearMovimiento(
        {
          tipo: 'RINT',
          origen_dep_id_3c: fx.deposito.depId3c,
          destino_dep_id_3c: fx.area.depId3c,
          fecha: '2026-06-19',
          detalle: [{ producto_3c: 'NO_EXISTE', cantidad_real: 10, unidad: 'KG' }],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCTO_NO_ENCONTRADO' });
    expect(await contarMovimientos()).toBe(0);
  });
});
