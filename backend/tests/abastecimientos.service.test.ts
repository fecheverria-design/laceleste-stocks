import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { AppError } from '../src/domain/errors.js';
import { generarNro, insertarCabecera, tipoPorCodigo } from '../src/repositories/movimientos.repository.js';
import { obtenerStock, registrarAbastecimiento } from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

async function contarMovimientos(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movimientos`);
  return res.rows[0]?.n ?? 0;
}

describe('registrarAbastecimiento (RINT auto-confirmado)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('crea un RINT CONFIRMADO con correlativo y descuenta stock del depósito por cantidad_real', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const mov = await registrarAbastecimiento(
      {
        destino_dep_id_3c: fx.area.depId3c,
        origen_dep_id_3c: fx.deposito.depId3c,
        detalle: [{ producto_3c: '401', cantidad_real: 150, cantidad_sugerida: 145, unidad: 'KG' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.estado).toBe('CONFIRMADO');
    expect(mov.nro).toMatch(/^RINT-\d{4}-\d{5}$/);
    expect(mov.confirmado_en).not.toBeNull();

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock).toHaveLength(1);
    const fila = stock[0]!;
    expect(fila.ubicacion_id).toBe(fx.deposito.id); // se descuenta del DEPÓSITO (origen)
    expect(fila.cantidad).toBe(-150); // 150 * signo RINT(-1)
  });

  it('descuenta por cantidad_real, NO por cantidad_sugerida (regla #2)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    await registrarAbastecimiento(
      {
        destino_dep_id_3c: fx.area.depId3c,
        origen_dep_id_3c: fx.deposito.depId3c,
        detalle: [{ producto_3c: '401', cantidad_real: 150, cantidad_sugerida: 145, unidad: 'KG' }],
      },
      { usuarioId: fx.usuarioId },
    );

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock[0]!.cantidad).toBe(-150);
    expect(stock[0]!.cantidad).not.toBe(-145); // jamás el sugerido
  });

  it('falla si un producto no existe y NO deja movimiento (rollback de validación)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    await expect(
      registrarAbastecimiento(
        {
          destino_dep_id_3c: fx.area.depId3c,
          origen_dep_id_3c: fx.deposito.depId3c,
          detalle: [
            { producto_3c: '401', cantidad_real: 10, unidad: 'KG' },
            { producto_3c: 'NO_EXISTE', cantidad_real: 5, unidad: 'KG' },
          ],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCTO_NO_ENCONTRADO' });

    expect(await contarMovimientos()).toBe(0);
    expect(await obtenerStock({})).toHaveLength(0);
  });

  it('falla si el área destino no existe', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await expect(
      registrarAbastecimiento(
        {
          destino_dep_id_3c: 99999,
          origen_dep_id_3c: fx.deposito.depId3c,
          detalle: [{ producto_3c: '401', cantidad_real: 10, unidad: 'KG' }],
        },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await contarMovimientos()).toBe(0);
  });

  it('es transaccional: si algo falla después de insertar la cabecera, hace rollback', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    await expect(
      db.transaction(async (tx) => {
        const tipo = await tipoPorCodigo(tx, 'RINT');
        const nro = await generarNro(tx, 'RINT', 2026);
        await insertarCabecera(tx, {
          nro,
          tipoId: tipo!.id,
          fecha: '2026-06-11',
          hora: '10:00:00',
          origenId: fx.deposito.id,
          destinoId: fx.area.id,
          usuarioId: fx.usuarioId,
        });
        throw new Error('boom'); // simula fallo posterior dentro de la tx
      }),
    ).rejects.toThrow('boom');

    expect(await contarMovimientos()).toBe(0); // la cabecera insertada se revirtió
  });

  it('concurrencia: dos ingresos simultáneos → nros distintos y stock = suma de ambos', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const hacer = (real: number) =>
      registrarAbastecimiento(
        {
          destino_dep_id_3c: fx.area.depId3c,
          origen_dep_id_3c: fx.deposito.depId3c,
          detalle: [{ producto_3c: '401', cantidad_real: real, unidad: 'KG' }],
        },
        { usuarioId: fx.usuarioId },
      );

    const [a, b] = await Promise.all([hacer(150), hacer(100)]);

    expect(a.nro).not.toBe(b.nro); // correlativos sin colisión
    expect(await contarMovimientos()).toBe(2);

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock).toHaveLength(1);
    expect(stock[0]!.cantidad).toBe(-250); // -(150 + 100): sin lost update
  });
});
