import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { precios, productos, proveedores } from './schema.js';
import { parseDelimited } from './csv.js';
import { leerXls } from './xls.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Importa el HISTÓRICO de precios de 3c. Una fila = un precio de un proveedor en una
// fecha, con un TIPO: COMPRA (lo que se pagó) o ACTUALIZACION (precio de lista). Se
// guardan todas: el "precio vigente" es la última COMPRA (lo resuelve la query); el
// gráfico usa solo las COMPRA.
//
// Columnas esperadas (por nombre, en cualquier orden):
//   ID (producto_3c), DENOMINACION, PRECIO_UNITARIO, PERSONAS_ID (= numero de proveedor),
//   PROVEEDORES (nombre), FECHA (dd/mm/yyyy), TIPO (COMPRA|ACTUALIZACION).
//   FAMILIA / AÑO / MES / RESPONSABLE se ignoran.
//
// Acepta CSV/TSV y también el .xlsx directo (la planilla de compras). Del Excel se leen los
// valores CRUDOS, no los formateados: una celda con formato moneda se ve "$5,832" y ahí ya
// se perdieron los centavos.
//
// EN LUGAR DE `TIPO` acepta la columna `USAR` de la planilla de compras (el tilde de "este
// es el precio que usamos"): marcada = COMPRA, sin marcar = ACTUALIZACION. Regla de J.
// Cuando el tipo sale de ahí, el archivo es una FOTO POR MES del mismo hecho, así que las
// filas del mismo producto+proveedor+fecha se colapsan en una sola y **basta con que esté
// marcada en un mes para que sea COMPRA**: el tilde gana. Sin ese colapso, un precio marcado
// en enero y no en marzo entraría dos veces, como compra y como actualización del mismo día.
//
// Idempotente: upsert por (producto_3c, proveedor_id, vigente_desde, tipo). Auto-crea
// productos y proveedores faltantes.
//
// Uso: npm run import:precios -- <archivo> [--dry] [--controlado]
//
// --controlado: además de importarlos, MARCA cada precio como EL precio controlado de su
// producto (el que le gana a todo en la prelación, ver repositories/precio-vigente.ts). Es
// para cargar de una lo que compras controló en el mes, sin marcarlo a mano de a uno en la
// hoja de Control de precios. Como solo puede haber UN controlado por producto (índice
// parcial `uq_precio_controlado_producto`), si el archivo trae varias filas del mismo
// producto gana la de fecha más nueva, y se avisa cuántas quedaron afuera. Desmarca el
// controlado anterior de esos productos, igual que hace la hoja.

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. "1.200,00" -> 1200 ; "507,50" -> 507.5.
function parsePrecio(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

// Normaliza el TIPO sin depender de mayúsculas/tildes. Default COMPRA si viene raro.
function normalizarTipo(s: string): 'COMPRA' | 'ACTUALIZACION' {
  const t = s.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t.startsWith('ACTUALIZ') ? 'ACTUALIZACION' : 'COMPRA';
}

// El tilde de la planilla de compras. Excel lo escribe true/false, VERDADERO/FALSO o 1/0
// según el idioma y cómo se exporte; cualquier otra cosa (celda vacía) es "sin tildar".
function tipoSegunUsar(s: string): 'COMPRA' | 'ACTUALIZACION' {
  const t = s.trim().toUpperCase();
  return t === 'TRUE' || t === 'VERDADERO' || t === 'V' || t === 'SI' || t === 'X' || t === '1'
    ? 'COMPRA'
    : 'ACTUALIZACION';
}

export interface FilaPrecio {
  producto3c: string;
  nombre: string;
  proveedorNum: number;
  proveedorNombre: string;
  precio: number;
  tipo: 'COMPRA' | 'ACTUALIZACION';
  vigenteDesde: string;
}

// De todas las filas del archivo, cuál se marca como controlada por producto: solo puede
// haber UNA (índice parcial `uq_precio_controlado_producto`). Gana la COMPRA más nueva; si
// no hay ninguna compra, la última actualización. A igualdad, la última fila del archivo.
//
// El orden COMPRA-antes-que-ACTUALIZACION es el mismo de `repositories/precio-vigente.ts`, y
// no es un detalle: en la planilla de compras el tilde se traduce a COMPRA, así que sin esta
// preferencia quedaría controlada la última cotización cargada aunque NO esté tildada —
// justo lo contrario de lo que significa la marca. Aparte para poder testearla sin DB.
export function unoPorProducto(registros: FilaPrecio[]): Map<string, FilaPrecio> {
  const elegidos = new Map<string, FilaPrecio>();
  const gana = (r: FilaPrecio, previa: FilaPrecio): boolean => {
    const esCompra = r.tipo === 'COMPRA';
    if (esCompra !== (previa.tipo === 'COMPRA')) return esCompra;
    return r.vigenteDesde >= previa.vigenteDesde;
  };
  for (const r of registros) {
    const previa = elegidos.get(r.producto3c);
    if (previa === undefined || gana(r, previa)) elegidos.set(r.producto3c, r);
  }
  return elegidos;
}

/** Lo que el archivo dijo, ya interpretado y deduplicado. */
export interface PlanillaPrecios {
  registros: FilaPrecio[];
  saltados: number;
  /** El tipo salió del tilde `USAR` (planilla de compras) y no de una columna `TIPO`. */
  desdeUsar: boolean;
}

/**
 * Traduce las filas del archivo (venga de CSV o de Excel) a precios, deduplicando.
 *
 * Pura a propósito: es donde vive la interpretación del tilde y del colapso por mes, o sea
 * lo que hay que poder testear sin DB ni archivo.
 */
export function interpretarPlanillaPrecios(filas: string[][]): PlanillaPrecios {
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const h = filas[0]!;
  const norm = h.map((x) => x.trim().toUpperCase());
  const buscar = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const idx = (aliases: string[]): number => {
    const i = buscar(aliases);
    if (i === -1) throw new Error(`Falta la columna (${aliases.join(' / ')}). Encabezados: ${h.join(' | ')}`);
    return i;
  };

  // El tipo sale de `TIPO` o, si no está, del tilde `USAR` de la planilla de compras.
  const iTipo = buscar(['TIPO']);
  const iUsar = buscar(['USAR', 'USA', 'USAR?']);
  if (iTipo === -1 && iUsar === -1) {
    throw new Error(`Falta la columna TIPO (o USAR, el tilde de la planilla). Encabezados: ${h.join(' | ')}`);
  }
  const desdeUsar = iTipo === -1;

  const col = {
    ID: idx(['ID', 'CODIGO', 'ARTICU_ID']),
    DENOMINACION: idx(['DENOMINACION', 'ARTICULO']),
    PRECIO: idx(['PRECIO_UNITARIO', 'PRECIO_LISTA', 'PRECIO']),
    PERSONAS_ID: idx(['PERSONAS_ID', 'COD. PROVEEDOR', 'ID PROVEEDOR']),
    PROVEEDOR: idx(['PROVEEDORES', 'PROVEEDOR', 'NOMBRE']),
    FECHA: idx(['FECHA', 'ULTIMA_ACT_PRECIO']),
  };
  const c = (f: string[], k: keyof typeof col) => (f[col[k]] ?? '').trim();

  // Dedup intra-archivo: la última fila gana. Con `TIPO` la clave lo incluye (una compra y
  // una actualización del mismo día son dos hechos distintos). Con el tilde NO: ahí el
  // archivo repite el mismo hecho una vez por mes, así que se colapsan y basta un mes
  // tildado para que la clave entera sea COMPRA.
  const porClave = new Map<string, FilaPrecio>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const producto3c = c(f, 'ID').slice(0, 32);
    const proveedorNum = Number(c(f, 'PERSONAS_ID'));
    const precio = parsePrecio(c(f, 'PRECIO'));
    const vigenteDesde = parseFecha(c(f, 'FECHA'));
    const tipo = desdeUsar ? tipoSegunUsar(f[iUsar] ?? '') : normalizarTipo(f[iTipo] ?? '');
    // Un precio 0 no es un precio: la app ya lo ignora al resolver el vigente, guardarlo solo
    // ensucia el historial y el gráfico.
    if (!producto3c || !Number.isInteger(proveedorNum) || proveedorNum <= 0 || !Number.isFinite(precio) || precio <= 0 || !vigenteDesde) {
      saltados++;
      continue;
    }
    const clave = desdeUsar
      ? `${producto3c}|${proveedorNum}|${vigenteDesde}`
      : `${producto3c}|${proveedorNum}|${vigenteDesde}|${tipo}`;
    const previa = porClave.get(clave);
    porClave.set(clave, {
      producto3c,
      nombre: c(f, 'DENOMINACION').slice(0, 200) || `Producto ${producto3c}`,
      proveedorNum,
      proveedorNombre: c(f, 'PROVEEDOR').slice(0, 150) || `Proveedor ${proveedorNum}`,
      precio,
      // El tilde gana: si en algún mes estaba marcada, la fila es COMPRA.
      tipo: desdeUsar && previa?.tipo === 'COMPRA' ? 'COMPRA' : tipo,
      vigenteDesde,
    });
  }

  return { registros: [...porClave.values()], saltados, desdeUsar };
}

