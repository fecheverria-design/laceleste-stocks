import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { proveedores } from '../src/db/schema.js';
import { planDesdeFoto, persistirPrecios, planificarPrecios } from '../src/db/precios-3c.js';
import type { FilaPrecio } from '../src/db/import-precios.js';
import { insertarPrecio } from '../src/repositories/precios.repository.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// La fuente `precios` de sync:3c corre sola todos los días contra la foto de 3c. Lo que tiene
// que garantizar: que sea idempotente (correrla dos veces no cambia nada), que todo entre como
// ACTUALIZACION (solo el tilde es COMPRA) y que NUNCA le cambie el importe a un precio que
// compras marcó como controlado.

const HOY = '2026-10-06';

const fila = (over: Partial<FilaPrecio> = {}): FilaPrecio => ({
  producto3c: '401',
  nombre: 'QUESO',
  proveedorNum: 100,
  proveedorNombre: 'FUENTES',
  precio: 1000,
  tipo: 'ACTUALIZACION',
  vigenteDesde: '2026-10-06',
  ...over,
});

// Lo que devuelve el proxy: encabezado + filas, como la query de queryPrecios().
const foto = (...filas: Array<[string, string, string, string]>): string[][] => [
  ['ID', 'DENOMINACION', 'PRECIO', 'PERSONAS_ID', 'PROVEEDORES', 'FECHA', 'TIPO'],
  ...filas.map(([id, precio, prov, fecha]) => [id, `PRODUCTO ${id}`, precio, prov, 'FUENTES', fecha, 'ACTUALIZACION']),
];

const filasDe = async (producto3c: string): Promise<Array<{ precio: string; tipo: string; fecha: string }>> => {
  const res = await db.execute<{ precio: string; tipo: string; fecha: string }>(
    sql`SELECT precio, tipo, vigente_desde::text AS fecha FROM precios WHERE producto_3c = ${producto3c} ORDER BY vigente_desde, tipo`,
  );
  return res.rows;
};

describe('planificarPrecios (pura)', () => {
  const prods = new Set(['401', '402']);
  const provs = new Map([[100, 1]]);

  it('separa nuevas, cambios e iguales comparando a 4 decimales', () => {
    const existentes = new Map([
      ['401|1|2026-10-06', { precio: '1000.0000', controlada: false }],
      ['402|1|2026-10-06', { precio: '500.0000', controlada: false }],
    ]);
    const plan = planificarPrecios(
      [fila(), fila({ producto3c: '402', precio: 550 }), fila({ vigenteDesde: '2026-10-07' })],
      prods,
      provs,
      existentes,
      HOY,
    );
    expect({ nuevas: plan.nuevas, cambian: plan.cambian, iguales: plan.iguales }).toEqual({ nuevas: 1, cambian: 1, iguales: 1 });
    expect(plan.aEscribir.map((f) => `${f.producto3c} ${f.vigenteDesde} ${f.precio}`)).toEqual([
      '402 2026-10-06 550',
      '401 2026-10-07 1000',
    ]);
  });

  it('no toca una fila controlada aunque 3c traiga otro importe', () => {
    const existentes = new Map([['401|1|2026-10-06', { precio: '900.0000', controlada: true }]]);
    const plan = planificarPrecios([fila()], prods, provs, existentes, HOY);
    expect(plan.controladas).toBe(1);
    expect(plan.aEscribir).toEqual([]);
  });

  it('una fecha vieja con otro importe es historial: no se pisa (puede ser lo que se pagó)', () => {
    const existentes = new Map([
      ['401|1|2026-03-11', { precio: '9558.9000', controlada: false }],
      ['402|1|2026-09-29', { precio: '500.0000', controlada: false }],
    ]);
    const plan = planificarPrecios(
      [fila({ vigenteDesde: '2026-03-11', precio: 19941.52 }), fila({ producto3c: '402', vigenteDesde: '2026-09-29', precio: 510 })],
      prods,
      provs,
      existentes,
      HOY,
    );
    // El 29/09 está justo dentro de los 7 días: ese sí se corrige.
    expect({ difieren: plan.difierenHistorial, cambian: plan.cambian }).toEqual({ difieren: 1, cambian: 1 });
    expect(plan.aEscribir.map((f) => f.producto3c)).toEqual(['402']);
  });

  it('saltea y avisa productos y proveedores sin alta (no los inventa)', () => {
    const plan = planificarPrecios([fila({ producto3c: '999' }), fila({ proveedorNum: 7 })], prods, provs, new Map(), HOY);
    expect([...plan.sinProducto]).toEqual(['999']);
    expect([...plan.sinProveedor]).toEqual([7]);
    expect(plan.aEscribir).toEqual([]);
  });
});

