import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { movimientos, movimientos3c, tiposMovimiento, ubicaciones } from '../src/db/schema.js';
import { insertarDetalle } from '../src/repositories/movimientos.repository.js';
import {
  armarItems,
  avisoDeVentana,
  clasificar,
  obtenerDesempeno,
  resumir,
  type ItemDesempeno,
} from '../src/services/desempeno.service.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

// Desempeño del depósito: lo que la app del compañero registró contra lo que el encargado
// cargó en 3c. Lo que se testea acá es lo que hace que el número signifique algo:
//   · que se cruce por PERÍODO y no por día (el egreso de la tarde cargado al día siguiente),
//   · que no se compare 3c contra sí mismo (los movimientos con nro_3c),
//   · que los RINT que el reemplazo dejó ANULADOS sigan contando como "la app lo registró",
//   · y la tolerancia de bulto, que es regla de J: si la diferencia entra en un bulto, está bien.

let fx: Fixtures;

async function tipoIdDe(codigo: string): Promise<number> {
  const [t] = await db.select({ id: tiposMovimiento.id }).from(tiposMovimiento).where(eq(tiposMovimiento.codigo, codigo));
  if (!t) throw new Error(`Falta el tipo ${codigo} (catálogo)`);
  return t.id;
}

/** Un RINT de la app. Por defecto como los que deja el sync del compañero: sin nro_3c. */
async function rintApp(
  fecha: string,
  renglones: { producto3c: string; cantidadReal: string }[],
  opts: { nro3c?: string; estado?: string; destinoId?: number } = {},
): Promise<void> {
  const [cab] = await db
    .insert(movimientos)
    .values({
      nro: `RINT-TEST-${Math.random().toString(36).slice(2, 9)}`,
      tipoId: await tipoIdDe('RINT'),
      fecha,
      hora: '08:00:00',
      origenId: fx.deposito.id,
      destinoId: opts.destinoId ?? fx.area.id,
      estado: opts.estado ?? 'CONFIRMADO',
      usuarioId: fx.usuarioId,
      nro3c: opts.nro3c ?? null,
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
}

async function espejo3c(
  filas: { fecha: string; producto3c: string; cantidad: string; destinoDep3c?: number }[],
): Promise<void> {
  await db.insert(movimientos3c).values(
    filas.map((f, i) => ({
      fecha: f.fecha,
      numero: `X 0001-${String(i).padStart(8, '0')}`,
      renglon: 1,
      tipoDoc: 'Rint',
      origenDep3c: fx.deposito.depId3c,
      destinoDep3c: f.destinoDep3c ?? fx.area.depId3c,
      producto3c: f.producto3c,
      cantidad: f.cantidad,
      unidad: 'KG',
    })),
  );
}

const PERIODO = { desde: '2026-08-01', hasta: '2026-08-31', hoy: '2026-09-09', ayer: '2026-09-08' };

beforeEach(async () => {
  await limpiar();
  await db.execute(sql`TRUNCATE movimientos_3c RESTART IDENTITY`);
  fx = await sembrarEscenario({ productos3c: ['460', '461'] });
});

afterAll(cerrarPool);

describe('clasificar', () => {
  it('exacto cuando las dos puntas dicen lo mismo', () => {
    expect(clasificar(100, 100, null)).toBe('EXACTO');
  });

  it('la diferencia que entra en un bulto cuenta como bien abastecido (regla de J)', () => {
    // 1.140 vs 1.152 con maple de 36: es el redondeo al bulto entero, no un error de carga.
    expect(clasificar(1140, 1152, 36)).toBe('DENTRO_BULTO');
    expect(clasificar(1140, 1200, 36)).toBe('DIFIERE'); // más de un bulto
  });

  it('sin bulto (o bulto suelto) no hay tolerancia: cualquier diferencia difiere', () => {
    expect(clasificar(100, 101, null)).toBe('DIFIERE');
    expect(clasificar(100, 101, 1)).toBe('DIFIERE');
  });

  it('distingue lo que solo está en una punta', () => {
    expect(clasificar(0, 50, null)).toBe('SOLO_3C');
    expect(clasificar(50, 0, null)).toBe('SOLO_APP');
  });

  it('ignora el ruido de redondeo del numeric', () => {
    expect(clasificar(100, 100.0005, null)).toBe('EXACTO');
  });
});

describe('resumir', () => {
  const item = (clasificacion: ItemDesempeno['clasificacion'], area = 47): ItemDesempeno => ({
    area_dep_3c: area,
    area_nombre: `Área ${area}`,
    producto_3c: '460',
    producto_nombre: 'Harina',
    unidad_base: 'KG',
    unidades_por_bulto: null,
    cantidad_app: 0,
    cantidad_3c: 0,
    diferencia: 0,
    diferencia_bultos: null,
    renglones_app: 0,
    renglones_3c: 0,
    clasificacion,
  });

  it('cobertura = de lo que 3c registró, lo que la app también tiene', () => {
    // 3 en 3c (1 exacta + 1 difiere + 1 solo en 3c) → 2 de 3 registradas.
    const { total } = resumir([item('EXACTO'), item('DIFIERE'), item('SOLO_3C')]);
    expect(total.en_3c).toBe(3);
    expect(total.registradas).toBe(2);
    expect(total.cobertura_pct).toBe(66.7);
  });

  it('fidelidad se calcula solo sobre lo que pasó por las dos puntas', () => {
    const { total } = resumir([item('EXACTO'), item('DENTRO_BULTO'), item('DIFIERE'), item('SOLO_3C')]);
    // 2 de 3 comunes coinciden; el SOLO_3C no entra al denominador (no es un error de cantidad).
    expect(total.fidelidad_pct).toBe(66.7);
  });

  it('lo que solo está en la app no ensucia la cobertura', () => {
    const { total } = resumir([item('EXACTO'), item('SOLO_APP')]);
    expect(total.en_3c).toBe(1);
    expect(total.cobertura_pct).toBe(100);
    expect(total.solo_app).toBe(1);
  });

  it('sin datos de 3c no inventa un porcentaje', () => {
    const { total } = resumir([item('SOLO_APP')]);
    expect(total.cobertura_pct).toBeNull();
    expect(total.fidelidad_pct).toBeNull();
  });

  it('ordena las áreas por lo que falta registrar', () => {
    const { areas } = resumir([item('EXACTO', 47), item('SOLO_3C', 43), item('SOLO_3C', 43)]);
    expect(areas.map((a) => a.area_dep_3c)).toEqual([43, 47]);
  });
});

describe('armarItems', () => {
  it('nombra los depósitos y productos sin alta en vez de esconderlos', () => {
    const [item] = armarItems([
      {
        area_dep_3c: 225,
        area_nombre: null,
        producto_3c: '9999',
        producto_nombre: null,
        unidad_base: null,
        unidades_por_bulto: null,
        cantidad_app: '0',
        cantidad_3c: '5',
        renglones_app: 0,
        renglones_3c: 1,
      },
    ]);
    expect(item?.area_nombre).toContain('225');
    expect(item?.producto_nombre).toContain('sin alta');
    expect(item?.clasificacion).toBe('SOLO_3C');
  });

  it('mide la diferencia también en bultos', () => {
    const [item] = armarItems([
      {
        area_dep_3c: 47,
        area_nombre: 'Panadería',
        producto_3c: '460',
        producto_nombre: 'Huevo',
        unidad_base: 'UN',
        unidades_por_bulto: '36',
        cantidad_app: '1140',
        cantidad_3c: '1032',
        renglones_app: 1,
        renglones_3c: 1,
      },
    ]);
    expect(item?.diferencia).toBe(108);
    expect(item?.diferencia_bultos).toBe(3);
  });
});

describe('avisoDeVentana', () => {
  const espejo = { desde: '2026-08-01', hasta: '2026-09-08' };

  it('calla cuando el período entra en lo que cubre el export', () => {
    expect(avisoDeVentana('2026-08-05', '2026-08-31', espejo, '2026-09-09')).toBeNull();
  });

  it('avisa cuando el período se pasa del export (lo que falta puede ser el export)', () => {
    expect(avisoDeVentana('2026-07-01', '2026-08-31', espejo, '2026-09-09')).toContain('2026-08-01');
    expect(avisoDeVentana('2026-08-01', '2026-09-30', espejo, '2026-09-09')).toContain('2026-09-08');
  });

  it('avisa cuando el período incluye el día en curso', () => {
    expect(avisoDeVentana('2026-08-01', '2026-09-09', espejo, '2026-09-09')).toContain('día en curso');
  });

  it('sin export importado lo dice en vez de dar 0%', () => {
    expect(avisoDeVentana('2026-08-01', '2026-08-31', null, '2026-09-09')).toContain('No hay movimientos de 3c');
  });
});

describe('obtenerDesempeno (contra la base)', () => {
  it('cruza por PERÍODO, no por día: el egreso cargado al día siguiente no es un error', async () => {
    await rintApp('2026-08-05', [{ producto3c: '460', cantidadReal: '100' }]);
    await espejo3c([{ fecha: '2026-08-06', producto3c: '460', cantidad: '100' }]);

    const r = await obtenerDesempeno(PERIODO);

    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.clasificacion).toBe('EXACTO');
    expect(r.total.cobertura_pct).toBe(100);
    expect(r.total.fidelidad_pct).toBe(100);
  });

  it('suma los despachos del período de las dos puntas antes de comparar', async () => {
    await rintApp('2026-08-05', [{ producto3c: '460', cantidadReal: '60' }]);
    await rintApp('2026-08-07', [{ producto3c: '460', cantidadReal: '40' }]);
    await espejo3c([
      { fecha: '2026-08-06', producto3c: '460', cantidad: '70' },
      { fecha: '2026-08-08', producto3c: '460', cantidad: '30' },
    ]);

    const r = await obtenerDesempeno(PERIODO);

    expect(r.items[0]?.cantidad_app).toBe(100);
    expect(r.items[0]?.cantidad_3c).toBe(100);
    expect(r.items[0]?.clasificacion).toBe('EXACTO');
  });

  it('NO compara 3c contra sí mismo: los movimientos con nro_3c quedan afuera', async () => {
    // Un RINT importado de 3c (tiene nro_3c) más su fila en el espejo. Si el cruce lo tomara
    // como "lado app", la cobertura daría 100% siempre y el indicador no mediría nada.
    await rintApp('2026-08-10', [{ producto3c: '460', cantidadReal: '100' }], { nro3c: 'X 0001-00009999' });
    await espejo3c([{ fecha: '2026-08-10', producto3c: '460', cantidad: '100' }]);

    const r = await obtenerDesempeno(PERIODO);

    expect(r.items[0]?.clasificacion).toBe('SOLO_3C');
    expect(r.total.cobertura_pct).toBe(0);
  });

  it('cuenta los RINT que el reemplazo dejó ANULADOS: son la constancia de lo que la app registró', async () => {
    await rintApp('2026-08-12', [{ producto3c: '460', cantidadReal: '80' }], { estado: 'ANULADO' });
    await espejo3c([{ fecha: '2026-08-12', producto3c: '460', cantidad: '80' }]);

    const r = await obtenerDesempeno(PERIODO);

    expect(r.items[0]?.clasificacion).toBe('EXACTO');
  });

  it('deja afuera el balde de ajustes (101): lo que lo toca no es abastecimiento', async () => {
    const [balde] = await db
      .insert(ubicaciones)
      .values({ nombre: 'AJUSTES', tipo: 'DEPOSITO', depId3c: 101, llevaStock: false })
      .returning({ id: ubicaciones.id });
    await rintApp('2026-08-12', [{ producto3c: '460', cantidadReal: '80' }], { destinoId: balde!.id });
    await espejo3c([{ fecha: '2026-08-12', producto3c: '460', cantidad: '80', destinoDep3c: 101 }]);

    const r = await obtenerDesempeno(PERIODO);

    expect(r.items).toHaveLength(0);
  });

  it('sin fechas usa la ventana del export de 3c y corta antes del día en curso', async () => {
    await espejo3c([
      { fecha: '2026-08-03', producto3c: '460', cantidad: '10' },
      { fecha: '2026-09-08', producto3c: '461', cantidad: '10' },
    ]);

    const r = await obtenerDesempeno({ hoy: '2026-09-09', ayer: '2026-09-08' });

    expect(r.desde).toBe('2026-08-03');
    expect(r.hasta).toBe('2026-09-08');
    expect(r.espejo?.renglones).toBe(2);
    expect(r.aviso).toBeNull();
  });

  it('el aviso aparece cuando se pide más allá de lo importado', async () => {
    await espejo3c([{ fecha: '2026-08-03', producto3c: '460', cantidad: '10' }]);

    const r = await obtenerDesempeno({ desde: '2026-07-01', hasta: '2026-08-31', hoy: '2026-09-09', ayer: '2026-09-08' });

    expect(r.aviso).toContain('2026-08-03');
  });
});