async function main(archivo: string, dry: boolean, controlado: boolean): Promise<void> {
  const esExcel = /\.xlsx?$/i.test(archivo);
  const filas = esExcel
    ? leerXls(archivo, undefined, { crudo: true })
    : parseDelimited(readFileSync(archivo, 'utf8'));
  const { registros, saltados, desdeUsar } = interpretarPlanillaPrecios(filas);
  const compras = registros.filter((r) => r.tipo === 'COMPRA').length;
  if (desdeUsar) {
    console.log('Tipo tomado del tilde USAR: marcada = COMPRA, sin marcar = ACTUALIZACION.');
  }

  const prods = new Map<string, { codigo3c: string; nombre: string; unidadBase: string }>();
  const provs = new Map<number, { numero3c: number; nombre: string }>();
  for (const r of registros) {
    if (!prods.has(r.producto3c)) prods.set(r.producto3c, { codigo3c: r.producto3c, nombre: r.nombre, unidadBase: 'UN' });
    if (!provs.has(r.proveedorNum)) provs.set(r.proveedorNum, { numero3c: r.proveedorNum, nombre: r.proveedorNombre });
  }

  console.log(
    `Filas: ${filas.length - 1} · válidas: ${registros.length} (compras: ${compras}, actualizaciones: ${registros.length - compras}) · saltadas: ${saltados} · productos: ${prods.size} · proveedores: ${provs.size}`,
  );
  // Con el tilde, SOLO se marca lo tildado: un producto sin ningún tilde en todo el archivo
  // no tiene nada verificado por compras, y marcarle la última cotización suelta sería
  // inventarle una decisión que nadie tomó (le ganaría a toda compra futura).
  const candidatos = desdeUsar ? registros.filter((r) => r.tipo === 'COMPRA') : registros;
  const aControlar = controlado ? unoPorProducto(candidatos) : new Map<string, FilaPrecio>();
  if (controlado) {
    const productos = new Set(registros.map((r) => r.producto3c)).size;
    console.log(
      `  --controlado: se marcarán ${aControlar.size} precio(s), uno por producto` +
        (desdeUsar && productos > aControlar.size
          ? ` (${productos - aControlar.size} producto(s) sin ningún tilde en el archivo quedan como están)`
          : '') +
        (candidatos.length > aControlar.size
          ? ` · ${candidatos.length - aControlar.size} fila(s) comparten producto y NO se marcan`
          : ''),
    );
  }

  if (dry) {
    if (desdeUsar) {
      // Para contarlas hay que cruzar contra la DB. Los proveedores nuevos todavía no
      // existen, así que sus filas no matchean y el número puede quedar apenas corto.
      const provRows = await db.select({ id: proveedores.id, numero3c: proveedores.numero3c }).from(proveedores);
      const idPorNumero = new Map<number, number>();
      for (const p of provRows) if (p.numero3c !== null) idPorNumero.set(p.numero3c, p.id);
      await sembrarTemporales(registros, idPorNumero);
      const n = await contarComprasSinTilde();
      console.log(`  solo el tilde es COMPRA: ${n} compra(s) sin tilde de esos productos pasarían a ACTUALIZACION.`);
    }
    console.log('— DRY RUN: no se escribió nada. Muestra (primeras 5):');
    for (const r of registros.slice(0, 5)) {
      console.log(`  ${r.producto3c} ${r.nombre} · ${r.tipo} $${r.precio} · ${r.vigenteDesde} · ${r.proveedorNombre}`);
    }
    await pool.end();
    return;
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('No existe el usuario de integración (corré: npm run db:seed).');

  const prodList = [...prods.values()];
  for (let i = 0; i < prodList.length; i += 500) {
    await db.insert(productos).values(prodList.slice(i, i + 500)).onConflictDoNothing({ target: productos.codigo3c });
  }

  const provList = [...provs.values()];
  for (let i = 0; i < provList.length; i += 500) {
    await db
      .insert(proveedores)
      .values(provList.slice(i, i + 500))
      .onConflictDoUpdate({ target: proveedores.numero3c, set: { nombre: sql`excluded.nombre` } });
  }

  const provRows = await db.select({ id: proveedores.id, numero3c: proveedores.numero3c }).from(proveedores);
  const idPorNumero = new Map<number, number>();
  for (const p of provRows) if (p.numero3c !== null) idPorNumero.set(p.numero3c, p.id);

  const values = registros.map((r) => ({
    producto3c: r.producto3c,
    proveedorId: idPorNumero.get(r.proveedorNum) ?? null,
    precio: String(r.precio),
    tipo: r.tipo,
    vigenteDesde: r.vigenteDesde,
    usuarioId,
  }));
  let escritos = 0;
  for (let i = 0; i < values.length; i += 500) {
    const lote = values.slice(i, i + 500);
    await db
      .insert(precios)
      .values(lote)
      .onConflictDoUpdate({
        target: [precios.producto3c, precios.proveedorId, precios.vigenteDesde, precios.tipo],
        set: { precio: sql`excluded.precio`, usuarioId: sql`excluded.usuario_id` },
      });
    escritos += lote.length;
  }

  console.log(`✔ Precios importados/actualizados: ${escritos} (compras: ${compras}). Productos/proveedores faltantes auto-creados.`);

  // La regla de J: la única compra es la que él tildó. Va ANTES de marcar los controlados
  // porque cambia qué filas son COMPRA, y la marca elige entre esas.
  if (desdeUsar) {
    await sembrarTemporales(registros, idPorNumero);
    const { degradadas, duplicadasBorradas } = await soloElTildeEsCompra();
    console.log(
      `✔ Solo el tilde es COMPRA: ${degradadas} compra(s) sin tilde pasaron a ACTUALIZACION` +
        (duplicadasBorradas > 0
          ? ` (${duplicadasBorradas} actualización(es) de ese mismo producto/proveedor/fecha se borraron: quedó el importe pagado)`
          : '') +
        '.',
    );
  }

  if (controlado && aControlar.size > 0) {
    const marcados = await marcarControlados([...aControlar.values()], idPorNumero, usuarioId);
    console.log(`✔ Precios marcados como CONTROLADOS: ${marcados} (uno por producto; le ganan a cualquier compra posterior).`);
  }
  await pool.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLO EL TILDE ES COMPRA (regla de J, 2026-09-10).
//
// La tabla `precios` venía cargada con las "compras" del histórico de 3c, y J dice que esas
// NO son compras: la única compra es la que él tildó en la planilla. El caso que lo destapó:
// BOLSA DE PAPEL SULFITO Nº6 figuraba con una compra de $41.507,80 (contra $49,98 el resto
// del año) que **nunca existió** — es un bulto cargado como unidad. Mientras esa fila sea
// COMPRA, se cuela en el gráfico de evolución, en la alerta de saltos y en la prelación.
//
// Por eso, al importar la planilla, TODA compra que no esté tildada pasa a ACTUALIZACION.
// El dato no se pierde: queda como referencia, que es lo que es.
//
// Alcance: todos los productos, no solo los del archivo. La planilla cubre el 100% de los
// productos reales (los 47 que quedaban afuera son SERVICIOS / PRODUCTOS ESPORADICOS /
// AJUSTE SALDO / PRUEBA, familias que los informes ya excluyen), así que acotarlo a los del
// archivo solo dejaba una excepción sin sentido.
// ⚠ La contra, asumida: un producto nuevo que todavía no esté en la planilla va a figurar
// SIN compras hasta que lo tilden. Eso es visible: el informe de precios lo marca `sin_compra`.
// ─────────────────────────────────────────────────────────────────────────────

/** Deja en `tmp_tilde` (temporal de sesión) las filas que el archivo tildó. */
export async function sembrarTemporales(filas: FilaPrecio[], idPorNumero: Map<number, number>): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS tmp_tilde`);
  await db.execute(sql`CREATE TEMP TABLE tmp_tilde (producto_3c varchar(32), proveedor_id int, vigente_desde date)`);

  const tildadas = filas.filter((f) => f.tipo === 'COMPRA');
  for (let i = 0; i < tildadas.length; i += 500) {
    const lote = tildadas.slice(i, i + 500);
    await db.execute(
      sql`INSERT INTO tmp_tilde VALUES ${sql.join(
        lote.map((f) => sql`(${f.producto3c}, ${idPorNumero.get(f.proveedorNum) ?? null}, ${f.vigenteDesde})`),
        sql`, `,
      )}`,
    );
  }
}

/** Toda COMPRA que el archivo NO tildó. */
const comprasSinTilde = sql`
  SELECT c.id, c.producto_3c, c.proveedor_id, c.vigente_desde
  FROM precios c
  WHERE c.tipo = 'COMPRA'
    AND NOT EXISTS (
      SELECT 1 FROM tmp_tilde t
      WHERE t.producto_3c = c.producto_3c
        AND t.proveedor_id IS NOT DISTINCT FROM c.proveedor_id
        AND t.vigente_desde = c.vigente_desde
    )`;

async function contarComprasSinTilde(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${comprasSinTilde}) x`);
  return res.rows[0]?.n ?? 0;
}

