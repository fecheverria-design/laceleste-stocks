import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { proveedores } from '../src/db/schema.js';
import {
  editarMovimiento,
  obtenerMovimientoPorId,
  registrarRecepcion,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// El proveedor real de la mercadería queda asociado a la RECEPCION (además del balde 102
// que usa el stock). La columna movimientos.proveedor_id ya existía (puerta abierta); acá
// se verifica que el sync la puebla, que el reconciliar la actualiza y que la edición
// manual (que NO edita proveedor) la preserva en vez de borrarla.
async function crearProveedor(numero3c: number, nombre: string): Promise<number> {
  const [row] = await db.insert(proveedores).values({ numero3c, nombre }).returning({ id: proveedores.id });
  return row!.id;
}

describe('RECEPCION con proveedor asociado', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('guarda proveedor_id y el detalle lo devuelve con nombre y numero_3c', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const provId = await crearProveedor(210, 'FUENTES S.A.');

    const mov = await registrarRecepcion(
      {
        origen_dep_id_3c: fx.area.depId3c,
        destino_dep_id_3c: fx.deposito.depId3c,
        proveedor_id: provId,
        detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'UNIDAD' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.proveedor_id).toBe(provId);
    expect(mov.proveedor_nombre).toBe('FUENTES S.A.');
    expect(mov.proveedor_numero_3c).toBe(210);
  });

  it('sin proveedor_id la recepción queda con proveedor null (no rompe)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const mov = await registrarRecepcion(
      {
        origen_dep_id_3c: fx.area.depId3c,
        destino_dep_id_3c: fx.deposito.depId3c,
        detalle: [{ producto_3c: '401', cantidad_real: 50, unidad: 'UNIDAD' }],
      },
      { usuarioId: fx.usuarioId },
    );

    expect(mov.proveedor_id).toBeNull();
    expect(mov.proveedor_nombre).toBeNull();
  });

  it('reconciliar: si en la 2ª corrida cambia el proveedor, lo actualiza (misma recepción)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const provA = await crearProveedor(210, 'FUENTES S.A.');
    const provB = await crearProveedor(305, 'PACUCA S.A.');

    const base = {
      idempotency_key: 'recep:485',
      origen_dep_id_3c: fx.area.depId3c,
      destino_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'UNIDAD' }],
    };

    const a = await registrarRecepcion({ ...base, proveedor_id: provA }, { usuarioId: fx.usuarioId, reconciliar: true });
    expect(a.proveedor_id).toBe(provA);

    const b = await registrarRecepcion({ ...base, proveedor_id: provB }, { usuarioId: fx.usuarioId, reconciliar: true });
    expect(b.nro).toBe(a.nro); // misma recepción (idempotente)
    expect(b.proveedor_id).toBe(provB); // el reconciliar pisó el proveedor
    expect(b.proveedor_nombre).toBe('PACUCA S.A.');
  });

  it('la edición manual (sin proveedor_id) PRESERVA el proveedor, no lo borra', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const provId = await crearProveedor(210, 'FUENTES S.A.');

    const mov = await registrarRecepcion(
      {
        origen_dep_id_3c: fx.area.depId3c,
        destino_dep_id_3c: fx.deposito.depId3c,
        proveedor_id: provId,
        detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'UNIDAD' }],
      },
      { usuarioId: fx.usuarioId },
    );

    // Edición como la del front: corrige la cantidad, NO manda proveedor_id.
    await editarMovimiento(
      mov.id,
      {
        tipo: 'RECEPCION',
        origen_dep_id_3c: fx.area.depId3c,
        destino_dep_id_3c: fx.deposito.depId3c,
        fecha: mov.fecha,
        detalle: [{ producto_3c: '401', cantidad_real: 250, unidad: 'UNIDAD' }],
      },
      { usuarioId: fx.usuarioId },
    );

    const releido = await obtenerMovimientoPorId(mov.id);
    expect(releido.detalle[0]!.cantidad_real).toBe('250.000'); // se editó
    expect(releido.proveedor_id).toBe(provId); // pero el proveedor quedó intacto
  });
});
