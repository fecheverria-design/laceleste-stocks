import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import {
  anularMovimiento,
  obtenerHistorial,
  obtenerStock,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, sembrarUsuario } from './helpers/db.js';

// Modo RECONCILIAR (sync "en vivo"): al re-sincronizar la misma (fecha, área), el
// movimiento existente se REEDITA con el estado fresco de la app del compañero en vez de
// devolverse tal cual. Reusa aplicarEdicion (mismo tx, sin anidar): transaccional,
// auditado y con stock recalculado; sin cambios = no-op. Ver docs/PROGRESO.md.

async function contarMovimientos(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM movimientos`);
  return res.rows[0]?.n ?? 0;
}

const KEY = 'abast:2026-07-01:47';

describe('reconciliar abastecimiento (sync en vivo)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('re-sync con real corregido: reedita el mismo movimiento, ajusta stock y deja historial', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const base = {
      idempotency_key: KEY,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-07-01',
    };

    const primero = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100);

    // Segunda corrida: el compañero corrigió el real a 150.
    const segundo = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );

    expect(segundo.nro).toBe(primero.nro); // el mismo movimiento, no uno nuevo
    expect(await contarMovimientos()).toBe(1); // no se duplicó
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150); // stock reconciliado
    expect(await obtenerHistorial(primero.id)).toHaveLength(1); // la edición quedó auditada
  });

  it('re-sync sin cambios: no-op (no toca stock ni genera historial)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const payload = {
      idempotency_key: KEY,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-07-01',
      detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }],
    };

    const primero = await registrarAbastecimiento(payload, { usuarioId: fx.usuarioId, reconciliar: true });
    await registrarAbastecimiento(payload, { usuarioId: fx.usuarioId, reconciliar: true });
    await registrarAbastecimiento(payload, { usuarioId: fx.usuarioId, reconciliar: true });

    expect(await contarMovimientos()).toBe(1);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100);
    expect(await obtenerHistorial(primero.id)).toHaveLength(0); // días sin novedad no ensucian el historial
  });

  it('re-sync que agrega un renglón nuevo: aparece en el detalle y en el stock', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    const base = {
      idempotency_key: KEY,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-07-01',
    };

    const primero = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );

    // Más tarde el área cargó otro producto en la misma sesión.
    const segundo = await registrarAbastecimiento(
      {
        ...base,
        detalle: [
          { producto_3c: '401', cantidad_real: 100, unidad: 'KG' },
          { producto_3c: '402', cantidad_real: 20, unidad: 'KG' },
        ],
      },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );

    expect(segundo.detalle).toHaveLength(2);
    expect((await obtenerStock({ producto3c: '402' }))[0]!.cantidad).toBe(-20);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100); // el existente no se toca
    expect(await obtenerHistorial(primero.id)).toHaveLength(1);
  });

  it('sin reconciliar (default): idempotencia clásica, NO reedita', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const base = {
      idempotency_key: KEY,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-07-01',
    };

    const primero = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId }, // reconciliar omitido → false
    );
    // Aunque el real cambie, sin reconciliar se devuelve el existente sin tocar.
    await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId },
    );

    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100); // quedó el original
    expect(await obtenerHistorial(primero.id)).toHaveLength(0);
  });

  it('respeta un movimiento ANULADO a mano: no lo resucita ni tira error', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const base = {
      idempotency_key: KEY,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-07-01',
    };

    const primero = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );
    // Lo anula una PERSONA (no el usuario con el que corre el sync): esa decisión no se pisa.
    // El sync sí revive sus propias bajas, pero eso es otra cosa (ver reconciliacion-bajas-*).
    const humano = await sembrarUsuario('admin.humano@laceleste.local');
    await anularMovimiento(primero.id, { usuarioId: humano });
    expect((await obtenerStock({ producto3c: '401' })).length).toBe(0); // anulado → stock revertido

    // El sync vuelve a pasar por esa fecha: no debe reeditar ni fallar.
    const reintento = await registrarAbastecimiento(
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId, reconciliar: true },
    );

    expect(reintento.estado).toBe('ANULADO'); // se devolvió tal cual
    expect(await contarMovimientos()).toBe(1);
    expect((await obtenerStock({ producto3c: '401' })).length).toBe(0); // sigue revertido
    // El historial tiene la ANULACION (queda registrada, regla #7) pero NINGUNA edición:
    // el sync no lo tocó.
    const historial = await obtenerHistorial(primero.id);
    expect(historial.filter((h) => h.accion === 'EDICION')).toHaveLength(0);
    expect(historial.map((h) => h.accion)).toEqual(['ANULACION']);
  });
});