/**
 * Degrada a ACTUALIZACION toda COMPRA sin tilde de los productos del archivo.
 *
 * El índice `uq_precio_prod_prov_fecha_tipo` no deja tener dos filas del mismo
 * (producto, proveedor, fecha, tipo), así que cuando ya existe una ACTUALIZACION de esa
 * misma clave hay que sacarla del medio primero. Se borra la actualización y se conserva la
 * compra degradada: **el importe que se pagó es mejor referencia que el precio de lista**.
 */
export async function soloElTildeEsCompra(): Promise<{ degradadas: number; duplicadasBorradas: number }> {
  return db.transaction(async (tx) => {
    const borradas = await tx.execute(sql`
      DELETE FROM precios a
      WHERE a.tipo = 'ACTUALIZACION'
        AND EXISTS (
          SELECT 1 FROM (${comprasSinTilde}) c
          WHERE c.producto_3c = a.producto_3c
            AND c.proveedor_id IS NOT DISTINCT FROM a.proveedor_id
            AND c.vigente_desde = a.vigente_desde
        )`);
    const degradadas = await tx.execute(sql`
      UPDATE precios SET tipo = 'ACTUALIZACION'
      WHERE id IN (SELECT id FROM (${comprasSinTilde}) c)`);
    return { degradadas: degradadas.rowCount ?? 0, duplicadasBorradas: borradas.rowCount ?? 0 };
  });
}

