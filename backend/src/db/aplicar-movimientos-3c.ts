import { pathToFileURL } from 'node:url';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { movimientos, movimientos3c, productos, tiposMovimiento, ubicaciones } from './schema.js';
import { generarNro, insertarDetalle, resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// REEMPLAZA los movimientos de un período por los de 3c, que es la información definitiva
// (decisión de J, 2026-09-08). El sync de la app del compañero da el día en vivo mientras
// transcurre la semana —sirve para operar— pero ve solo una parte de lo que sale del
// depósito; la importación semanal de 3c lo reemplaza por la verdad.
//
// Qué hace, en orden y todo dentro de una transacción:
//   1. ANULA los movimientos del rango que vinieron del compañero (`nro_3c IS NULL`).
//      No se borran: quedan ANULADOS con sus sellos, así que su `cantidad_sugerida` sigue
//      disponible para el análisis de lo pedido contra lo despachado.
//   2. CREA los movimientos desde el espejo `movimientos_3c` (ver import-movimientos-3c.ts),
//      con su `nro_3c`, agrupados por (numero, origen, destino) igual que import:movimientos.
//   3. Refresca `stock_actual`.
//
// Idempotente: un documento de 3c ya importado (mismo tipo + nro_3c + dirección) se saltea,
// así que se puede correr dos veces sin duplicar.
//
// POR QUÉ REEMPLAZAR Y NO SUMAR LA DIFERENCIA: entre lo que registra el compañero y lo que
// registra 3c hay corrimiento de fechas (el egreso de la tarde que se carga al día
// siguiente). Medido el 08/09 sobre agosto: cruzando por fecha exacta aparecían 213 casos de
// "la app tiene de más"; cruzando por período, 9. Sumar diferencias obliga a inventarle fecha
// a cada complemento y vuelve a meter ese ruido. Reemplazar deja la app exactamente igual a
// 3c, con sus fechas y sus números de documento.
//
// Uso:
//   npm run movimientos3c:aplicar -- --desde=2026-08-05 --hasta=2026-09-07 [--dry] [--usuario=mail]
//
// ⚠ NO incluir el día en curso: 3c todavía no lo tiene cargado y se anularía lo del
// compañero sin nada que lo reemplace.

// Balde de AJUSTES de 3c: cualquier movimiento que lo toque (origen o destino) es un AJUSTE,
// aunque 3c lo tipee como 'Rint'. Misma regla que import-movimientos.ts (decisión de J).
const DEP_AJUSTES = 101;

// Tipos de documento de 3c → códigos de tipos_movimiento.
const TIPO_MAP: Record<string, string> = {
  RINT: 'RINT',
  REME: 'RECEPCION',
  FCPR: 'RECEPCION',
  RINV: 'AJUSTE',
};

interface Args {
  desde: string;
  hasta: string;
  dry: boolean;
  tipos: string[];
  usuario?: string;
}

function parseArgs(argv: string[]): Args {
  let desde: string | undefined;
  let hasta: string | undefined;
  let dry = false;
  let tipos = ['Rint'];
  let usuario: string | undefined;
  for (const a of argv) {
    if (a === '--dry') dry = true;
    else if (a.startsWith('--usuario=')) usuario = a.slice('--usuario='.length).trim();
    else if (a.startsWith('--desde=')) desde = a.slice('--desde='.length);
    else if (a.startsWith('--hasta=')) hasta = a.slice('--hasta='.length);
    else if (a.startsWith('--tipos=')) tipos = a.slice('--tipos='.length).split(',').map((t) => t.trim()).filter(Boolean);
  }
  const RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!desde || !hasta || !RE.test(desde) || !RE.test(hasta)) {
    throw new Error('Pasá el rango: --desde=YYYY-MM-DD --hasta=YYYY-MM-DD (los dos, y válidos).');
  }
  if (desde > hasta) throw new Error(`El rango está invertido: ${desde} > ${hasta}.`);
  const hoy = new Date().toISOString().slice(0, 10);
  if (hasta >= hoy) {
    throw new Error(
      `--hasta=${hasta} incluye hoy (${hoy}). 3c todavía no tiene el día en curso: se anularía lo del ` +
        'compañero sin nada que lo reemplace. Usá --hasta=ayer.',
    );
  }
  return { desde, hasta, dry, tipos, usuario };
}

