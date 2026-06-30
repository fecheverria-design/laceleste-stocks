import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { proveedores } from '../src/db/schema.js';
import { insertarPrecio } from '../src/repositories/precios.repository.js';
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

  it('con varios proveedores, el precio vigente es el de fecha más reciente (y muestra su proveedor)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const [provViejo] = await db
      .insert(proveedores)
      .values({ numero3c: 1000001, nombre: 'PROVEEDOR GENERICO' })
      .returning({ id: proveedores.id });
    const [provNuevo] = await db
      .insert(proveedores)
      .values({ numero3c: 1247, nombre: 'SIMPLE DISTRIBUCIONES SRL' })
      .returning({ id: proveedores.id });

    // Genérico viejo y barato; proveedor real más reciente y caro.
    await insertarPrecio({ producto3c: '401', proveedorId: provViejo!.id, precio: 1, vigenteDesde: ymd(-300), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', proveedorId: provNuevo!.id, precio: 2644.38, vigenteDesde: ymd(-7), usuarioId: fx.usuarioId });

    const vig = (await obtenerPreciosVigentes()).find((f) => f.producto_3c === '401');
    expect(vig?.precio).toBe('2644.3800');
    expect(vig?.vigente_desde).toBe(ymd(-7));
    expect(vig?.proveedor_nombre).toBe('SIMPLE DISTRIBUCIONES SRL');
    expect(vig?.proveedor_numero_3c).toBe(1247);
  });

  it('dos proveedores pueden tener precio el MISMO día sin chocar (clave producto+proveedor+fecha)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const [pA] = await db.insert(proveedores).values({ numero3c: 10, nombre: 'A' }).returning({ id: proveedores.id });
    const [pB] = await db.insert(proveedores).values({ numero3c: 20, nombre: 'B' }).returning({ id: proveedores.id });

    await insertarPrecio({ producto3c: '401', proveedorId: pA!.id, precio: 100, vigenteDesde: ymd(-1), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', proveedorId: pB!.id, precio: 200, vigenteDesde: ymd(-1), usuarioId: fx.usuarioId });

    const hist = await obtenerHistorialPrecios('401');
    expect(hist).toHaveLength(2);
  });

  it('el vigente es la última COMPRA aunque haya una ACTUALIZACION más nueva', async () => {
    const fx = await sembrarEscenario({ productos3c: ['789'] });
    const [prov] = await db.insert(proveedores).values({ numero3c: 7488, nombre: 'CADRI NORTE' }).returning({ id: proveedores.id });

    // Compra real (vieja) + actualización de lista (más nueva). Manda la compra.
    await insertarPrecio({ producto3c: '789', proveedorId: prov!.id, precio: 252, tipo: 'COMPRA', vigenteDesde: ymd(-40), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '789', proveedorId: prov!.id, precio: 630, tipo: 'ACTUALIZACION', vigenteDesde: ymd(-7), usuarioId: fx.usuarioId });

    const vig = await vigentePorProducto('789');
    expect(vig?.precio).toBe('252.0000');
    expect(vig?.tipo).toBe('COMPRA');
    expect(vig?.vigente_desde).toBe(ymd(-40));
  });

  it('si nunca hubo COMPRA, cae a la última ACTUALIZACION (marcada como tal)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['789'] });
    const [prov] = await db.insert(proveedores).values({ numero3c: 7154, nombre: 'GODOY' }).returning({ id: proveedores.id });

    await insertarPrecio({ producto3c: '789', proveedorId: prov!.id, precio: 1000, tipo: 'ACTUALIZACION', vigenteDesde: ymd(-20), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '789', proveedorId: prov!.id, precio: 1200, tipo: 'ACTUALIZACION', vigenteDesde: ymd(-5), usuarioId: fx.usuarioId });

    const vig = await vigentePorProducto('789');
    expect(vig?.precio).toBe('1200.0000');
    expect(vig?.tipo).toBe('ACTUALIZACION');
  });

  it('crear con tipo ACTUALIZACION no pisa el vigente si hay una COMPRA', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearPrecio({ producto_3c: '401', precio: 100, tipo: 'COMPRA', vigente_desde: ymd(-10) }, { usuarioId: fx.usuarioId });
    await crearPrecio({ producto_3c: '401', precio: 500, tipo: 'ACTUALIZACION', vigente_desde: ymd(-1) }, { usuarioId: fx.usuarioId });

    const vig = await vigentePorProducto('401');
    expect(vig?.precio).toBe('100.0000');
    expect(vig?.tipo).toBe('COMPRA');
  });

  it('editar el tipo de ACTUALIZACION a COMPRA la convierte en el vigente', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await crearPrecio({ producto_3c: '401', precio: 100, tipo: 'COMPRA', vigente_desde: ymd(-10) }, { usuarioId: fx.usuarioId });
    const act = await crearPrecio({ producto_3c: '401', precio: 500, tipo: 'ACTUALIZACION', vigente_desde: ymd(-1) }, { usuarioId: fx.usuarioId });

    await editarPrecio(act.id, { tipo: 'COMPRA' });
    const vig = await vigentePorProducto('401');
    expect(vig?.precio).toBe('500.0000'); // ahora es la COMPRA más reciente
    expect(vig?.tipo).toBe('COMPRA');
  });

  it('pedir historial de un producto inexistente da 404', async () => {
    await sembrarEscenario({ productos3c: ['401'] });
    await expect(obtenerHistorialPrecios('NO_EXISTE')).rejects.toMatchObject({
      code: 'PRODUCTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });
});
