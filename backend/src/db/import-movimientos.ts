import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, pool } from './client.js';
import { movimientos, productos, tiposMovimiento, ubicaciones } from './schema.js';
import { parseDelimited } from './csv.js';
import {
  generarNro,
  insertarDetalle,
  resolverUsuarioIntegracion,
} from '../repositories/movimientos.repository.js';

// Importa movimientos históricos de 3c. Una fila = un renglón; se agrupan por NUMERO
// (= nro de 3c). Columnas: FECHA, NUMERO, TIPO_DOC, ORIGEN, ORIGEN_DENOMINACION,
// DESTINO, DESTINO_DENOMINACION, ARTICU_ID, TEXTO, UNIMED, CANTIDAD.
// - Auto-crea ubicaciones y productos faltantes (desde las denominaciones / TEXTO).
// - Entra CONFIRMADO con su fecha; nro propio vía generar_nro; nro_3c = NUMERO.
// - Idempotente: saltea movimientos cuyo NUMERO ya esté importado.
// Uso: npm run import:movimientos -- <archivo.csv|tsv> [--dry]
//
// --dry: NO escribe nada (ni movimientos, ni las ubicaciones/productos que auto-crearía) y
// reporta qué haría. El flag puede ir antes o después del archivo.

// Normaliza para mapear el TIPO_DOC de 3c sin depender de mayúsculas ni tildes.
function normalizarTipo(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Textos de 3c -> codigo de tipos_movimiento. Se agregan aliases por las dudas.
const TIPO_MAP: Record<string, string> = {
  RINT: 'RINT',
  'RECEPCION DE MERCADERIA': 'RECEPCION',
  RECEPCION: 'RECEPCION',
  REME: 'RECEPCION', // codigo corto de 3c para Recepción de Mercadería
  FCPR: 'RECEPCION', // factura de compra: ingresa mercadería → suma al destino
  'AJUSTE DE INVENTARIO': 'AJUSTE',
  AJUSTE: 'AJUSTE',
  RINV: 'AJUSTE', // ajuste de inventario (entra como registro; el efecto en stock por
  //                 dirección fabrica<->ajustes (id 101) se implementa en la fase de stock)
  // Pendiente a propósito: NCC (módulo de facturas futuro).
};

// Balde de AJUSTES de 3c: cualquier movimiento que lo toque (origen o destino) es un
// AJUSTE, aunque venga tipeado como 'Rint' (así los registra 3c). Decisión de J.
const DEP_AJUSTES = 101;

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. Si hay coma, saco los puntos.
function parseCantidad(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

interface Renglon {
  producto_3c: string;
  cantidad: number;
  unidad: string;
  texto: string;
}
interface MovGrupo {
  numero: string;
  fecha: string;
  tipo: string;
  origen: number;
  origenDenom: string;
  destino: number;
  destinoDenom: string;
  renglones: Renglon[];
}

async function main(archivo: string, dry: boolean): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos.');

  // Resuelve cada columna probando varios nombres posibles (3c cambia entre exports:
  // "ID ORIGEN" vs "ORIGEN", "ID ARTICULO" vs "ARTICU_ID", etc.).
  const h = filas[0]!;
  const norm = h.map((x) => x.trim().toUpperCase());
  const idx = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    throw new Error(`Falta la columna (${aliases.join(' / ')}). Encabezados: ${h.join(' | ')}`);
  };
  const col = {
    FECHA: idx(['FECHA']),
    NUMERO: idx(['NUMERO']),
    TIPO_DOC: idx(['TIPO_DOC']),
    ORIGEN: idx(['ID ORIGEN', 'ORIGEN']),
    ORIGEN_DENOMINACION: idx(['ORIGEN_DENOMINACION']),
    DESTINO: idx(['ID DESTINO', 'DESTINO']),
    DESTINO_DENOMINACION: idx(['DESTINO_DENOMINACION']),
    ARTICU_ID: idx(['ID ARTICULO', 'ARTICU_ID']),
    TEXTO: idx(['TEXTO']),
    UNIMED: idx(['UNIMED']),
    CANTIDAD: idx(['CANTIDAD']),
  };
  const c = (f: string[], k: keyof typeof col) => (f[col[k]] ?? '').trim();

  // 1) Agrupar renglones por (TIPO_DOC + NUMERO + dirección efectiva), validando.
  //    - El NUMERO de 3c es único POR TIPO de documento, no global (un Rint y un ReMe
  //      pueden compartir número → son distintos). Agrupar solo por NUMERO los fusionaba.
  //    - Una CANTIDAD negativa = devolución: se invierte la dirección y se vuelve positiva.
  //    - Un mismo NUMERO puede traer renglones en direcciones distintas (ej. ajustes que
  //      suman unos productos y restan otros): se separan por dirección efectiva.
  //    - Si la dirección toca el balde 101 (AJUSTES), el tipo es AJUSTE aunque sea Rint.
  const grupos = new Map<string, MovGrupo>();
  const tiposDesconocidos = new Set<string>();
  let descartados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const numero = c(f, 'NUMERO');
    const tipoDoc = c(f, 'TIPO_DOC');
    const tipoDocNorm = normalizarTipo(tipoDoc);
    const fecha = parseFecha(c(f, 'FECHA'));
    const tipoMapeado = TIPO_MAP[tipoDocNorm];
    let origen = Number(c(f, 'ORIGEN'));
    let destino = Number(c(f, 'DESTINO'));
    let origenDenom = c(f, 'ORIGEN_DENOMINACION');
    let destinoDenom = c(f, 'DESTINO_DENOMINACION');
    const producto_3c = c(f, 'ARTICU_ID').slice(0, 32);
    let cantidad = parseCantidad(c(f, 'CANTIDAD'));

    if (!tipoMapeado) tiposDesconocidos.add(tipoDoc);
    if (!numero || !fecha || !tipoMapeado || !Number.isInteger(origen) || !Number.isInteger(destino) || !producto_3c || !Number.isFinite(cantidad)) {
      descartados++;
      continue;
    }
    // Devolución (cantidad < 0): invierto dirección y la dejo positiva.
    if (cantidad < 0) {
      [origen, destino] = [destino, origen];
      [origenDenom, destinoDenom] = [destinoDenom, origenDenom];
      cantidad = -cantidad;
    }
    // Ajuste: si toca el balde 101 (AJUSTES) es AJUSTE, aunque el documento sea Rint.
    const tipo = origen === DEP_AJUSTES || destino === DEP_AJUSTES ? 'AJUSTE' : tipoMapeado;
    // Clave: tipo de documento + número + dirección efectiva.
    const clave = `${tipoDocNorm}|${numero}|${origen}->${destino}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { numero, fecha, tipo, origen, origenDenom, destino, destinoDenom, renglones: [] };
      grupos.set(clave, g);
    }
    g.renglones.push({ producto_3c, cantidad, unidad: c(f, 'UNIMED').slice(0, 16) || 'UN', texto: c(f, 'TEXTO') });
  }

  // 2) Auto-crear ubicaciones faltantes (tipo: DEPOSITO si aparece como origen, si no AREA).
  const ubics = new Map<number, { nombre: string; esOrigen: boolean }>();
  for (const g of grupos.values()) {
    const o = ubics.get(g.origen);
    ubics.set(g.origen, { nombre: g.origenDenom || o?.nombre || `Dep ${g.origen}`, esOrigen: true });
    if (!ubics.has(g.destino)) ubics.set(g.destino, { nombre: g.destinoDenom || `Dep ${g.destino}`, esOrigen: false });
  }
  // En --dry no se crea nada: se cuenta cuántas FALTAN (las que se crearían).
  let ubicsCreadas = 0;
  if (dry) {
    const existentes = new Set(
      (await db.select({ depId3c: ubicaciones.depId3c }).from(ubicaciones)).map((u) => u.depId3c),
    );
    ubicsCreadas = [...ubics.keys()].filter((d) => !existentes.has(d)).length;
  } else {
    for (const [depId3c, u] of ubics) {
      const res = await db
        .insert(ubicaciones)
        .values({ nombre: u.nombre.slice(0, 100), tipo: u.esOrigen ? 'DEPOSITO' : 'AREA', depId3c })
        .onConflictDoNothing({ target: ubicaciones.depId3c })
        .returning({ id: ubicaciones.id });
      if (res.length > 0) ubicsCreadas++;
    }
  }

  // 3) Auto-crear productos faltantes (desde ARTICU_ID + TEXTO + UNIMED).
  const prods = new Map<string, { nombre: string; unidad: string }>();
  for (const g of grupos.values()) {
    for (const r of g.renglones) {
      if (!prods.has(r.producto_3c)) prods.set(r.producto_3c, { nombre: r.texto || `Art ${r.producto_3c}`, unidad: r.unidad });
    }
  }
  let prodsCreados = 0;
  const prodList = [...prods.entries()].map(([codigo3c, p]) => ({ codigo3c, nombre: p.nombre.slice(0, 200), unidadBase: p.unidad.slice(0, 16) }));
  if (dry) {
    const existentes = new Set(
      (await db.select({ codigo3c: productos.codigo3c }).from(productos)).map((p) => p.codigo3c),
    );
    prodsCreados = prodList.filter((p) => !existentes.has(p.codigo3c)).length;
  } else {
    for (let i = 0; i < prodList.length; i += 500) {
      const res = await db.insert(productos).values(prodList.slice(i, i + 500)).onConflictDoNothing({ target: productos.codigo3c }).returning({ codigo: productos.codigo3c });
      prodsCreados += res.length;
    }
  }

  // 4) Mapas de resolución + idempotencia.
  const tiposRows = await db.select({ id: tiposMovimiento.id, codigo: tiposMovimiento.codigo }).from(tiposMovimiento);
  const tipoId = new Map(tiposRows.map((t) => [t.codigo, t.id]));
  const ubicRows = await db.select({ id: ubicaciones.id, depId3c: ubicaciones.depId3c }).from(ubicaciones);
  const ubicId = new Map(ubicRows.map((u) => [u.depId3c, u.id]));
  // En --dry las ubicaciones nuevas no se insertaron, así que no tienen id: se mapean a un
  // id ficticio para que el conteo no las tome por "descartadas" (nunca llega a la DB: el
  // insert de movimientos está salteado en dry).
  if (dry) for (const depId3c of ubics.keys()) if (!ubicId.has(depId3c)) ubicId.set(depId3c, -1);
  // Idempotencia por (codigo + nro_3c + dirección): el número es único por tipo, y un
  // mismo número puede tener movimientos en direcciones distintas (ajustes mixtos).
  const origenU = alias(ubicaciones, 'origen_u');
  const destinoU = alias(ubicaciones, 'destino_u');
  const yaImportados = new Set(
    (
      await db
        .select({
          nro3c: movimientos.nro3c,
          codigo: tiposMovimiento.codigo,
          od: origenU.depId3c,
          dd: destinoU.depId3c,
        })
        .from(movimientos)
        .innerJoin(tiposMovimiento, eq(tiposMovimiento.id, movimientos.tipoId))
        .innerJoin(origenU, eq(origenU.id, movimientos.origenId))
        .innerJoin(destinoU, eq(destinoU.id, movimientos.destinoId))
        .where(sql`${movimientos.nro3c} IS NOT NULL`)
    ).map((r) => `${r.codigo}|${r.nro3c}|${r.od}->${r.dd}`),
  );
  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('Falta el usuario de integración (corré db:seed).');

  // 5) Insertar movimientos nuevos (cada uno en su tx: cabecera + detalle).
  let creados = 0;
  let saltadosExistentes = 0;
  for (const g of grupos.values()) {
    if (yaImportados.has(`${g.tipo}|${g.numero}|${g.origen}->${g.destino}`)) {
      saltadosExistentes++;
      continue;
    }
    const oId = ubicId.get(g.origen);
    const dId = ubicId.get(g.destino);
    const tId = tipoId.get(g.tipo);
    if (oId === undefined || dId === undefined || tId === undefined) {
      descartados += g.renglones.length;
      continue;
    }
    if (!dry) {
      await db.transaction(async (tx) => {
        const nro = await generarNro(tx, g.tipo, Number(g.fecha.slice(0, 4)));
        const [cab] = await tx
          .insert(movimientos)
          .values({
            nro, tipoId: tId, fecha: g.fecha, hora: '00:00:00', origenId: oId, destinoId: dId,
            estado: 'CONFIRMADO', usuarioId, nro3c: g.numero, confirmadoEn: sql`now()`,
          })
          .returning({ id: movimientos.id });
        await insertarDetalle(
          tx,
          cab!.id,
          g.renglones.map((r) => ({ producto3c: r.producto_3c, cantidadReal: String(r.cantidad), unidad: r.unidad })),
        );
      });
    }
    creados++;
    if (!dry && creados % 200 === 0) console.log(`  … ${creados} movimientos`);
  }

  // 6) Recalcular stock una sola vez.
  if (creados > 0 && !dry) await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);

  const verbo = dry ? 'se crearían' : 'creados';
  console.log(
    `${dry ? '🔍 DRY-RUN — no se escribió NADA.\n' : ''}` +
      `✔ Movimientos: ${creados} ${verbo}, ${saltadosExistentes} ya estaban, ${descartados} renglones descartados.`,
  );
  console.log(`  Ubicaciones auto-creadas: ${ubicsCreadas}. Productos auto-creados: ${prodsCreados}. ${dry ? '(se crearían)' : ''}`);
  if (tiposDesconocidos.size > 0) {
    console.log(`  ⚠ TIPO_DOC no mapeados (avisame para agregarlos): ${[...tiposDesconocidos].join(', ')}`);
  }
  await pool.end();
}

// El archivo es el primer argumento que NO es un flag: así `--dry` puede ir de cualquier
// lado sin que se lo confunda con el nombre del archivo (antes, `--dry` se tomaba como
// filename y el import escribía igual).
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const archivo = args.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: npm run import:movimientos -- <archivo.csv|tsv> [--dry]');
  process.exit(1);
}

main(archivo, dry).catch((err: unknown) => {
  console.error('❌ Error importando movimientos:', err);
  process.exit(1);
});
