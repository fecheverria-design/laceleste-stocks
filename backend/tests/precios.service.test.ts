import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  crearPrecio,
  editarPrecio,
  eliminarPrecio,
  obtenerHistorialPrecios,
  obtenerPreciosVigentes,
} from '../src/services/precios.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// Fechas relativas a hoy para no depender de una fecha fija.
function ymd(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

const vigentePorProducto = async (producto3c: string) =>
  (await obtenerPreciosVigentes()).find((f) => f.producto_3c === producto3c);

describe('precios (historial con fecha de vigencia)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('carga un precio y aparece como vigente; default vigente_desde = hoy', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    const creado = await crearPrecio({ producto_3c: '401', precio: 1250.5 }, { usuarioId: fx.usuarioId });
    expect(creado.vigente_desde).toBe(ymd());

    const vig = await vigentePorProducto('401');
    expect(vig).toMatchObject({ producto_3c: '401', precio: '1250.5000', vigente_desde: ymd() });
  });

  it('el precio vigente es el de mayor vigente_desde <= hoy (ignora futuros)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });

    await crearPrecio({ producto_3c: '401', precio: 100, vigente_desde: ymd(-30) }, { usuarioId: fx.usuarioId });
    await crearPrecio({ producto_3c: '401', precio: 200, vigente_desde: ymd(-10) }, { usuarioId: fx.usuarioId });
    // precio futuro: todavía no rige
    await crearPrecio({ producto_3c: '401', precio: 999, vigente_desde: ymd(10) }, { usuarioId: fx.usuarioId });

    const vig = await vigentePorProducto('401');
    expect(vig?.precio).toBe('200.0000');
    expect(vig?.vigente_desde).toBe(ymd(-10));
  });

  it('un producto sin precio aparece en la lista con precio null', async () => {
    await sembrarEscenario({ productos3c: ['401'] });
    const vig = await vigentePorProducto('401');
    expect(vig).toMatchObject({ producto_3c: '401', precio: null, vigente_desde: null, precio_id: null });
  });

  it('rechaza cargar precio de un producto inexistente (404)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await expect(
      crearPrecio({ producto_3c: 'NO_EXISTE', precio: 10 }, { usuarioId: fx.usuarioId }),
    ).rejects.toMatchObject({ code: 'PRODUCTO_NO_ENCONTRADO', statusCode: 404 });
  });

  it('rechaza dos precios con la misma fecha de vigencia (409)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearPrecio({ producto_3c: '401', precio: 100, vigente_desde: ymd(-5) }, { usuarioId: fx.usuarioId });
    await expect(
      crearPrecio({ producto_3c: '401', precio: 150, vigente_desde: ymd(-5) }, { usuarioId: fx.usuarioId }),
    ).rejects.toMatchObject({ code: 'PRECIO_DUPLICADO', statusCode: 409 });
  });

  it('edita el monto de un precio ya cargado', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const creado = await crearPrecio({ producto_3c: '401', precio: 100 }, { usuarioId: fx.usuarioId });

    const editado = await editarPrecio(creado.id, { precio: 175.25 });
    expect(editado.precio).toBe('175.2500');
    expect((await vigentePorProducto('401'))?.precio).toBe('175.2500');
  });

  it('editar a una fecha ya ocupada por otro precio del producto da 409', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearPrecio({ producto_3c: '401', precio: 100, vigente_desde: ymd(-10) }, { usuarioId: fx.usuarioId });
    const b = await crearPrecio({ producto_3c: '401', precio: 200, vigente_desde: ymd(-5) }, { usuarioId: fx.usuarioId });

    await expect(editarPrecio(b.id, { vigente_desde: ymd(-10) })).rejects.toMatchObject({
      code: 'PRECIO_DUPLICADO',
      statusCode: 409,
    });
  });

  it('borra un precio mal cargado', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const creado = await crearPrecio({ producto_3c: '401', precio: 100 }, { usuarioId: fx.usuarioId });

    await eliminarPrecio(creado.id);
    expect((await vigentePorProducto('401'))?.precio).toBeNull();
    await expect(eliminarPrecio(creado.id)).rejects.toMatchObject({ code: 'PRECIO_NO_ENCONTRADO', statusCode: 404 });
  });

  it('el historial sale más reciente primero', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearPrecio({ producto_3c: '401', precio: 100, vigente_desde: ymd(-20) }, { usuarioId: fx.usuarioId });
    await crearPrecio({ producto_3c: '401', precio: 200, vigente_desde: ymd(-10) }, { usuarioId: fx.usuarioId });

    const hist = await obtenerHistorialPrecios('401');
    expect(hist.map((h) => h.vigente_desde)).toEqual([ymd(-10), ymd(-20)]);
  });

  it('pedir historial de un producto inexistente da 404', async () => {
    await sembrarEscenario({ productos3c: ['401'] });
    await expect(obtenerHistorialPrecios('NO_EXISTE')).rejects.toMatchObject({
      code: 'PRODUCTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });
});