describe('sync de precios contra la DB', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('entra como ACTUALIZACION, salta los precios en 0 y la segunda corrida no cambia nada', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' });
    const csv = foto(['401', '1000.5', '100', '06/10/2026'], ['402', '0', '100', '01/02/2025']);

    const plan = await planDesdeFoto(csv, HOY);
    expect({ nuevas: plan.nuevas, saltadas: plan.saltadas }).toEqual({ nuevas: 1, saltadas: 1 });
    expect(await persistirPrecios(plan, fx.usuarioId)).toBe(1);
    expect(await filasDe('401')).toEqual([{ precio: '1000.5000', tipo: 'ACTUALIZACION', fecha: '2026-10-06' }]);
    expect(await filasDe('402')).toEqual([]);

    const segunda = await planDesdeFoto(csv, HOY);
    expect({ nuevas: segunda.nuevas, cambian: segunda.cambian, iguales: segunda.iguales }).toEqual({ nuevas: 0, cambian: 0, iguales: 1 });
    expect(await persistirPrecios(segunda, fx.usuarioId)).toBe(0);
  });

  it('cada fecha nueva suma una fila: la serie se arma sola', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' });
    await persistirPrecios(await planDesdeFoto(foto(['401', '1000', '100', '06/10/2026']), HOY), fx.usuarioId);
    await persistirPrecios(await planDesdeFoto(foto(['401', '1100', '100', '08/10/2026']), HOY), fx.usuarioId);

    expect(await filasDe('401')).toEqual([
      { precio: '1000.0000', tipo: 'ACTUALIZACION', fecha: '2026-10-06' },
      { precio: '1100.0000', tipo: 'ACTUALIZACION', fecha: '2026-10-08' },
    ]);
  });

  it('no toca la COMPRA del mismo día ni el importe de una fila controlada', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    const [prov] = await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' }).returning({ id: proveedores.id });
    await insertarPrecio({ producto3c: '401', proveedorId: prov!.id, precio: 980, tipo: 'COMPRA', vigenteDesde: '2026-10-06', usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '402', proveedorId: prov!.id, precio: 700, tipo: 'ACTUALIZACION', vigenteDesde: '2026-10-06', usuarioId: fx.usuarioId });
    await db.execute(sql`UPDATE precios SET controlado_en = now(), controlado_por = ${fx.usuarioId} WHERE producto_3c = '402'`);

    const plan = await planDesdeFoto(foto(['401', '1200', '100', '06/10/2026'], ['402', '750', '100', '06/10/2026']), HOY);
    expect(plan.controladas).toBe(1);
    await persistirPrecios(plan, fx.usuarioId);

    // La compra queda intacta; la lista del mismo día entra al lado, como fila aparte.
    expect(await filasDe('401')).toEqual([
      { precio: '1200.0000', tipo: 'ACTUALIZACION', fecha: '2026-10-06' },
      { precio: '980.0000', tipo: 'COMPRA', fecha: '2026-10-06' },
    ]);
    expect(await filasDe('402')).toEqual([{ precio: '700.0000', tipo: 'ACTUALIZACION', fecha: '2026-10-06' }]);
  });

  it('el setWhere protege una fila que se marcó como controlada después de armar el plan', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' });
    await persistirPrecios(await planDesdeFoto(foto(['401', '1000', '100', '06/10/2026']), HOY), fx.usuarioId);

    const plan = await planDesdeFoto(foto(['401', '1300', '100', '06/10/2026']), HOY);
    expect(plan.cambian).toBe(1);
    // Compras la marca justo entre el plan y la escritura.
    await db.execute(sql`UPDATE precios SET controlado_en = now(), controlado_por = ${fx.usuarioId} WHERE producto_3c = '401'`);
    expect(await persistirPrecios(plan, fx.usuarioId)).toBe(0);

    expect(await filasDe('401')).toEqual([{ precio: '1000.0000', tipo: 'ACTUALIZACION', fecha: '2026-10-06' }]);
  });
});
