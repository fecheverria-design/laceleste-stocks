import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { movimientos, productos, tiposMovimiento } from '../src/db/schema.js';
import { insertarDetalle } from '../src/repositories/movimientos.repository.js';
import { juzgar, seFracciona, tieneSesgoSistematico } from '../src/domain/abastecimiento.js';
import { guardarRevision, borrarRevision } from '../src/repositories/abastecimiento.repository.js';
import {
  armarCasos,
  marcarRecalibrar,
  obtenerAbastecimiento,
  resumir,
  type CasoAbastecimiento,
} from '../src/services/abastecimiento.service.js';
import { cerrarPool, limpiar, sembrarEscenario, type Fixtures } from './helpers/db.js';

// ¿Despachó lo que había que despachar? Lo que se testea es lo que hace que el número sea
// justo: que la razón legítima de cada diferencia dependa de la UNIDAD DE MEDIDA, que los
// productos mal parametrizados no ensucien el indicador, y que la revisión a mano le gane
// siempre al automatismo.

let fx: Fixtures;

const PERIODO = { desde: '2026-08-01', hasta: '2026-08-31' };

async function tipoIdDe(codigo: string): Promise<number> {
  const [t] = await db.select({ id: tiposMovimiento.id }).from(tiposMovimiento).where(eq(tiposMovimiento.codigo, codigo));
  if (!t) throw new Error(`Falta el tipo ${codigo} (catálogo)`);
  return t.id;
}

