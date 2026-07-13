import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EditarMovimientoInput } from '../src/domain/movimientos.schema.js';
import {
  anularMovimiento,
  editarMovimiento,
  obtenerHistorial,
  obtenerStock,
  registrarAbastecimiento,
} from '../src/services/movimientos.service.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

// Crea un RINT CONFIRMADO base (401 x150 a un área) y devuelve su id + fixtures.
async function escenario(): Promise<{ fx: Fixtures; id: number; base: EditarMovimientoInput }> {
  const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
  const mov = await registrarAbastecimiento(
    {
      destino_dep_id_3c: fx.area.depId3c,
      origen_dep_id_3c: fx.deposito.depId3c,
      fecha: '2026-06-10',
      detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }],
    },
    { usuarioId: fx.usuarioId },
  );
  const base: EditarMovimientoInput = {
    tipo: 'RINT',
    origen_dep_id_3c: fx.deposito.depId3c,
    destino_dep_id_3c: fx.area.depId3c,
    fecha: '2026-06-10',
    detalle: [{ producto_3c: '401', cantidad_real: 150, unidad: 'KG' }],
  };
  return { fx, id: mov.id, base };
}

describe('editarMovimiento (editable con historial)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('editar la cantidad recalcula el stock y registra el cambio en el historial', async () => {
    const { fx, id, base } = await escenario();
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150);

    const editado = await editarMovimiento(
      id,
      { ...base, detalle: [{ producto_3c: '401', cantidad_real: 100, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId },
    );
    expect(editado.detalle[0]!.cantidad_real).toBe('100.000');
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-100); // recalculado

    const hist = await obtenerHistorial(id);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.accion).toBe('EDICION');
    expect(hist[0]!.usuario_id).toBe(fx.usuarioId);
    expect(hist[0]!.cambios.some((c) => c.campo === 'detalle')).toBe(true);
  });

  it('numera las ediciones dentro del movimiento (secuencia estable, vieja=1)', async () => {
    const { fx, id, base } = await escenario();
    await editarMovimiento(id, { ...base, observaciones: 'primera' }, { usuarioId: fx.usuarioId });
    await editarMovimiento(id, { ...base, observaciones: 'segunda' }, { usuarioId: fx.usuarioId });
    await editarMovimiento(id, { ...base, observaciones: 'tercera' }, { usuarioId: fx.usuarioId });

    const hist = await obtenerHistorial(id); // reciente primero
    expect(hist.map((h) => h.secuencia)).toEqual([3, 2, 1]);
    // La más reciente (secuencia 3) es la que dejó "tercera".
    expect(hist[0]!.cambios.find((c) => c.campo === 'observaciones')?.despues).toBe('tercera');
  });

  it('cambiar el producto del renglón mueve el stock al nuevo producto', async () => {
    const { fx, id, base } = await escenario();

    await editarMovimiento(
      id,
      { ...base, detalle: [{ producto_3c: '402', cantidad_real: 150, unidad: 'KG' }] },
      { usuarioId: fx.usuarioId },
    );

    expect(await obtenerStock({ producto3c: '401' })).toHaveLength(0); // ya no participa
    expect((await obtenerStock({ producto3c: '402' }))[0]!.cantidad).toBe(-150);
  });

  it('editar solo un campo descriptivo no toca el stock y queda en el historial', async () => {
    const { fx, id, base } = await escenario();

    await editarMovimiento(id, { ...base, observaciones: 'corregido por J' }, { usuarioId: fx.usuarioId });

    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150); // sin cambio
    const hist = await obtenerHistorial(id);
    expect(hist).toHaveLength(1);
    const cambioObs = hist[0]!.cambios.find((c) => c.campo === 'observaciones');
    expect(cambioObs?.despues).toBe('corregido por J');
  });

  it('editar sin cambios reales NO genera fila de historial', async () => {
    const { fx, id, base } = await escenario();
    await editarMovimiento(id, base, { usuarioId: fx.usuarioId }); // mismos valores
    expect(await obtenerHistorial(id)).toHaveLength(0);
  });

  it('falla al editar un movimiento inexistente (404)', async () => {
    const { fx, base } = await escenario();
    await expect(editarMovimiento(99999, base, { usuarioId: fx.usuarioId })).rejects.toMatchObject({
      code: 'MOVIMIENTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });

  it('no se puede editar un movimiento ANULADO (409)', async () => {
    const { fx, id, base } = await escenario();
    await anularMovimiento(id, { usuarioId: fx.usuarioId });
    await expect(editarMovimiento(id, base, { usuarioId: fx.usuarioId })).rejects.toMatchObject({
      code: 'MOVIMIENTO_ANULADO',
      statusCode: 409,
    });
  });

  it('es transaccional: si un renglón referencia un producto inexistente, no cambia nada', async () => {
    const { fx, id, base } = await escenario();

    await expect(
      editarMovimiento(
        id,
        { ...base, detalle: [{ producto_3c: 'NO_EXISTE', cantidad_real: 5, unidad: 'KG' }] },
        { usuarioId: fx.usuarioId },
      ),
    ).rejects.toMatchObject({ code: 'PRODUCTO_NO_ENCONTRADO' });

    // El movimiento y su stock quedaron intactos; no se registró historial.
    expect((await obtenerStock({ producto3c: '401' }))[0]!.cantidad).toBe(-150);
    expect(await obtenerHistorial(id)).toHaveLength(0);
  });
});
