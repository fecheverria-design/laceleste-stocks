import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anularMovimiento,
  obtenerStock,
  reconciliarBajas,
  registrarRecepcion,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// Reconciliación de BAJAS: lo que el sync materializó y la app del compañero YA NO lista.
// Nace del caso LOGINCOR (04/07/2026): su agenda tenía la recepción cargada dos veces, la
// borraron de un lado, y como nuestro sync solo daba de alta / editaba, la mercadería quedó
// contada DOS VECES acá para siempre.
//
// La distinción que importa:
//   - BORRADA en el origen  → anular (revierte stock, regla #4: flip de estado).
//   - REPROGRAMADA de fecha → NO tocar: anular es irreversible (un ANULADO no revive), así
//     que anularla perdería la recepción cuando su fecha nueva entre en la ventana.

const FECHAS = ['2026-07-03', '2026-07-04', '2026-07-05'];

// La recepción suma stock al destino (FABRICA); el origen es el balde de proveedores.
async function sembrarRecepcion(fx: Awaited<ReturnType<typeof sembrarEscenario>>, recepId: number, fecha: string) {
  return registrarRecepcion(
    {
      idempotency_key: `recep:${recepId}`,
      origen_dep_id_3c: fx.area.depId3c, // balde sin stock propio (lleva_stock = false)
      destino_dep_id_3c: fx.deposito.depId3c,
      fecha,
      detalle: [{ producto_3c: '427', cantidad_real: 1075, unidad: 'KG' }],
    },
    { usuarioId: fx.usuarioId, reconciliar: true },
  );
}

describe('reconciliar bajas (el origen ya no lista lo que materializamos)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('recepción BORRADA en la app del compañero: se anula y el stock se revierte', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    const mov = await sembrarRecepcion(fx, 514, '2026-07-04');
    expect((await obtenerStock({ producto3c: '427' }))[0]!.cantidad).toBe(1075);

    // El pull del día ya no la trae, y no está en ninguna otra fecha del origen → borrada.
    const res = await reconciliarBajas('recep:', FECHAS, new Set(), async () => new Map(), {
      usuarioId: fx.usuarioId,
    });

    expect(res.anuladas).toHaveLength(1);
    expect(res.anuladas[0]).toMatchObject({ movimientoId: mov.id, externoId: 514 });
    expect(res.reprogramadas).toHaveLength(0);
    expect(await obtenerStock({ producto3c: '427' })).toHaveLength(0); // stock revertido
  });

  it('recepción REPROGRAMADA a otra fecha: NO se anula (anular sería irreversible)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    await sembrarRecepcion(fx, 555, '2026-07-04');

    // No aparece en la ventana, pero el origen la sigue teniendo: la movieron al 16.
    const res = await reconciliarBajas(
      'recep:',
      FECHAS,
      new Set(),
      async () => new Map([[555, '2026-07-16']]),
      { usuarioId: fx.usuarioId },
    );

    expect(res.anuladas).toHaveLength(0);
    expect(res.reprogramadas).toHaveLength(1);
    expect(res.reprogramadas[0]).toMatchObject({ externoId: 555, fechaEnOrigen: '2026-07-16' });
    expect((await obtenerStock({ producto3c: '427' }))[0]!.cantidad).toBe(1075); // intacta
  });

  it('recepción que el origen SÍ lista: no la toca', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    await sembrarRecepcion(fx, 504, '2026-07-04');

    const res = await reconciliarBajas('recep:', FECHAS, new Set([504]), async () => new Map(), {
      usuarioId: fx.usuarioId,
    });

    expect(res.anuladas).toHaveLength(0);
    expect(res.reprogramadas).toHaveLength(0);
    expect((await obtenerStock({ producto3c: '427' }))[0]!.cantidad).toBe(1075);
  });

  it('no toca lo de fuera de la ventana ni lo ya ANULADO', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    const fuera = await sembrarRecepcion(fx, 400, '2026-06-20'); // anterior a la ventana
    const anulada = await sembrarRecepcion(fx, 401, '2026-07-04');
    await anularMovimiento(anulada.id, { usuarioId: fx.usuarioId });

    const res = await reconciliarBajas('recep:', FECHAS, new Set(), async () => new Map(), {
      usuarioId: fx.usuarioId,
    });

    expect(res.anuladas).toHaveLength(0); // la de junio no entra; la anulada ya no cuenta
    expect(res.reprogramadas).toHaveLength(0);
    expect((await obtenerStock({ producto3c: '427' }))[0]!.cantidad).toBe(1075); // solo la de junio
    expect(fuera.estado).toBe('CONFIRMADO');
  });

  it('dry: detecta la baja pero no anula ni mueve stock', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    await sembrarRecepcion(fx, 514, '2026-07-04');

    const res = await reconciliarBajas('recep:', FECHAS, new Set(), async () => new Map(), {
      usuarioId: fx.usuarioId,
      dry: true,
    });

    expect(res.anuladas).toHaveLength(1); // la reporta…
    expect((await obtenerStock({ producto3c: '427' }))[0]!.cantidad).toBe(1075); // …pero no la aplica
  });

  it('sin huérfanas no pide el índice del origen (es caro: son varias llamadas HTTP)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['427'] });
    await sembrarRecepcion(fx, 504, '2026-07-04');

    let pedidos = 0;
    await reconciliarBajas(
      'recep:',
      FECHAS,
      new Set([504]),
      async () => {
        pedidos++;
        return new Map();
      },
      { usuarioId: fx.usuarioId },
    );

    expect(pedidos).toBe(0);
  });
});
