import { readFileSync } from 'node:fs';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { movimientos, productos, tiposMovimiento, ubicaciones } from './schema.js';
import { indexarColumnas, parseDelimited } from './csv.js';
import { generarNro, insertarDetalle, resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Carga el INVENTARIO INICIAL: la "foto" del stock físico contado, por depósito.
// El historial de 3c no arranca de stock cero, así que el neto da corrido; este
// import deja el stock parado EXACTO en lo contado, generando por producto/depósito
// un AJUSTE = (contado − sistema) contra el balde de AJUSTES (dep 101, no lleva stock).
//
// Columnas: DEPOSITO (= dep_id_3c; 1 = FABRICA, el resto = depósitos de proveedores
// con acopio), 3C (= codigo_3c del producto), STOCK (cantidad contada), y opcionales
// FECHA (dd/mm/yyyy), DENOMINACION, AÑO, MES.
//
// Activa lleva_stock en TODOS los depósitos del archivo (additivo: no apaga otros).
// Auto-crea productos/ubicaciones faltantes. Por depósito arma a lo sumo 2
// movimientos: una "entrada" (101→D, deltas +) y una "salida" (D→101, deltas −).
//
// Uso: npm run import:inventario -- <archivo.csv|tsv> [--dry] [--exclusivo]
//   --dry: solo muestra el plan (no escribe nada).
//   --exclusivo: el conteo es AUTORITATIVO por depósito → todo producto con stock en un
//                depósito del archivo que NO esté listado se pone en 0. Sin el flag, solo
//                se ajustan los productos listados (los demás conservan su saldo histórico).

// Baldes virtuales del modelo de 3c — nunca llevan stock, son contrapartida.
const DEP_AJUSTES = 101;
const BALDES_VIRTUALES = new Set([101, 102]);

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. Permite negativos (faltante contado).
function parseStock(s: string): number {
  let t = s.trim();
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

function redondear3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface FilaInv {
  depId3c: number;
  producto3c: string;
  contado: number;
  denom: string;
  unidad: string;
}

// Modo --exclusivo: por cada depósito del archivo, todo producto que HOY tiene stock
// ahí pero no figura en el conteo se agrega como contado=0 (→ se ajusta a 0). Así el
// acopio queda exactamente como lo contado, sin arrastres del histórico de 3c.
function extrasExclusivo(
  items: FilaInv[],
  stockActual: Map<string, number>,
  ubicId: Map<number, number>,
  depsArchivo: number[],
): FilaInv[] {
  const listado = new Set(items.map((r) => `${r.depId3c}:${r.producto3c}`));
  const extras: FilaInv[] = [];
  for (const dep of depsArchivo) {
    const uid = ubicId.get(dep);
    if (uid === undefined) continue;
    for (const [key, cant] of stockActual) {
      const sep = key.indexOf(':');
      if (Number(key.slice(0, sep)) !== uid) continue;
      const prod = key.slice(sep + 1);
      if (cant === 0 || listado.has(`${dep}:${prod}`)) continue;
      extras.push({ depId3c: dep, producto3c: prod, contado: 0, denom: '', unidad: 'UN' });
    }
  }
  return extras;
}

async function main(archivo: string, dry: boolean, exclusivo: boolean): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const col = indexarColumnas(filas[0]!, ['DEPOSITO', '3C', 'STOCK']);
  // DENOMINACION/FECHA/UNIMED son opcionales: los busco sin exigirlos.
  const norm = filas[0]!.map((h) => h.trim().toUpperCase());
  const opt = (name: string): number => norm.indexOf(name);
  const iDenom = opt('DENOMINACION');
  const iFecha = opt('FECHA');
  const iUni = opt('UNIMED');

  // 1) Parsear filas, dedup por (depósito, producto) — gana la última.
  const porClave = new Map<string, FilaInv>();
  let descartadas = 0;
  let baldesEnArchivo = 0;
  let fechaArchivo: string | null = null;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const depId3c = Number((f[col.DEPOSITO!] ?? '').trim());
    const producto3c = (f[col['3C']!] ?? '').trim().slice(0, 32);
    const contado = parseStock(f[col.STOCK!] ?? '');
    if (!Number.isInteger(depId3c) || depId3c <= 0 || !producto3c || Number.isNaN(contado)) {
      descartadas++;
      continue;
    }
    if (BALDES_VIRTUALES.has(depId3c)) {
      baldesEnArchivo++;
      continue; // los baldes (101/102) no llevan stock: nunca cargan inventario
    }
    if (fechaArchivo === null && iFecha >= 0) fechaArchivo = parseFecha(f[iFecha] ?? '');
    porClave.set(`${depId3c}:${producto3c}`, {
      depId3c,
      producto3c,
      contado,
      denom: iDenom >= 0 ? (f[iDenom] ?? '').trim() : '',
      unidad: iUni >= 0 ? (f[iUni] ?? '').trim().slice(0, 16) || 'UN' : 'UN',
    });
  }
  const items = [...porClave.values()];
  if (items.length === 0) throw new Error('No quedó ninguna fila válida para cargar.');

  const fecha = fechaArchivo ?? new Date().toISOString().slice(0, 10);
  const anio = Number(fecha.slice(0, 4));
  const depsArchivo = [...new Set(items.map((r) => r.depId3c))].sort((a, b) => a - b);

  // 2) Auto-crear productos faltantes (desde 3C + DENOMINACION).
  const prodMap = new Map<string, FilaInv>();
  for (const r of items) if (!prodMap.has(r.producto3c)) prodMap.set(r.producto3c, r);
  const existentes = new Set(
    (await db.select({ c: productos.codigo3c }).from(productos)).map((p) => p.c),
  );
  const prodFaltantes = [...prodMap.values()]
    .filter((r) => !existentes.has(r.producto3c))
    .map((r) => ({ codigo3c: r.producto3c, nombre: (r.denom || `Art ${r.producto3c}`).slice(0, 200), unidadBase: r.unidad }));

  // 3) Resolver/crear ubicaciones de cada depósito + asegurar balde AJUSTES.
  const ubicRows = await db.select({ id: ubicaciones.id, depId3c: ubicaciones.depId3c }).from(ubicaciones);
  const ubicId = new Map(ubicRows.map((u) => [u.depId3c, u.id]));
  const depsFaltantes = depsArchivo.filter((d) => !ubicId.has(d));
  const balde101Existe = ubicId.has(DEP_AJUSTES);

  if (dry) {
    // En --dry no escribo: el sistema de los deps aún-sin-stock se asume 0 (es lo que
    // daría tras activar lleva_stock en un depósito sin movimientos previos).
    const stockActual = await leerStock([...ubicId.values()]);
    const extras = exclusivo ? extrasExclusivo(items, stockActual, ubicId, depsArchivo) : [];
    const itemsEval = [...items, ...extras];
    let entradas = 0;
    let salidas = 0;
    let sinCambio = 0;
    for (const r of itemsEval) {
      const uid = ubicId.get(r.depId3c);
      const sistema = uid !== undefined ? (stockActual.get(`${uid}:${r.producto3c}`) ?? 0) : 0;
      const delta = redondear3(r.contado - sistema);
      if (Math.abs(delta) < 0.0005) sinCambio++;
      else if (delta > 0) entradas++;
      else salidas++;
    }
    console.log('── PLAN (--dry, no se escribió nada) ──────────────────────────');
    console.log(`Archivo: ${archivo}`);
    console.log(`Fecha del inventario: ${fecha}`);
    console.log(`Depósitos en el archivo (${depsArchivo.length}): ${depsArchivo.join(', ')}`);
    console.log(`  · ya existen como ubicación: ${depsArchivo.length - depsFaltantes.length}`);
    console.log(`  · se crearían (DEPOSITO): ${depsFaltantes.length}${depsFaltantes.length ? ' → ' + depsFaltantes.join(', ') : ''}`);
    console.log(`Productos contados: ${items.length} (faltan crear ${prodFaltantes.length})`);
    if (exclusivo) console.log(`Modo --exclusivo: ${extras.length} producto(s) no listados se pondrían en 0.`);
    console.log(`Renglones de ajuste: +${entradas} entradas / −${salidas} salidas / ${sinCambio} ya en su valor`);
    console.log(`Balde AJUSTES (dep ${DEP_AJUSTES}) existe: ${balde101Existe ? 'sí' : 'no (se crearía)'}`);
    if (baldesEnArchivo) console.log(`⚠ ${baldesEnArchivo} fila(s) de baldes virtuales (101/102) ignoradas.`);
    if (descartadas) console.log(`⚠ ${descartadas} fila(s) descartadas (sin depósito/producto/stock válido).`);
    console.log('Para aplicarlo: corré el mismo comando SIN --dry.');
    await pool.end();
    return;
  }

  // 4) Escribir productos y ubicaciones faltantes.
  for (let i = 0; i < prodFaltantes.length; i += 500) {
    await db.insert(productos).values(prodFaltantes.slice(i, i + 500)).onConflictDoNothing({ target: productos.codigo3c });
  }
  if (!balde101Existe) {
    await db.insert(ubicaciones).values({ nombre: 'AJUSTES', tipo: 'DEPOSITO', depId3c: DEP_AJUSTES, llevaStock: false }).onConflictDoNothing({ target: ubicaciones.depId3c });
  }
  for (const d of depsFaltantes) {
    await db.insert(ubicaciones).values({ nombre: `Dep ${d}`, tipo: 'DEPOSITO', depId3c: d, llevaStock: true }).onConflictDoNothing({ target: ubicaciones.depId3c });
  }

  // 5) Activar lleva_stock en los depósitos del archivo (additivo) y refrescar para
  //    leer el sistema real de cada depósito antes de ajustar.
  await db.update(ubicaciones).set({ llevaStock: true }).where(inArray(ubicaciones.depId3c, depsArchivo));
  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);

  // 6) Remapear ubicaciones (ya creadas) y leer stock del sistema.
  const ubicRows2 = await db.select({ id: ubicaciones.id, depId3c: ubicaciones.depId3c }).from(ubicaciones);
  const ubicId2 = new Map(ubicRows2.map((u) => [u.depId3c, u.id]));
  const aIdAjustes = ubicId2.get(DEP_AJUSTES)!;
  const stockActual = await leerStock([...ubicId2.values()]);
  // En --exclusivo, sumar los no-listados (contado=0) para que el conteo sea autoritativo.
  const itemsEval = exclusivo ? [...items, ...extrasExclusivo(items, stockActual, ubicId2, depsArchivo)] : items;

  // 7) Por depósito, separar entradas (delta+) y salidas (delta−).
  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('Falta el usuario de integración (corré db:seed).');

  let movsCreados = 0;
  let renglonesEntrada = 0;
  let renglonesSalida = 0;
  let sinCambio = 0;
  for (const dep of depsArchivo) {
    const uid = ubicId2.get(dep)!;
    const entradas: { producto3c: string; cantidadReal: string; unidad: string }[] = [];
    const salidas: { producto3c: string; cantidadReal: string; unidad: string }[] = [];
    for (const r of itemsEval.filter((x) => x.depId3c === dep)) {
      const sistema = stockActual.get(`${uid}:${r.producto3c}`) ?? 0;
      const delta = redondear3(r.contado - sistema);
      if (Math.abs(delta) < 0.0005) {
        sinCambio++;
      } else if (delta > 0) {
        entradas.push({ producto3c: r.producto3c, cantidadReal: String(delta), unidad: r.unidad });
      } else {
        salidas.push({ producto3c: r.producto3c, cantidadReal: String(-delta), unidad: r.unidad });
      }
    }
    if (entradas.length > 0) {
      await crearAjuste(usuarioId, fecha, anio, aIdAjustes, uid, entradas, `Inventario inicial ${fecha} (entrada dep ${dep})`);
      movsCreados++;
      renglonesEntrada += entradas.length;
    }
    if (salidas.length > 0) {
      await crearAjuste(usuarioId, fecha, anio, uid, aIdAjustes, salidas, `Inventario inicial ${fecha} (salida dep ${dep})`);
      movsCreados++;
      renglonesSalida += salidas.length;
    }
  }

  // 8) Refrescar stock final.
  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);

  console.log(`✔ Inventario inicial cargado (fecha ${fecha}).`);
  console.log(`  Depósitos con stock activado: ${depsArchivo.length} (${depsArchivo.join(', ')}).`);
  console.log(`  Productos creados: ${prodFaltantes.length}. Ubicaciones creadas: ${depsFaltantes.length}${!balde101Existe ? ' (+ balde AJUSTES)' : ''}.`);
  console.log(`  Movimientos de ajuste: ${movsCreados} (+${renglonesEntrada} renglones entrada / −${renglonesSalida} salida / ${sinCambio} ya estaban en su valor).`);
  if (descartadas) console.log(`  ⚠ ${descartadas} fila(s) descartadas (sin depósito/producto/stock válido).`);
  if (baldesEnArchivo) console.log(`  ⚠ ${baldesEnArchivo} fila(s) de baldes virtuales (101/102) ignoradas.`);
  await pool.end();
}

