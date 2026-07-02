import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { AppError } from '../src/domain/errors.js';
import { obtenerStock, registrarRecepcion } from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// En el escenario base: `deposito` (dep 1, lleva_stock) hace de FABRICA que RECIBE,
// y `area` (dep 47, sin stock) hace de PROVEEDOR que despacha. La recepción suma al
// destino real (FABRICA) por dirección; el origen sin stock no resta nada.
async function contarMovimientos(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movimientos`);
  return res.rows[0]?.n ?? 0;
}

describe('registrarRecepcion (RECEPCION auto-confirmada)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('crea una RECEPCION CONFIRMADA con correlativo y SUMA stock al destino por cantidad_real', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const mov = await registrarRecepcion(
      {
        origen_dep_id_3c: fx.area.depId3c, // proveedor (sin stock propio)
        destino_dep_id_3c: fx.deposito.depId3c, // FABRICA (lleva stock)
        detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'UNIDAD' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.estado).toBe('CONFIRMADO');
    expect(mov.nro).toMatch(/^REC-\d{4}-\d{5}$/);
    expect(mov.confirmado_en).not.toBeNull();

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock).toHaveLength(1);
    const fila = stock[0]!;
    expect(fila.ubicacion_id).toBe(fx.deposito.id); // suma al DESTINO (FABRICA)
    expect(fila.cantidad).toBe(200); // +cantidad_real (recepción suma)
  });

  it('es idempotente: misma idempotency_key NO duplica ni vuelve a sumar stock', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const input = {
      idempotency_key: 'recep:469',
      origen_dep_id_3c: fx.area.depId3c,
      destino_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'UNIDAD' }],
    };

    const a = await registrarRecepcion(input, { usuarioId: fx.usuarioId });
    const b = await registrarRecepcion(input, { usuarioId: fx.usuarioId });

    expect(b.nro).toBe(a.nro); // devuelve el mismo movimiento
    expect(await contarMovimientos()).toBe(1); // no se duplicó
    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock[0]!.cantidad).toBe(200); // no se sumó dos veces
  });

  it('usa DEPOSITO_PRINCIPAL como destino cuando no se pasa destino_dep_id_3c', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    // El destino por defecto sale de env.DEPOSITO_PRINCIPAL_DEP_ID_3C. Lo fijamos acá
    // (al depósito sembrado) para que el test NO dependa del .env del dev: en CI la
    // variable no está seteada y antes esto hacía fallar la suite. Se restaura al final.
    const prev = env.DEPOSITO_PRINCIPAL_DEP_ID_3C;
    env.DEPOSITO_PRINCIPAL_DEP_ID_3C = fx.deposito.depId3c;
    try {
      const mov = await registrarRecepcion(
        {
          origen_dep_id_3c: fx.area.depId3c, // proveedor
          detalle: [{ producto_3c: '401', cantidad_real: 50, unidad: 'UNIDAD' }],
        },
        { usuarioId: fx.usuarioId },
      );

      expect(mov.estado).toBe('CONFIRMADO');
      const stock = await obtenerStock({ producto3c: '401' });
      expect(stock).toHaveLength(1);
      expect(stock[0]!.ubicacion_id).toBe(fx.deposito.id); // cayó al depósito principal
      expect(stock[0]!.cantidad).toBe(50);
    } finally {
      env.DEPOSITO_PRINCIPAL_DEP_ID_3C = prev;
    }
  });

  it('falla si un producto no existe y NO deja movimiento (rollback de validación)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    await expect(
      registrarRecepcion(
        {
          origen_dep_id_3c: fx.area.depId3c,
          destino_dep_id_3c: fx.deposito.depId3c,
          detalle: [
            { producto_3c: '401', cantidad_real: 10, unidad: 'UNIDAD' },
            { producto_3c: 'NO_EXISTE', cantidad_real: 5, unidad: 'UNIDAD' },
          ],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCTO_NO_ENCONTRADO' });

    expect(await contarMovimientos()).toBe(0);
    expect(await obtenerStock({})).toHaveLength(0);
  });

  it('falla si el proveedor (origen) no existe', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await expect(
      registrarRecepcion(
        {
          origen_dep_id_3c: 99999,
          destino_dep_id_3c: fx.deposito.depId3c,
          detalle: [{ producto_3c: '401', cantidad_real: 10, unidad: 'UNIDAD' }],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await contarMovimientos()).toBe(0);
  });

  it('concurrencia: dos recepciones simultáneas → nros distintos y stock = suma de ambas', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const hacer = (real: number) =>
      registrarRecepcion(
        {
          origen_dep_id_3c: fx.area.depId3c,
          destino_dep_id_3c: fx.deposito.depId3c,
          detalle: [{ producto_3c: '401', cantidad_real: real, unidad: 'UNIDAD' }],
        },
        { usuarioId: fx.usuarioId },
      );

    const [a, b] = await Promise.all([hacer(200), hacer(150)]);

    expect(a.nro).not.toBe(b.nro);
    expect(await contarMovimientos()).toBe(2);

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock).toHaveLength(1);
    expect(stock[0]!.cantidad).toBe(350); // 200 + 150: sin lost update
  });
});