// Marca las filas dadas como EL precio controlado de su producto, en UNA transacción:
// primero desmarca el controlado anterior de esos productos (solo puede haber uno) y
// después marca el nuevo. Es la misma semántica que el botón de la hoja de Control de
// precios (repositories/precios.repository.ts → marcarControlado).
async function marcarControlados(
  filas: FilaPrecio[],
  idPorNumero: Map<number, number>,
  usuarioId: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const codigos = filas.map((f) => f.producto3c);
    for (let i = 0; i < codigos.length; i += 500) {
      const lote = codigos.slice(i, i + 500);
      await tx.execute(
        sql`UPDATE precios SET controlado_en = NULL, controlado_por = NULL
            WHERE controlado_en IS NOT NULL
              AND producto_3c IN (${sql.join(lote.map((c) => sql`${c}`), sql`, `)})`,
      );
    }
    let n = 0;
    for (const f of filas) {
      const provId = idPorNumero.get(f.proveedorNum) ?? null;
      const res = await tx.execute(
        sql`UPDATE precios SET controlado_en = now(), controlado_por = ${usuarioId}
            WHERE producto_3c = ${f.producto3c}
              AND proveedor_id IS NOT DISTINCT FROM ${provId}
              AND vigente_desde = ${f.vigenteDesde}
              AND tipo = ${f.tipo}`,
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

// Solo corre como CLI (import:precios). Cuando un test o algún módulo importa
// unoPorProducto(), este bloque NO se ejecuta (import.meta.url ≠ argv[1]).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const dry = process.argv.includes('--dry');
  const controlado = process.argv.includes('--controlado');
  if (!archivo) {
    console.error('Uso: npm run import:precios -- <archivo.csv|tsv> [--dry] [--controlado]');
    process.exit(1);
  }
  main(archivo, dry, controlado).catch((err: unknown) => {
    console.error('❌ Error importando precios:', err);
    process.exit(1);
  });
}
