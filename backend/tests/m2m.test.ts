import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { requireApiKey } from '../src/middleware/auth.js';
import { obtenerStock, registrarAbastecimiento } from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

async function contarMovimientos(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movimientos`);
  return res.rows[0]?.n ?? 0;
}

describe('idempotencia del abastecimiento M2M', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('mismo idempotency_key NO duplica: devuelve el mismo movimiento', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const payload = {
      idempotency_key: 'pedido-abc-123',
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: 50, unidad: 'KG' }],
    };

    const primero = await registrarAbastecimiento(payload, { usuarioId: fx.usuarioId });
    const segundo = await registrarAbastecimiento(payload, { usuarioId: fx.usuarioId });

    expect(segundo.nro).toBe(primero.nro); // mismo movimiento
    expect(await contarMovimientos()).toBe(1); // no se duplicó
    // El stock se descontó UNA sola vez (-50, no -100).
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-50);
  });

  it('distinto idempotency_key crea movimientos distintos', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const base = {
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: 10, unidad: 'KG' }],
    };
    await registrarAbastecimiento({ ...base, idempotency_key: 'k1' }, { usuarioId: fx.usuarioId });
    await registrarAbastecimiento({ ...base, idempotency_key: 'k2' }, { usuarioId: fx.usuarioId });
    expect(await contarMovimientos()).toBe(2);
  });

  it('sin idempotency_key se comporta como antes (cada POST crea)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const base = {
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: 10, unidad: 'KG' }],
    };
    await registrarAbastecimiento(base, { usuarioId: fx.usuarioId });
    await registrarAbastecimiento(base, { usuarioId: fx.usuarioId });
    expect(await contarMovimientos()).toBe(2);
  });
});

describe('requireApiKey (auth M2M)', () => {
  const original = env.M2M_API_KEY;
  afterEach(() => {
    env.M2M_API_KEY = original;
  });

  const correr = (apiKey: string | undefined, header: unknown) => {
    env.M2M_API_KEY = apiKey;
    const next = vi.fn() as unknown as NextFunction;
    const req = { headers: { 'x-api-key': header } } as unknown as Request;
    const res = {} as Response;
    requireApiKey(req, res, next);
    return next;
  };

  it('503 si el server no tiene M2M_API_KEY configurada', () => {
    expect(() => correr(undefined, 'cualquiera')).toThrow(/M2M/);
  });

  it('401 si la API key falta o no coincide', () => {
    expect(() => correr('clave-secreta-larga-123', undefined)).toThrow(/API key/);
    expect(() => correr('clave-secreta-larga-123', 'otra')).toThrow(/API key/);
  });

  it('pasa (next) con la API key correcta', () => {
    const next = correr('clave-secreta-larga-123', 'clave-secreta-larga-123');
    expect(next).toHaveBeenCalledOnce();
  });
});
