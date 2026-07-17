import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anularMovimiento,
  obtenerHistorial,
  obtenerMovimientoPorId,
  obtenerStock,
  reconciliarBajasPorClave,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, sembrarUsuario } from './helpers/db.js';

// Bajas del sync de ABASTECIMIENTOS. La clave es `abast:<fecha>:<área>` (determinística,
// sin id externo): si el origen ya no lista esa (fecha, área) con real cargado, la vaciaron
// allá → el RINT que teníamos ya no corresponde y se anula.
//
// Lo delicado: a diferencia de una recepción borrada (que no vuelve nunca), un real se puede
// borrar y volver a guardar el mismo día. Por eso la baja tiene que ser REVERSIBLE: el sync
// revive SUS PROPIAS bajas. Lo que no se revive nunca es una anulación hecha por una persona.

const FECHA = '2026-07-11';
const FECHAS = ['2026-07-10', '2026-07-11', '2026-07-12'];

async function sembrarAbastecimiento(
  fx: Awaited<ReturnType<typeof sembrarEscenario>>,
  cantidad: number,
  usuarioId = fx.usuarioId,
) {
  return registrarAbastecimiento(
    {
      idempotency_key: `abast:${FECHA}:${fx.area.depId3c}`,
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: FECHA,
      detalle: [{ producto_3c: '401', cantidad_real: cantidad, unidad: 'KG' }],
    },
    { usuarioId, reconciliar: true },
  );
}

describe('reconciliar bajas de abastecimiento (vaciaron el área en el origen)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('el área quedó sin real: se anula el RINT y el stock se devuelve', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const mov = await sembrarAbastecimiento(fx, 100);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100);

    // El pull del día trajo filas, pero ninguna de esa área con real → la vaciaron.
    const bajas = await reconciliarBajasPorClave('abast:', FECHAS, new Set(), { usuarioId: fx.usuarioId });

    expect(bajas).toHaveLength(1);
    expect(bajas[0]).toMatchObject({ movimientoId: mov.id, idempotenciaKey: `abast:${FECHA}:${fx.area.depId3c}` });
    expect((await obtenerMovimientoPorId(mov.id)).estado).toBe('ANULADO');
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0); // stock devuelto
  });

  it('el real REAPARECE después de la baja: el sync revive su propia anulación y el stock vuelve', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const mov = await sembrarAbastecimiento(fx, 100);

    // Depósito borra el real → el sync lo anula.
    await reconciliarBajasPorClave('abast:', FECHAS, new Set(), { usuarioId: fx.usuarioId });
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0);

    // Más tarde lo vuelven a guardar (mismo valor) → la próxima corrida lo revive.
    const revivido = await sembrarAbastecimiento(fx, 100);

    expect(revivido.id).toBe(mov.id); // el mismo movimiento, no uno nuevo
    expect(revivido.estado).toBe('CONFIRMADO');
    expect(revivido.anulado_en).toBeNull();
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100); // stock recuperado
  });

  it('revive incluso si el real vuelve con OTRO valor (revive + reedita)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const mov = await sembrarAbastecimiento(fx, 100);
    await reconciliarBajasPorClave('abast:', FECHAS, new Set(), { usuarioId: fx.usuarioId });

    const revivido = await sembrarAbastecimiento(fx, 150); // lo recargaron corregido

    expect(revivido.id).toBe(mov.id);
    expect(revivido.estado).toBe('CONFIRMADO');
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150);

    // El historial cuenta la vuelta completa, del más reciente al más viejo:
    // lo anularon (baja), lo revivieron (el real volvió) y lo reeditaron (con otro valor).
    const historial = await obtenerHistorial(mov.id);
    expect(historial.map((h) => h.accion)).toEqual(['EDICION', 'REACTIVACION', 'ANULACION']);
  });

  it('una anulación HUMANA no se revive aunque el dato siga en el origen (regla #4)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const sync = fx.usuarioId; // el sync corre siempre con el usuario de integración
    const mov = await sembrarAbastecimiento(fx, 100, sync);

    // Un ADMIN de carne y hueso (otro usuario) lo anula a mano.
    const humano = await sembrarUsuario('admin.humano@laceleste.local');
    await anularMovimiento(mov.id, { usuarioId: humano });
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0);

    // El sync vuelve a pasar con el dato presente: NO debe resucitarlo (lo anuló una persona).
    const reintento = await sembrarAbastecimiento(fx, 150, sync);

    expect(reintento.estado).toBe('ANULADO'); // se respetó y se devolvió tal cual
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0); // sigue revertido
    // Queda la ANULACION del humano y nada más: el sync no editó ni revivió.
    const historial = await obtenerHistorial(mov.id);
    expect(historial.map((h) => h.accion)).toEqual(['ANULACION']);
    expect(historial[0]!.usuario_nombre).toBe('Admin Humano');
  });

  it('el área SIGUE con real: no se toca', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await sembrarAbastecimiento(fx, 100);

    const bajas = await reconciliarBajasPorClave(
      'abast:',
      FECHAS,
      new Set([`abast:${FECHA}:${fx.area.depId3c}`]),
      { usuarioId: fx.usuarioId },
    );

    expect(bajas).toHaveLength(0);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100);
  });

  it('un día sin datos (pull vacío o API caída) NO anula nada', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await sembrarAbastecimiento(fx, 100);

    // fechasConDatos vacío = el pull no trajo filas → no se evalúa ningún día.
    const bajas = await reconciliarBajasPorClave('abast:', [], new Set(), { usuarioId: fx.usuarioId });

    expect(bajas).toHaveLength(0);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100); // intacto
  });

  it('dry: reporta la baja pero no anula ni mueve stock', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await sembrarAbastecimiento(fx, 100);

    const bajas = await reconciliarBajasPorClave('abast:', FECHAS, new Set(), {
      usuarioId: fx.usuarioId,
      dry: true,
    });

    expect(bajas).toHaveLength(1);
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100);
  });
});