/** Código de tipos_movimiento para un renglón del espejo, con la regla del balde 101. */
export function tipoDestino(tipoDoc: string, origen: number | null, destino: number | null): string | null {
  if (origen === DEP_AJUSTES || destino === DEP_AJUSTES) return 'AJUSTE';
  return TIPO_MAP[tipoDoc.trim().toUpperCase()] ?? null;
}

/**
 * Quién queda como autor de la anulación. NUNCA el usuario de integración: el sync revive
 * sus propias bajas y desharía el reemplazo (ver el comentario en reemplazarPeriodo).
 * Toma el ADMIN que se le pase por email, o el primer ADMIN humano que haya.
 */
export async function resolverAnuladorHumano(usuarioIntegracionId: number, email?: string): Promise<number> {
  const { usuarios } = await import('./schema.js');
  const filas = await db
    .select({ id: usuarios.id, email: usuarios.email, rol: usuarios.rol })
    .from(usuarios)
    .where(eq(usuarios.rol, 'ADMIN'));
  const humanos = filas.filter((u) => u.id !== usuarioIntegracionId);
  if (email !== undefined) {
    const elegido = humanos.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (elegido === undefined) {
      throw new Error(`No hay un ADMIN humano con el email ${email} (los que hay: ${humanos.map((u) => u.email).join(', ') || 'ninguno'}).`);
    }
    return elegido.id;
  }
  const primero = humanos[0];
  if (primero === undefined) {
    throw new Error(
      'No hay ningún usuario ADMIN humano para atribuirle la anulación. Anular con el usuario de ' +
        'integración haría que el sync reviva los movimientos y deshaga el reemplazo.',
    );
  }
  return primero.id;
}

interface Grupo {
  numero: string;
  fecha: string;
  tipo: string;
  origen: number;
  destino: number;
  renglones: { producto3c: string; cantidadReal: string; unidad: string }[];
}

export interface ResultadoReemplazo {
  anulados: number;
  creados: number;
  renglones: number;
  yaImportados: number;
  productosSinAlta: string[];
  depositosSinUbicacion: number[];
}

/**
 * Reemplaza los movimientos del rango por los de 3c. Exportada para poder testear la
 * transición de estado y el efecto en stock, que es la parte que no se puede romper.
 */
