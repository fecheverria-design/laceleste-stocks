import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { movimientos, movimientos3c, movimientosDetalle, tiposMovimiento } from '../src/db/schema.js';
import { insertarDetalle, resolverUsuarioIntegracion } from '../src/repositories/movimientos.repository.js';
import { reemplazarPeriodo, tipoDestino } from '../src/db/aplicar-movimientos-3c.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

// Reemplazo del período por los movimientos de 3c (la información definitiva).
//
// Es una operación destructiva: anula lo que registró la app del compañero y carga lo de 3c
// en su lugar. Si se corta a la mitad, el stock queda con lo del compañero anulado y lo de 3c
// sin cargar, o sea mal en las dos puntas. Por eso va todo en una transacción y por eso está
// testeado: la transición de estado y el efecto en stock son la parte que no se puede romper.

let fx: Fixtures;

async function tipoIdDe(codigo: string): Promise<number> {
  const [t] = await db.select({ id: tiposMovimiento.id }).from(tiposMovimiento).where(eq(tiposMovimiento.codigo, codigo));
  if (!t) throw new Error(`Falta el tipo ${codigo} (catálogo)`);
  return t.id;
}

/** Un RINT como los que deja el sync del compañero: confirmado y SIN nro_3c. */
async function rintDelCompanero(fecha: string, renglones: { producto3c: string; cantidadReal: string }[]): Promise<number> {
  const [cab] = await db
    .insert(movimientos)
    .values({
      nro: `RINT-TEST-${fecha}-${Math.random().toString(36).slice(2, 7)}`,
      tipoId: await tipoIdDe('RINT'),
      fecha,
      hora: '00:00:00',
      origenId: fx.deposito.id,
      destinoId: fx.area.id,
      estado: 'CONFIRMADO',
      usuarioId: fx.usuarioId,
      confirmadoEn: sql`now()`,
    })
    .returning({ id: movimientos.id });
  await db.transaction(async (tx) => {
    await insertarDetalle(
      tx,
      cab!.id,
      renglones.map((r) => ({ ...r, unidad: 'KG' })),
    );
  });
  return cab!.id;
}

async function sembrarEspejo(filas: { fecha: string; numero: string; producto3c: string; cantidad: string; renglon?: number }[]): Promise<void> {
  await db.insert(movimientos3c).values(
    filas.map((f) => ({
      fecha: f.fecha,
      numero: f.numero,
      renglon: f.renglon ?? 1,
      tipoDoc: 'Rint',
      origenDep3c: fx.deposito.depId3c,
      destinoDep3c: fx.area.depId3c,
      producto3c: f.producto3c,
      cantidad: f.cantidad,
      unidad: 'KG',
    })),
  );
}

async function stockDe(producto3c: string): Promise<number> {
  const res = await db.execute<{ cantidad: string }>(
    sql`SELECT cantidad FROM stock_actual WHERE producto_3c = ${producto3c} AND ubicacion_id = ${fx.deposito.id}`,
  );
  return Number(res.rows[0]?.cantidad ?? 0);
}

/** Deja stock inicial en el depósito para poder ver el descuento. */
async function cargarStockInicial(producto3c: string, cantidad: string): Promise<void> {
  const [cab] = await db
    .insert(movimientos)
    .values({
      nro: `REC-TEST-${producto3c}`,
      tipoId: await tipoIdDe('RECEPCION'),
      fecha: '2026-08-01',
      hora: '00:00:00',
      origenId: fx.area.id,
      destinoId: fx.deposito.id,
      estado: 'CONFIRMADO',
      usuarioId: fx.usuarioId,
      confirmadoEn: sql`now()`,
    })
    .returning({ id: movimientos.id });
  await db.transaction(async (tx) => {
    await insertarDetalle(tx, cab!.id, [{ producto3c, cantidadReal: cantidad, unidad: 'KG' }]);
  });
  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);
}

beforeEach(async () => {
  await limpiar();
  await db.execute(sql`TRUNCATE movimientos_3c RESTART IDENTITY`);
  fx = await sembrarEscenario({ productos3c: ['460', '461'] });
  await db.execute(sql`INSERT INTO usuarios (nombre, email, pass_hash, rol) VALUES ('Integracion','integracion@laceleste.local','x','ADMIN') ON CONFLICT DO NOTHING`);
});

afterAll(cerrarPool);

describe('tipoDestino', () => {
  it('mapea los tipos de documento de 3c', () => {
    expect(tipoDestino('Rint', 1, 47)).toBe('RINT');
    expect(tipoDestino('ReMe', 102, 1)).toBe('RECEPCION');
    expect(tipoDestino('Fcpr', 102, 1)).toBe('RECEPCION');
  });

  it('cualquier cosa que toque el balde 101 es AJUSTE, aunque 3c la tipee Rint', () => {
    expect(tipoDestino('Rint', 1, 101)).toBe('AJUSTE');
    expect(tipoDestino('Rint', 101, 1)).toBe('AJUSTE');
  });

  it('un tipo desconocido devuelve null en vez de adivinar', () => {
    expect(tipoDestino('NCC', 1, 47)).toBeNull();
    expect(tipoDestino('', 1, 47)).toBeNull();
  });
});

