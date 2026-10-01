import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { proveedores } from '../src/db/schema.js';
import { insertarPrecio, marcarControlado } from '../src/repositories/precios.repository.js';
import { obtenerFichaPrecio } from '../src/services/precios.service.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// La ficha "de dónde sale este precio" colgada de un producto concreto (hoja de Precios y
// Control de precios). Lo que importa NO es la redacción sino que diga la verdad sobre la
// fila que la app está usando: si mintiera, sería peor que no tenerla (ver procedencia.ts).
// Por eso se testea contra el precio que efectivamente gana la prelación.

function ymd(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

const ar = (ymdStr: string): string => `${ymdStr.slice(8, 10)}/${ymdStr.slice(5, 7)}/${ymdStr.slice(0, 4)}`;

/** El texto del paso "Cuál se está usando", que es el que responde la pregunta. */
const cual = (ficha: { pasos: Array<{ titulo: string; detalle: string }> }): string =>
  ficha.pasos.find((p) => p.titulo === 'Cuál se está usando')?.detalle ?? '';

describe('ficha de precio de un producto', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('nombra la última COMPRA, con su fecha y su proveedor', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const [prov] = await db
      .insert(proveedores)
      .values({ numero3c: 1247, nombre: 'SIMPLE DISTRIBUCIONES SRL' })
      .returning({ id: proveedores.id });
    await insertarPrecio({
      producto3c: '401',
      proveedorId: prov!.id,
      precio: 2644.38,
      vigenteDesde: ymd(-7),
      usuarioId: fx.usuarioId,
    });

    const ficha = await obtenerFichaPrecio('401');
    expect(ficha.titulo).toBe('De dónde sale el precio de Producto 401');
    expect(cual(ficha)).toContain('la última COMPRA');
    expect(cual(ficha)).toContain(ar(ymd(-7)));
    expect(cual(ficha)).toContain('SIMPLE DISTRIBUCIONES SRL');
  });

  it('dice que es el CONTROLADO cuando compras lo marcó, sin mentir sobre el tipo', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    // Una compra reciente y una actualización vieja marcada a mano: manda la marcada.
    await insertarPrecio({ producto3c: '401', precio: 100, tipo: 'COMPRA', vigenteDesde: ymd(-2), usuarioId: fx.usuarioId });
    const act = await insertarPrecio({
      producto3c: '401',
      precio: 500,
      tipo: 'ACTUALIZACION',
      vigenteDesde: ymd(-30),
      usuarioId: fx.usuarioId,
    });
    await marcarControlado(act.id, fx.usuarioId);

    const ficha = await obtenerFichaPrecio('401');
    expect(cual(ficha)).toContain('CONTROLADO');
    expect(cual(ficha)).toContain(ar(ymd(-30)));
    // La marca no cambia la categoría: eso lo aclara el paso de "ojo con esto".
    expect(ficha.pasos.some((p) => p.detalle.includes('NO cambia el tipo'))).toBe(true);
  });

  it('cuenta los precios que perdieron la prelación', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await insertarPrecio({ producto3c: '401', precio: 100, vigenteDesde: ymd(-30), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', precio: 200, vigenteDesde: ymd(-20), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', precio: 300, vigenteDesde: ymd(-10), usuarioId: fx.usuarioId });

    expect(cual(await obtenerFichaPrecio('401'))).toContain('3 precio(s) cargado(s) en total: los otros 2');
  });

  it('un precio futuro todavía no manda: la ficha nombra el que rige hoy', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await insertarPrecio({ producto3c: '401', precio: 100, vigenteDesde: ymd(-3), usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', precio: 999, vigenteDesde: ymd(10), usuarioId: fx.usuarioId });

    expect(cual(await obtenerFichaPrecio('401'))).toContain(ar(ymd(-3)));
  });

  it('sin precio cargado lo dice, y no inventa un conteo', async () => {
    await sembrarEscenario({ productos3c: ['401'] });

    const ficha = await obtenerFichaPrecio('401');
    expect(cual(ficha)).toContain('no tiene precio cargado');
    expect(cual(ficha)).not.toContain('en total');
  });

  it('siempre explica la prelación completa, en orden', async () => {
    await sembrarEscenario({ productos3c: ['401'] });

    const prelacion = (await obtenerFichaPrecio('401')).pasos.find((p) => p.titulo.startsWith('La prelación'));
    expect(prelacion?.items?.map((i) => i.slice(0, 2))).toEqual(['1.', '2.', '3.']);
  });

  it('un producto inexistente da 404', async () => {
    await sembrarEscenario({ productos3c: ['401'] });
    await expect(obtenerFichaPrecio('NO_EXISTE')).rejects.toMatchObject({
      code: 'PRODUCTO_NO_ENCONTRADO',
      statusCode: 404,
    });
  });
});