export async function reemplazarPeriodo(opts: {
  desde: string;
  hasta: string;
  dry: boolean;
  tipos?: string[];
  /** Email del ADMIN a quien se le atribuye la anulación. Por defecto, el primer ADMIN humano. */
  usuario?: string;
}): Promise<ResultadoReemplazo> {
  const { desde, hasta, dry } = opts;
  const tipos = opts.tipos ?? ['Rint'];
  console.log(`▶ Reemplazar movimientos por los de 3c ${dry ? '(DRY-RUN) ' : ''}· ${desde} → ${hasta} · tipos: ${tipos.join(', ')}`);

  // ── 1) Lo que hay que anular: lo del compañero (sin nro_3c) en el rango.
  const codigosAfectados = [...new Set(Object.values(TIPO_MAP).concat('AJUSTE'))].filter((c) =>
    tipos.some((t) => tipoDestino(t, null, null) === c),
  );
  if (codigosAfectados.length === 0) throw new Error(`Ningún tipo de 3c conocido en --tipos=${tipos.join(',')}.`);

  const tiposRows = await db.select({ id: tiposMovimiento.id, codigo: tiposMovimiento.codigo }).from(tiposMovimiento);
  const tipoId = new Map(tiposRows.map((t) => [t.codigo, t.id]));
  const idsAfectados = codigosAfectados.map((c) => tipoId.get(c)).filter((i): i is number => i !== undefined);

  const aAnular = await db
    .select({ id: movimientos.id, nro: movimientos.nro })
    .from(movimientos)
    .where(
      and(
        inArray(movimientos.tipoId, idsAfectados),
        eq(movimientos.estado, 'CONFIRMADO'),
        isNull(movimientos.nro3c),
        gte(movimientos.fecha, desde),
        lte(movimientos.fecha, hasta),
      ),
    );

  // ── 2) Lo que hay que crear: el espejo del rango, agrupado por (numero, origen, destino).
  const espejo = await db
    .select()
    .from(movimientos3c)
    .where(and(gte(movimientos3c.fecha, desde), lte(movimientos3c.fecha, hasta), inArray(movimientos3c.tipoDoc, tipos)));

  const ubicRows = await db.select({ id: ubicaciones.id, depId3c: ubicaciones.depId3c }).from(ubicaciones);
  const ubicId = new Map(ubicRows.map((u) => [u.depId3c, u.id]));
  const conocidos = new Set((await db.select({ c: productos.codigo3c }).from(productos)).map((p) => p.c));

  const grupos = new Map<string, Grupo>();
  const faltanProducto = new Set<string>();
  const faltanUbicacion = new Set<number>();
  let sinTipo = 0;

  for (const r of espejo) {
    const codigo = tipoDestino(r.tipoDoc, r.origenDep3c, r.destinoDep3c);
    if (codigo === null || tipoId.get(codigo) === undefined) {
      sinTipo++;
      continue;
    }
    if (r.origenDep3c === null || r.destinoDep3c === null) {
      sinTipo++;
      continue;
    }
    if (!ubicId.has(r.origenDep3c)) faltanUbicacion.add(r.origenDep3c);
    if (!ubicId.has(r.destinoDep3c)) faltanUbicacion.add(r.destinoDep3c);
    // Un producto que no está en el maestro saltea SU renglón, nunca el movimiento entero
    // (misma regla que sync-maestro.ts: un artículo nuevo no puede tumbar el día).
    if (!conocidos.has(r.producto3c)) {
      faltanProducto.add(r.producto3c);
      continue;
    }
    const clave = `${codigo}|${r.numero}|${r.origenDep3c}->${r.destinoDep3c}`;
    let g = grupos.get(clave);
    if (g === undefined) {
      g = { numero: r.numero, fecha: r.fecha, tipo: codigo, origen: r.origenDep3c, destino: r.destinoDep3c, renglones: [] };
      grupos.set(clave, g);
    }
    g.renglones.push({ producto3c: r.producto3c, cantidadReal: String(r.cantidad), unidad: r.unidad ?? 'UN' });
  }

  // Idempotencia: un documento de 3c ya importado no se vuelve a crear.
  const yaImportados = new Set(
    (
      await db.execute<{ clave: string }>(
        sql`SELECT t.codigo || '|' || m.nro_3c || '|' || o.dep_id_3c || '->' || d.dep_id_3c AS clave
            FROM movimientos m
            JOIN tipos_movimiento t ON t.id = m.tipo_id
            JOIN ubicaciones o ON o.id = m.origen_id
            JOIN ubicaciones d ON d.id = m.destino_id
            WHERE m.nro_3c IS NOT NULL AND m.estado = 'CONFIRMADO'`,
      )
    ).rows.map((r) => r.clave),
  );

  const aCrear = [...grupos.entries()].filter(([clave]) => !yaImportados.has(clave)).map(([, g]) => g);
  const salteados = grupos.size - aCrear.length;
  const renglonesACrear = aCrear.reduce((a, g) => a + g.renglones.length, 0);

  console.log(`  A ANULAR (vinieron del compañero): ${aAnular.length} movimiento(s)`);
  console.log(`  A CREAR desde 3c: ${aCrear.length} movimiento(s) · ${renglonesACrear} renglón(es)` + (salteados ? ` · ${salteados} ya estaban importados` : ''));
  if (faltanUbicacion.size > 0) console.log(`  ⚠ Depósitos de 3c sin ubicación en la app (esos movimientos se descartan): ${[...faltanUbicacion].join(', ')}`);
  if (faltanProducto.size > 0) console.log(`  ⚠ Productos sin alta en el maestro (se saltea el renglón, no el movimiento): ${[...faltanProducto].join(', ')}`);
  if (sinTipo > 0) console.log(`  ⚠ ${sinTipo} renglón(es) del espejo sin tipo/dirección utilizable.`);

  if (dry) {
    console.log('\n— DRY RUN: no se escribió nada. Muestra de lo que se crearía (5):');
    for (const g of aCrear.slice(0, 5)) {
      console.log(`    ${g.fecha} ${g.numero} · ${g.tipo} · dep ${g.origen}→${g.destino} · ${g.renglones.length} renglón(es)`);
    }
    console.log('\n  Para aplicarlo: el mismo comando SIN --dry.');
    return {
      anulados: aAnular.length,
      creados: aCrear.length,
      renglones: renglonesACrear,
      yaImportados: salteados,
      productosSinAlta: [...faltanProducto],
      depositosSinUbicacion: [...faltanUbicacion],
    };
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('Falta el usuario de integración (corré db:seed).');

  // ⚠ La anulación NO puede ir a nombre del usuario de integración. El sync del compañero
  // distingue "baja propia" (anulado_por = ese usuario) de anulación humana: la propia la
  // REVIVE en la siguiente corrida (services/movimientos.service.ts). Si anuláramos con él,
  // el sync desharía el reemplazo dentro de la hora y el stock quedaría descontado dos veces.
  // Importar 3c es además una decisión humana, así que atribuirla a una persona es lo
  // correcto también semánticamente (regla #4: la anulación humana manda y no se revive).
  const anuladorId = await resolverAnuladorHumano(usuarioId, opts.usuario);

  // ── 3) Todo junto: o queda el período reemplazado entero, o no se toca nada. Un corte a
  // la mitad dejaría el stock con lo del compañero anulado y lo de 3c sin cargar.
  await db.transaction(async (tx) => {
    if (aAnular.length > 0) {
      await tx
        .update(movimientos)
        .set({ estado: 'ANULADO', anuladoEn: sql`now()`, anuladoPor: anuladorId })
        .where(inArray(movimientos.id, aAnular.map((m) => m.id)));
    }
    for (const g of aCrear) {
      const oId = ubicId.get(g.origen);
      const dId = ubicId.get(g.destino);
      const tId = tipoId.get(g.tipo);
      if (oId === undefined || dId === undefined || tId === undefined) continue;
      const nro = await generarNro(tx, g.tipo, Number(g.fecha.slice(0, 4)));
      const [cab] = await tx
        .insert(movimientos)
        .values({
          nro,
          tipoId: tId,
          fecha: g.fecha,
          hora: '00:00:00',
          origenId: oId,
          destinoId: dId,
          estado: 'CONFIRMADO',
          usuarioId,
          nro3c: g.numero,
          observaciones: `Importado de 3c (reemplaza el registro del compañero del ${desde} al ${hasta})`,
          confirmadoEn: sql`now()`,
        })
        .returning({ id: movimientos.id });
      await insertarDetalle(tx, cab!.id, g.renglones);
    }
  });

  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY stock_actual`);
  console.log(`\n✔ Período reemplazado. Anulados: ${aAnular.length} · creados desde 3c: ${aCrear.length} (${renglonesACrear} renglones). Stock recalculado.`);
  return {
    anulados: aAnular.length,
    creados: aCrear.length,
    renglones: renglonesACrear,
    yaImportados: salteados,
    productosSinAlta: [...faltanProducto],
    depositosSinUbicacion: [...faltanUbicacion],
  };
}

// Solo corre como CLI. Cuando un test importa reemplazarPeriodo(), este bloque NO se ejecuta.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reemplazarPeriodo(parseArgs(process.argv.slice(2)))
    .catch((e: unknown) => {
      console.error('✗ Reemplazo abortado:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