async function abastecer(
  fecha: string,
  renglones: { producto3c: string; cantidadSugerida: string; cantidadReal: string }[],
): Promise<void> {
  const [cab] = await db
    .insert(movimientos)
    .values({
      nro: `RINT-TEST-${Math.random().toString(36).slice(2, 9)}`,
      tipoId: await tipoIdDe('RINT'),
      fecha,
      hora: '08:00:00',
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
}

beforeEach(async () => {
  await limpiar();
  fx = await sembrarEscenario({ areaDep3c: 47, productos3c: [] });
  // 460 = se pesa y viene en pieza de 8 (el salame de J). 461 = unidad entera, bulto de 2000.
  await db.insert(productos).values([
    { codigo3c: '460', nombre: 'SALAME', unidadBase: 'KG', unidadesPorBulto: '8' },
    { codigo3c: '461', nombre: 'BOLSA DE SANDWICH', unidadBase: 'UN', unidadesPorBulto: '2000' },
  ]);
});

afterAll(cerrarPool);

describe('juzgar', () => {
  it('el ejemplo de J: pedía 15 kg de salame, la horma es de 8, le mandó 2 → está bien', () => {
    expect(juzgar(15, 16, 8, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'HORMA' });
    expect(juzgar(15, 8, 8, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'HORMA' });
  });

  it('una horma entera por encima de lo que el pedido justifica sí es despachar de más', () => {
    expect(juzgar(15, 24, 8, 'KG')).toMatchObject({ resultado: 'DE_MAS', motivo: null });
  });

  it('lo que se pesa tiene tolerancia porcentual: no se puede cortar exacto', () => {
    // 251 kg pedidos, 232 despachados = −7,6%: no es un mal abastecimiento.
    expect(juzgar(251, 232, 1, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'RELATIVA' });
    expect(juzgar(251, 200, 1, 'KG')).toMatchObject({ resultado: 'DE_MENOS' });
  });

  it('lo que viene entero NO tiene tolerancia porcentual', () => {
    // El agujero que evita: un 10% de 3.600 bolsas serían 360 bolsas perdonadas.
    expect(juzgar(3600, 3300, 1, 'UN')).toMatchObject({ resultado: 'DE_MENOS', motivo: null });
    // Y con la misma cantidad, si se pesara, entraría en la tolerancia.
    expect(juzgar(3600, 3300, 1, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'RELATIVA' });
  });

  it('una unidad de diferencia nunca es un error, aunque en % sea enorme', () => {
    expect(juzgar(6, 5, 1, 'UN')).toMatchObject({ resultado: 'CUMPLE', motivo: 'ABSOLUTA' });
  });

  it('sin bulto cargado se exige el pedido redondeado a unidades enteras', () => {
    expect(juzgar(10, 10, null, 'UN')).toMatchObject({ resultado: 'CUMPLE', motivo: 'EXACTO' });
    expect(juzgar(10, 14, null, 'UN')).toMatchObject({ resultado: 'DE_MAS' });
  });

  it('devuelve el rango que se considera correcto, para poder explicar el caso', () => {
    expect(juzgar(15, 16, 8, 'KG')).toMatchObject({ piso: 8, techo: 16 });
  });

  it('sabe qué unidades se fraccionan', () => {
    expect(seFracciona('KG')).toBe(true);
    expect(seFracciona('L')).toBe(true);
    expect(seFracciona('UN')).toBe(false);
    expect(seFracciona(null)).toBe(false);
  });
});

describe('tieneSesgoSistematico', () => {
  it('el producto que falla casi todos los días para el mismo lado es parametrización', () => {
    // BOLSA DE SANDWICH: 46 días, 45 marcados, todos de menos.
    expect(tieneSesgoSistematico({ dias: 46, marcados: 45, deMas: 0, deMenos: 45 })).toBe(true);
  });

  it('un día para cada lado NO es sesgo: eso es despacho', () => {
    expect(tieneSesgoSistematico({ dias: 20, marcados: 18, deMas: 9, deMenos: 9 })).toBe(false);
  });

  it('con pocos días no alcanza para hablar de "siempre"', () => {
    expect(tieneSesgoSistematico({ dias: 3, marcados: 3, deMas: 3, deMenos: 0 })).toBe(false);
  });

  it('fallar de vez en cuando tampoco es sesgo', () => {
    expect(tieneSesgoSistematico({ dias: 20, marcados: 5, deMas: 5, deMenos: 0 })).toBe(false);
  });
});

describe('marcarRecalibrar y resumir', () => {
  const fila = (fecha: string, pedido: string, despacho: string, producto = '461') => ({
    fecha,
    area_dep_3c: 47,
    area_nombre: 'Panadería',
    producto_3c: producto,
    producto_nombre: producto === '461' ? 'BOLSA DE SANDWICH' : 'SALAME',
    unidad_base: producto === '461' ? 'UN' : 'KG',
    presentacion_compra: null,
    unidades_por_bulto: producto === '461' ? '2000' : '8',
    pedido,
    despacho,
    renglones: 1,
    veredicto: null,
    nota: null,
    revisado_por: null,
    revisado_en: null,
  });

  it('el producto que falla siempre sale del indicador y va a la lista de recalibrar', () => {
    // 6 días pidiendo 3.600 y despachando 500: ratio 0,14 clavado.
    const casos = armarCasos(
      ['01', '02', '03', '04', '05', '06'].map((d) => fila(`2026-08-${d}`, '3600', '500')),
    );
    const recalibrar = marcarRecalibrar(casos);

    expect(recalibrar).toHaveLength(1);
    expect(recalibrar[0]).toMatchObject({ producto_3c: '461', sesgo: 'DE_MENOS', dias: 6, marcados: 6 });
    expect(recalibrar[0]?.ratio_medio).toBeCloseTo(0.14, 2);
    expect(casos.every((c) => c.recalibrar)).toBe(true);

    // Y no ensucian el porcentaje: quedan contados aparte.
    const { total } = resumir(casos);
    expect(total.casos).toBe(0);
    expect(total.casos_recalibrar).toBe(6);
    expect(total.bien_pct).toBeNull();
  });

  it('un producto que falla salteado se queda en el indicador', () => {
    const casos = armarCasos([
      fila('2026-08-01', '3600', '3600'),
      fila('2026-08-02', '3600', '3600'),
      fila('2026-08-03', '3600', '500'),
      fila('2026-08-04', '3600', '3600'),
      fila('2026-08-05', '3600', '3600'),
      fila('2026-08-06', '3600', '3600'),
    ]);
    expect(marcarRecalibrar(casos)).toHaveLength(0);

    const { total } = resumir(casos);
    expect(total.casos).toBe(6);
    expect(total.bien).toBe(5);
    expect(total.bien_pct).toBe(83.3);
  });

  it('separa los que están pendientes de revisar de los ya revisados', () => {
    const casos = armarCasos([fila('2026-08-01', '100', '100'), fila('2026-08-02', '100', '40')]);
    marcarRecalibrar(casos);
    const { total } = resumir(casos);

    expect(total.pendientes_de_revisar).toBe(1);
    expect(total.revisados).toBe(0);
  });
});

describe('la revisión manual le gana a la regla', () => {
  const caso = (veredicto: 'BIEN' | 'MAL' | null, pedido: string, despacho: string): CasoAbastecimiento[] =>
    armarCasos([
      {
        fecha: '2026-08-01',
        area_dep_3c: 47,
        area_nombre: 'Panadería',
        producto_3c: '461',
        producto_nombre: 'BOLSA DE SANDWICH',
        unidad_base: 'UN',
        presentacion_compra: null,
        unidades_por_bulto: '2000',
        pedido,
        despacho,
        renglones: 1,
        veredicto,
        nota: veredicto === null ? null : 'lo miré con la encargada',
        revisado_por: veredicto === null ? null : 'Fausto',
        revisado_en: veredicto === null ? null : '09/09/2026 10:00',
      },
    ]);

  it('marcar BIEN rescata un caso que la regla había marcado', () => {
    const [sinRevisar] = caso(null, '3600', '500');
    const [revisado] = caso('BIEN', '3600', '500');

    expect(sinRevisar?.bien).toBe(false);
    expect(revisado?.bien).toBe(true);
    // La regla sigue diciendo lo suyo: la revisión no borra el dato, lo pisa.
    expect(revisado?.resultado).toBe('DE_MENOS');
    expect(resumir(revisado ? [revisado] : []).total.bien_pct).toBe(100);
  });

  it('marcar MAL hunde un caso que la regla había dado por bueno', () => {
    const [revisado] = caso('MAL', '4000', '4000');
    expect(revisado?.resultado).toBe('CUMPLE');
    expect(revisado?.bien).toBe(false);
  });

  it('un caso revisado no arrastra a su producto a la lista de recalibrar', () => {
    // Si alguien ya lo miró, la conclusión es suya y no se le achaca a la parametrización.
    const casos = armarCasos(
      ['01', '02', '03', '04', '05', '06'].map((d) => ({
        fecha: `2026-08-${d}`,
        area_dep_3c: 47,
        area_nombre: 'Panadería',
        producto_3c: '461',
        producto_nombre: 'BOLSA DE SANDWICH',
        unidad_base: 'UN',
        presentacion_compra: null,
        unidades_por_bulto: '2000',
        pedido: '3600',
        despacho: '500',
        renglones: 1,
        veredicto: 'BIEN',
        nota: null,
        revisado_por: 'Fausto',
        revisado_en: '09/09/2026 10:00',
      })),
    );
    expect(marcarRecalibrar(casos)).toHaveLength(0);
  });
});

describe('obtenerAbastecimiento (contra la base)', () => {
  it('mide día por día: pedido y despacho salen del mismo documento', async () => {
    await abastecer('2026-08-05', [{ producto3c: '460', cantidadSugerida: '15', cantidadReal: '16' }]);
    await abastecer('2026-08-06', [{ producto3c: '460', cantidadSugerida: '15', cantidadReal: '40' }]);

    const r = await obtenerAbastecimiento(PERIODO);

    expect(r.casos).toHaveLength(2);
    expect(r.total.casos).toBe(2);
    expect(r.total.bien).toBe(1);
    expect(r.total.de_mas).toBe(1);
    expect(r.total.bien_pct).toBe(50);
  });

  it('deja afuera los renglones sin pedido: un extra no es un despacho de más', async () => {
    await abastecer('2026-08-07', [{ producto3c: '460', cantidadSugerida: '0', cantidadReal: '250' }]);

    const r = await obtenerAbastecimiento(PERIODO);

    expect(r.casos).toHaveLength(0);
  });

  it('el check manual queda guardado y vuelve con el caso', async () => {
    await abastecer('2026-08-08', [{ producto3c: '460', cantidadSugerida: '15', cantidadReal: '40' }]);
    await guardarRevision({
      fecha: '2026-08-08',
      areaDep3c: 47,
      producto3c: '460',
      veredicto: 'BIEN',
      nota: 'se llevó de más a pedido del área',
      usuarioId: fx.usuarioId,
    });

    const r = await obtenerAbastecimiento(PERIODO);

    expect(r.casos[0]?.revision).toMatchObject({ veredicto: 'BIEN', nota: 'se llevó de más a pedido del área' });
    expect(r.casos[0]?.revision?.por).toBe('Tester');
    expect(r.casos[0]?.bien).toBe(true);
    expect(r.total.bien_pct).toBe(100);
  });

  it('revisar de nuevo pisa la revisión anterior, no acumula', async () => {
    await abastecer('2026-08-09', [{ producto3c: '460', cantidadSugerida: '15', cantidadReal: '40' }]);
    const rev = { fecha: '2026-08-09', areaDep3c: 47, producto3c: '460', usuarioId: fx.usuarioId, nota: null };
    await guardarRevision({ ...rev, veredicto: 'BIEN' });
    await guardarRevision({ ...rev, veredicto: 'MAL' });

    const r = await obtenerAbastecimiento(PERIODO);

    expect(r.casos).toHaveLength(1);
    expect(r.casos[0]?.revision?.veredicto).toBe('MAL');
    expect(r.casos[0]?.bien).toBe(false);
  });

  it('sacar la revisión devuelve el caso a lo que dice la regla', async () => {
    await abastecer('2026-08-10', [{ producto3c: '460', cantidadSugerida: '15', cantidadReal: '16' }]);
    const rev = { fecha: '2026-08-10', areaDep3c: 47, producto3c: '460' };
    await guardarRevision({ ...rev, areaDep3c: 47, producto3c: '460', veredicto: 'MAL', nota: null, usuarioId: fx.usuarioId });
    await borrarRevision({ ...rev, areaDep3c: 47, producto3c: '460' });

    const r = await obtenerAbastecimiento(PERIODO);

    expect(r.casos[0]?.revision).toBeNull();
    expect(r.casos[0]?.bien).toBe(true); // la horma lo salva
  });

  it('solo mide las áreas que usan la app', async () => {
    const r = await obtenerAbastecimiento({ ...PERIODO, areas: [43] }); // Locales, que no usa la app
    expect(r.casos).toHaveLength(0);
  });
});

describe('el pedido más chico que el bulto (el agujero que cazó un test)', () => {
  it('un bulto grande no justifica despachar cualquier cosa', () => {
    // Pedido 100 bolsas, el bulto trae 2.000. Mandar 40 no lo justifica el bulto: se abre y
    // se cuentan 100. Antes el rango [0, 2000] se tragaba cualquier despacho.
    expect(juzgar(100, 40, 2000, 'UN')).toMatchObject({ resultado: 'DE_MENOS', motivo: null });
  });

  it('pero mandar el bulto cerrado sí es una razón legítima', () => {
    expect(juzgar(100, 2000, 2000, 'UN')).toMatchObject({ resultado: 'CUMPLE', motivo: 'HORMA' });
  });

  it('con el pedido por encima de una pieza, el rango del medio sigue valiendo', () => {
    expect(juzgar(15, 12, 8, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'HORMA' });
  });

  it('la caja cerrada vale aunque no pese lo nominal (caso real: la galleta)', () => {
    // Pedido 1,464 kg, la caja pesa 4,268 nominales y en la balanza dio 4,24: es la misma caja.
    expect(juzgar(1.464, 4.24, 4.268, 'KG')).toMatchObject({ resultado: 'CUMPLE', motivo: 'HORMA' });
    // Pero en unidades enteras no hay margen: 1.999 bolsas no son un bulto de 2.000.
    expect(juzgar(100, 1999, 2000, 'UN')).toMatchObject({ resultado: 'DE_MAS' });
  });
});