// Lee el stock del sistema para las ubicaciones dadas → mapa "ubicId:producto" → cantidad.
async function leerStock(ubicIds: number[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (ubicIds.length === 0) return m;
  const res = await db.execute<{ ubicacion_id: number; producto_3c: string; cantidad: string }>(
    sql`SELECT ubicacion_id, producto_3c, cantidad FROM stock_actual WHERE ubicacion_id IN (${sql.join(ubicIds.map((id) => sql`${id}`), sql`, `)})`,
  );
  for (const row of res.rows) m.set(`${row.ubicacion_id}:${row.producto_3c}`, Number(row.cantidad));
  return m;
}

// Un AJUSTE confirmado (cabecera + detalle) en su tx: correlativo propio + sellos.
async function crearAjuste(
  usuarioId: number,
  fecha: string,
  anio: number,
  origenId: number,
  destinoId: number,
  renglones: { producto3c: string; cantidadReal: string; unidad: string }[],
  observaciones: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const nro = await generarNro(tx, 'AJUSTE', anio);
    const [cab] = await tx
      .insert(movimientos)
      .values({
        nro, tipoId: await tipoAjusteId(), fecha, hora: '00:00:00', origenId, destinoId,
        estado: 'CONFIRMADO', usuarioId, observaciones, confirmadoEn: sql`now()`,
      })
      .returning({ id: movimientos.id });
    await insertarDetalle(tx, cab!.id, renglones);
  });
}

// Cachea el id del tipo AJUSTE (no cambia durante la corrida).
let _ajusteId: number | undefined;
async function tipoAjusteId(): Promise<number> {
  if (_ajusteId !== undefined) return _ajusteId;
  const [row] = await db.select({ id: tiposMovimiento.id }).from(tiposMovimiento).where(eq(tiposMovimiento.codigo, 'AJUSTE')).limit(1);
  if (!row) throw new Error('No existe el tipo de movimiento AJUSTE (corré db:seed).');
  _ajusteId = row.id;
  return _ajusteId;
}

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const exclusivo = argv.includes('--exclusivo');
const archivo = argv.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: npm run import:inventario -- <archivo.csv|tsv> [--dry] [--exclusivo]');
  process.exit(1);
}

main(archivo, dry, exclusivo).catch((err: unknown) => {
  console.error('❌ Error importando inventario:', err);
  process.exit(1);
});
