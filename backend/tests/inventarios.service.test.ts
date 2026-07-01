import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { productos } from '../src/db/schema.js';
import { AppError } from '../src/domain/errors.js';
import { obtenerStock, registrarRecepcion } from '../src/services/movimientos.service.js';
import {
  confirmarInventario,
  crearInventario,
  guardarLineas,
} from '../src/services/inventarios.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// Inventario (conteo físico → AJUSTE). Al confirmar, el stock queda EXACTO en lo contado
// por cada línea con diferencia; las no contadas se saltean (no se ponen en 0).

// Escenario: depósito (dep 1) con stock inicial de 3 productos PACKAGING + 1 MATERIAS PRIMAS.
// El stock se siembra con una RECEPCION desde el área (que no lleva stock) hacia el depósito.
async function escenario() {
  const fx = await sembrarEscenario({ productos3c: [] });
  await db.insert(productos).values([
    { codigo3c: '401', nombre: 'Bolsa kraft', unidadBase: 'UN', familia: 'PACKAGING' },
    { codigo3c: '402', nombre: 'Bolsa cristal', unidadBase: 'UN', familia: 'PACKAGING' },
    { codigo3c: '403', nombre: 'Caja', unidadBase: 'UN', familia: 'PACKAGING' },
    { codigo3c: '500', nombre: 'Harina', unidadBase: 'KG', familia: 'MATERIAS PRIMAS' },
  ]);
  // Stock inicial en el depósito: 401=100, 402=50, 403=30, 500=200.
  await registrarRecepcion(
    {
      origen_dep_id_3c: fx.area.depId3c, // no lleva stock → solo suma al destino
      destino_dep_id_3c: fx.deposito.depId3c,
      detalle: [
        { producto_3c: '401', cantidad_real: 100, unidad: 'UN' },
        { producto_3c: '402', cantidad_real: 50, unidad: 'UN' },
        { producto_3c: '403', cantidad_real: 30, unidad: 'UN' },
        { producto_3c: '500', cantidad_real: 200, unidad: 'KG' },
      ],
    },
    { usuarioId: fx.usuarioId },
  );
  return fx;
}

const stockDe = async (producto3c: string): Promise<number> => {
  const s = await obtenerStock({ producto3c });
  return s[0]?.cantidad ?? 0;
};

describe('inventarios (conteo físico → AJUSTE)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('crear arma la hoja con los productos de la familia pedida', async () => {
    const fx = await escenario();
    const inv = await crearInventario(
      { ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] },
      fx.usuarioId,
    );
    expect(inv.estado).toBe('BORRADOR');
    expect(inv.lineas).toHaveLength(3); // 401, 402, 403 (no 500, que es MATERIAS PRIMAS)
    const l401 = inv.lineas.find((l) => l.producto_3c === '401')!;
    expect(l401.stock_sistema).toBe(100);
    expect(l401.cantidad_contada).toBeNull();
    expect(l401.diferencia).toBeNull();
  });

  it('confirmar con contado > sistema genera AJUSTE de entrada y deja el stock en lo contado', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 120 }] });

    const res = await confirmarInventario(inv.id, fx.usuarioId);

    expect(res.inventario.estado).toBe('CONFIRMADO');
    expect(res.resumen.renglones_entrada).toBe(1);
    expect(res.resumen.renglones_salida).toBe(0);
    expect(res.resumen.entrada_nro).toMatch(/^AJU-\d{4}-\d{5}$/);
    expect(await stockDe('401')).toBe(120); // 100 + 20
  });

  it('confirmar con contado < sistema genera AJUSTE de salida', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '402', cantidad_contada: 40 }] });

    const res = await confirmarInventario(inv.id, fx.usuarioId);

    expect(res.resumen.renglones_salida).toBe(1);
    expect(res.resumen.salida_nro).toMatch(/^AJU-\d{4}-\d{5}$/);
    expect(await stockDe('402')).toBe(40); // 50 − 10
  });

  it('contado = sistema no genera movimiento (sin cambio)', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 100 }] });

    const res = await confirmarInventario(inv.id, fx.usuarioId);

    expect(res.resumen.sin_cambio).toBe(1);
    expect(res.resumen.entrada_nro).toBeNull();
    expect(res.resumen.salida_nro).toBeNull();
    expect(await stockDe('401')).toBe(100);
  });

  it('líneas sin contar se saltean (no tocan stock)', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    // Solo se cuenta 401; 402 y 403 quedan sin contar.
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 90 }] });

    const res = await confirmarInventario(inv.id, fx.usuarioId);

    expect(res.resumen.sin_contar).toBe(2); // 402 y 403
    expect(await stockDe('401')).toBe(90); // ajustado
    expect(await stockDe('402')).toBe(50); // intacto
    expect(await stockDe('403')).toBe(30); // intacto
  });

  it('mezcla: sube uno, baja otro, deja igual, saltea otro', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, {
      lineas: [
        { producto_3c: '401', cantidad_contada: 110 }, // +10 (entrada)
        { producto_3c: '402', cantidad_contada: 45 }, // −5 (salida)
        { producto_3c: '403', cantidad_contada: 30 }, // igual
      ],
    });

    const res = await confirmarInventario(inv.id, fx.usuarioId);

    expect(res.resumen.renglones_entrada).toBe(1);
    expect(res.resumen.renglones_salida).toBe(1);
    expect(res.resumen.sin_cambio).toBe(1);
    expect(await stockDe('401')).toBe(110);
    expect(await stockDe('402')).toBe(45);
    expect(await stockDe('403')).toBe(30);
  });

  it('no se puede confirmar dos veces', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 120 }] });
    await confirmarInventario(inv.id, fx.usuarioId);

    await expect(confirmarInventario(inv.id, fx.usuarioId)).rejects.toMatchObject({ code: 'INVENTARIO_YA_CONFIRMADO' });
  });

  it('no se puede editar una hoja ya confirmada', async () => {
    const fx = await escenario();
    const inv = await crearInventario({ ubicacion_id: fx.deposito.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId);
    await guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 120 }] });
    await confirmarInventario(inv.id, fx.usuarioId);

    await expect(
      guardarLineas(inv.id, { lineas: [{ producto_3c: '401', cantidad_contada: 130 }] }),
    ).rejects.toMatchObject({ code: 'INVENTARIO_NO_EDITABLE' });
  });

  it('crear sobre una ubicación que no lleva stock falla', async () => {
    const fx = await escenario();
    await expect(
      crearInventario({ ubicacion_id: fx.area.id, fecha: '2026-07-05', familias: ['PACKAGING'] }, fx.usuarioId),
    ).rejects.toBeInstanceOf(AppError);
  });
});
