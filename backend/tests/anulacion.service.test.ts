import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { movimientos } from '../src/db/schema.js';
import { bloquearMovimiento, marcarAnulado } from '../src/repositories/movimientos.repository.js';
import {
  anularMovimiento,
  editarMovimiento,
  obtenerHistorial,
  obtenerMovimientoPorId,
  obtenerStock,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, sembrarUsuario, type Fixtures } from './helpers/db.js';

// Crea un RINT CONFIRMADO (atajo: reusa el ingreso de abastecimiento).
async function crearConfirmado(fx: Fixtures, real: number): Promise<number> {
  const mov = await registrarAbastecimiento(
    {
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      detalle: [{ producto_3c: '401', cantidad_real: real, unidad: 'KG' }],
    },
    { usuarioId: fx.usuarioId },
  );
  return mov.id;
}

async function estadoEnDb(id: number): Promise<{ estado: string; anuladoPor: number | null } | undefined> {
  const [row] = await db
    .select({ estado: movimientos.estado, anuladoPor: movimientos.anuladoPor })
    .from(movimientos)
    .where(eq(movimientos.id, id))
    .limit(1);
  return row;
}

describe('anularMovimiento (flip CONFIRMADO → ANULADO)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('anula un CONFIRMADO, revierte el stock y sella auditoría (estado, anulado_por, anulado_en)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 150);

    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150);

    const anulado = await anularMovimiento(id, { usuarioId: fx.usuarioId });

    expect(anulado.estado).toBe('ANULADO');
    expect(anulado.anulado_en).not.toBeNull();

    const enDb = await estadoEnDb(id);
    expect(enDb!.estado).toBe('ANULADO');
    expect(enDb!.anuladoPor).toBe(fx.usuarioId); // regla #7

    // La matview deja de contar el movimiento anulado → el stock se revierte solo.
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0);
  });

  it('la anulación queda en el historial CON EL NOMBRE de quien la hizo (no un id pelado)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 150);
    const admin = await sembrarUsuario('jefe@laceleste.local', 'Jefe de Depósito');

    await anularMovimiento(id, { usuarioId: admin });

    const historial = await obtenerHistorial(id);
    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({
      accion: 'ANULACION',
      usuario_id: admin,
      usuario_nombre: 'Jefe de Depósito', // lo que se ve en pantalla
      cambios: [{ campo: 'estado', antes: 'CONFIRMADO', despues: 'ANULADO' }],
    });

    // Y el movimiento mismo dice quién lo anuló y quién lo había cargado.
    const mov = await obtenerMovimientoPorId(id);
    expect(mov.anulado_por_nombre).toBe('Jefe de Depósito');
    expect(mov.creado_por_nombre).toBe('Tester'); // el que lo dio de alta, no el que lo anuló
  });

  it('una edición también queda con nombre, y el historial ordena los eventos', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 150);
    const editor = await sembrarUsuario('editor@laceleste.local', 'Ana Editora');

    await editarMovimiento(
      id,
      {
        tipo: 'RINT',
        origen_dep_id_3c: fx.deposito.depId3c,
        destino_dep_id_3c: fx.area.depId3c,
        fecha: '2026-07-13',
        detalle: [{ producto_3c: '401', cantidad_real: 200, unidad: 'KG' }],
      },
      { usuarioId: editor },
    );
    await anularMovimiento(id, { usuarioId: fx.usuarioId });

    const historial = await obtenerHistorial(id);
    expect(historial).toHaveLength(2);
    // Más reciente primero: la anulación arriba, la edición abajo.
    expect(historial[0]).toMatchObject({ accion: 'ANULACION', secuencia: 2 });
    expect(historial[1]).toMatchObject({ accion: 'EDICION', secuencia: 1, usuario_nombre: 'Ana Editora' });
  });

  it('no se puede anular dos veces (segunda vez → YA_ANULADO)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 80);

    await anularMovimiento(id, { usuarioId: fx.usuarioId });

    await expect(anularMovimiento(id, { usuarioId: fx.usuarioId })).rejects.toMatchObject({
      code: 'YA_ANULADO',
      statusCode: 409,
    });
  });

  it('falla al anular un movimiento inexistente (MOVIMIENTO_NO_ENCONTRADO)', async () => {
    await sembrarEscenario({ productos3c: ['401'] });
    await expect(anularMovimiento(99999, { usuarioId: 1 })).rejects.toMatchObject({
      code: 'MOVIMIENTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });

  it('anular un movimiento NO afecta el stock de los demás (reversión puntual)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const idA = await crearConfirmado(fx, 150);
    await crearConfirmado(fx, 100);

    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-250);

    await anularMovimiento(idA, { usuarioId: fx.usuarioId });

    const stock = await obtenerStock({ producto3c: '401' });
    expect(stock).toHaveLength(1);
    expect(stock[0]!.cantidad).toBe(-100); // solo queda el movimiento no anulado
  });

  it('es transaccional: si algo falla después de marcar ANULADO, hace rollback (sigue CONFIRMADO)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 60);

    await expect(
      db.transaction(async (tx) => {
        await bloquearMovimiento(tx, id);
        await marcarAnulado(tx, id, fx.usuarioId);
        throw new Error('boom'); // fallo posterior dentro de la tx
      }),
    ).rejects.toThrow('boom');

    expect((await estadoEnDb(id))!.estado).toBe('CONFIRMADO'); // el flip se revirtió
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-60); // stock intacto
  });

  it('concurrencia: dos anulaciones simultáneas del mismo movimiento → una gana, la otra YA_ANULADO', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const id = await crearConfirmado(fx, 200);

    const [r1, r2] = await Promise.allSettled([
      anularMovimiento(id, { usuarioId: fx.usuarioId }),
      anularMovimiento(id, { usuarioId: fx.usuarioId }),
    ]);

    const estados = [r1.status, r2.status].sort();
    expect(estados).toEqual(['fulfilled', 'rejected']); // FOR UPDATE serializa: exactamente una gana
    const rechazada = (r1.status === 'rejected' ? r1 : r2) as PromiseRejectedResult;
    expect(rechazada.reason).toMatchObject({ code: 'YA_ANULADO' });

    expect((await estadoEnDb(id))!.estado).toBe('ANULADO');
    // El stock se revierte una sola vez (no hay doble reversión).
    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0);
  });
});