describe('reemplazarPeriodo', () => {
  it('anula lo del compañero y deja el stock igual a lo que dice 3c', async () => {
    await cargarStockInicial('460', '1000');
    // El compañero registró 100; 3c dice que salieron 250.
    const idCompanero = await rintDelCompanero('2026-08-10', [{ producto3c: '460', cantidadReal: '100' }]);
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '250' }]);

    const r = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    expect(r.anulados).toBe(1);
    expect(r.creados).toBe(1);

    const [viejo] = await db.select({ estado: movimientos.estado, anuladoEn: movimientos.anuladoEn }).from(movimientos).where(eq(movimientos.id, idCompanero));
    expect(viejo?.estado).toBe('ANULADO');
    expect(viejo?.anuladoEn).not.toBeNull(); // la anulación deja sellos (regla #7)

    // 1000 − 250 (el número de 3c), NO 1000 − 100 ni 1000 − 350.
    expect(await stockDe('460')).toBeCloseTo(750);
  });

  it('el movimiento creado queda con el nro_3c del documento', async () => {
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000042', producto3c: '460', cantidad: '5' }]);

    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    const [creado] = await db.select({ nro3c: movimientos.nro3c }).from(movimientos).where(sql`${movimientos.nro3c} IS NOT NULL`);
    expect(creado?.nro3c).toBe('X 0001-00000042');
  });

  it('agrupa los renglones del mismo documento en un solo movimiento', async () => {
    await sembrarEspejo([
      { fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '5' },
      { fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '461', cantidad: '7' },
    ]);

    const r = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    expect(r.creados).toBe(1);
    expect(r.renglones).toBe(2);
  });

  it('correrlo dos veces no duplica: el documento ya importado se saltea', async () => {
    await cargarStockInicial('460', '1000');
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '250' }]);

    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });
    const segunda = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    expect(segunda.creados).toBe(0);
    expect(segunda.yaImportados).toBe(1);
    expect(await stockDe('460')).toBeCloseTo(750); // no se descontó dos veces
  });

  it('no toca lo que está fuera del rango', async () => {
    const afuera = await rintDelCompanero('2026-07-20', [{ producto3c: '460', cantidadReal: '10' }]);
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '5' }]);

    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    const [m] = await db.select({ estado: movimientos.estado }).from(movimientos).where(eq(movimientos.id, afuera));
    expect(m?.estado).toBe('CONFIRMADO');
  });

  it('no vuelve a anular lo que ya vino de 3c (tiene nro_3c)', async () => {
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '5' }]);
    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    const segunda = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    expect(segunda.anulados).toBe(0);
  });

  it('saltea el renglón del producto que no está en el maestro, sin tumbar el movimiento', async () => {
    await sembrarEspejo([
      { fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '5' },
      { fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '9999', cantidad: '7' },
    ]);

    const r = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    expect(r.creados).toBe(1);
    expect(r.renglones).toBe(1);
    expect(r.productosSinAlta).toEqual(['9999']);
  });

  it('⚠ la anulación NO queda a nombre del usuario de integración (el sync la reviviría)', async () => {
    const idCompanero = await rintDelCompanero('2026-08-10', [{ producto3c: '460', cantidadReal: '100' }]);
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '250' }]);
    const integracion = await resolverUsuarioIntegracion();

    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    const [m] = await db.select({ anuladoPor: movimientos.anuladoPor }).from(movimientos).where(eq(movimientos.id, idCompanero));
    expect(m?.anuladoPor).not.toBe(integracion);
    expect(m?.anuladoPor).not.toBeNull();
  });

  it('--dry no escribe: no anula ni crea nada', async () => {
    const idCompanero = await rintDelCompanero('2026-08-10', [{ producto3c: '460', cantidadReal: '100' }]);
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '250' }]);

    const r = await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: true });

    expect(r.anulados).toBe(1); // lo REPORTA…
    expect(r.creados).toBe(1);

    const [m] = await db.select({ estado: movimientos.estado }).from(movimientos).where(eq(movimientos.id, idCompanero));
    expect(m?.estado).toBe('CONFIRMADO'); // …pero no lo hizo
    const creados = await db.select({ id: movimientos.id }).from(movimientos).where(sql`${movimientos.nro3c} IS NOT NULL`);
    expect(creados).toHaveLength(0);
  });

  it('el detalle creado lleva la cantidad de 3c como cantidad_real', async () => {
    await sembrarEspejo([{ fecha: '2026-08-10', numero: 'X 0001-00000001', producto3c: '460', cantidad: '250.5' }]);

    await reemplazarPeriodo({ desde: '2026-08-01', hasta: '2026-08-31', dry: false });

    const [det] = await db
      .select({ real: movimientosDetalle.cantidadReal })
      .from(movimientosDetalle)
      .innerJoin(movimientos, eq(movimientos.id, movimientosDetalle.movimientoId))
      .where(and(sql`${movimientos.nro3c} IS NOT NULL`, eq(movimientosDetalle.producto3c, '460')));
    expect(Number(det?.real)).toBeCloseTo(250.5);
  });
});
