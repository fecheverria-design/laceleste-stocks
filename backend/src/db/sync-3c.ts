import { eq } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos, proveedores, ubicaciones } from './schema.js';
import { consultarProxy } from './tresc-proxy.js';
import { interpretarCompras } from './compras-lectura.js';
import { persistirCompras } from './import-compras.js';
import { aplicarInventario } from './import-inventario.js';
import { importarProductos } from './import-productos.js';
import { importarProveedores } from './import-proveedores.js';

// Sincroniza datos desde 3c EN VIVO, reemplazando los exports CSV que se bajaban a mano de
// Firefox. 3c corre sobre Oracle y NO tiene API REST; se lee por el proxy SQL de solo lectura
// (ver tresc-proxy.ts) o por el servlet SqlToExcel de los informes. Cada fuente alimenta el
// MISMO importador que ya existe → cero mapeo nuevo, misma lógica de idempotencia.
//
// SOLO LECTURA sobre 3c. 3c sigue siendo la fuente de verdad; acá solo consolidamos.
//
// Fuentes:
//   productos   → proxy, vista V_ARTICULO (el maestro: nombre, unidad, rubro) → import:productos
//   proveedores → proxy, vista LC_V_PROVEEDORES (el maestro de proveedores) → import:proveedores
//   compras     → proxy, vista V_COMP_PRECIOS_CPRA (ventana rodante de N días) → import:compras
//   stock       → proxy, vista V_LACELESTE_STOCK (la FOTO del stock de 3c) → import:inventario
//   [pendiente] precios → servlet SqlToExcel (.xls); falta el lector de .xls.
//   movimientos → NO se automatiza: J los importa a mano 1× por semana (decisión 2026-09-08).
//
// Idempotente: correr cada hora re-trae la ventana solapada y NO duplica (compras upsertea por
// (numero, producto_3c, renglon)). Por eso NO hay que calcular fechas en cada corrida: se pide
// SIEMPRE los últimos N días y el upsert absorbe lo repetido.
//
// Uso:
//   npm run sync:3c                       (fuentes por defecto, ventana 14 días)
//   npm run sync:3c -- --dias=30 --dry
//   npm run sync:3c -- --fuente=compras   (una sola fuente)
//   npm run sync:3c -- --fuente=stock     (pisa el stock con la foto de 3c)
//
// `stock` NO está en las fuentes por defecto a propósito: aplicar la foto reescribe el stock
// de la app (genera RECUENTOS), así que se pide explícito hasta que se decida ponerlo en el
// cron horario. Ver docs/IMPORTACION-3C.md.

// El orden importa: productos primero, porque compras y la foto de stock necesitan que el
// maestro tenga el código (ninguna de las dos inventa productos).
const FUENTES_DISPONIBLES = ['productos', 'proveedores', 'compras', 'stock'] as const;
type Fuente = (typeof FUENTES_DISPONIBLES)[number];
const FUENTES_POR_DEFECTO: Fuente[] = ['productos', 'proveedores', 'compras'];

interface Args {
  dry: boolean;
  dias: number;
  fuentes: Fuente[];
}

function parseArgs(argv: string[]): Args {
  let dry = false;
  let dias = 14;
  let fuentes: Fuente[] = [...FUENTES_POR_DEFECTO];
  for (const a of argv) {
    if (a === '--dry') dry = true;
    else if (a.startsWith('--dias=')) {
      const n = Number(a.slice('--dias='.length));
      if (!Number.isInteger(n) || n < 0) throw new Error(`--dias inválido: ${a} (entero >= 0)`);
      dias = n;
    } else if (a.startsWith('--fuente=')) {
      const f = a.slice('--fuente='.length).trim();
      if (!(FUENTES_DISPONIBLES as readonly string[]).includes(f)) {
        throw new Error(`--fuente desconocida: ${f} (opciones: ${FUENTES_DISPONIBLES.join(', ')})`);
      }
      fuentes = [f as Fuente];
    }
  }
  return { dry, dias, fuentes };
}

// Compras reales de 3c, ventana rodante de N días. Parte de la query que J usa en n8n, con
// los ajustes para que entre derecho al importador:
//   · FECHA formateada dd/mm/yyyy (lo que espera compras-lectura).
//   · Nombre del proveedor con un join (V_COMP_PRECIOS_CPRA solo trae PERSONAS_ID).
//   · FAMILIA real desde V_ARTICULO (join por a.ID = v.ARTICU_ID; el ARTICU_ID de V_ARTICULO
//     es un id interno de Oracle, NO el código de producto). Sin esto los productos entraban
//     sin familia y el desglose por comprador/las exclusiones del gasto quedaban vacíos.
//   · TOTAL CON IVA reconstruido: V_COMP_PRECIOS_CPRA da neto + base gravada/exenta pero NO la
//     alícuota. La alícuota vive por producto en V_PRECIO_BASE.TIPO_IVA (21/10,5/27, foto al
//     día). con_iva = EXENTO + GRAVADO×(1+alícuota). Fallback 21% si el producto no está en la
//     foto de precios. Todos los joins son LEFT para no perder ni un renglón de compra.
function queryCompras(dias: number): string {
  return `SELECT
      v.NUMERO,
      TO_CHAR(v.FECHA, 'DD/MM/YYYY') AS FECHA,
      v.ARTICU_ID,
      v.CANTIDAD,
      v.PRECIO_UNITARIO,
      v.PRECIO_TOTAL,
      v.PERSONAS_ID,
      v.DENOMINACION,
      p.APELLIDO AS PROVEEDORES,
      a.FAMILIA_DESCR AS FAMILIA,
      NVL(pb.TIVA, 21) AS IVA,
      ROUND(NVL(v.EXENTO, 0) + NVL(v.GRAVADO, 0) * (1 + NVL(pb.TIVA, 21) / 100), 2) AS VALOR_TOTAL
    FROM LACELESTE.V_COMP_PRECIOS_CPRA v
    LEFT JOIN LACELESTE.LC_V_PROVEEDORES p ON p.PERSONAS_ID = v.PERSONAS_ID
    LEFT JOIN LACELESTE.V_ARTICULO a ON a.ID = v.ARTICU_ID
    LEFT JOIN (
      SELECT ID, MAX(TO_NUMBER(TIPO_IVA)) TIVA
      FROM LACELESTE.V_PRECIO_BASE
      WHERE TIPO_IVA IS NOT NULL
      GROUP BY ID
    ) pb ON pb.ID = v.ARTICU_ID
    WHERE TRUNC(v.FECHA) >= TRUNC(SYSDATE) - ${dias}
    ORDER BY v.DOC_ID ASC, v.ID ASC`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVEEDORES — el maestro de 3c (LC_V_PROVEEDORES). Antes solo se creaban los que
// aparecían en la ventana de compras, así que un proveedor dado de alta hace poco y sin
// compras recientes no existía en la app (al 2026-09-08 faltaban 24, casi todos personas
// con numeración 7657+).
//
// OJO: en esta vista el nombre está en APELLIDO (NOMBRE viene vacío), igual que en la
// query de compras. Y el CUIT usa '0' como placeholder de "no cargado".
const MINIMO_PROVEEDORES = 500;

function queryProveedores(): string {
  return `SELECT PERSONAS_ID, APELLIDO, CUIT
    FROM LACELESTE.LC_V_PROVEEDORES
    ORDER BY PERSONAS_ID`;
}

async function syncProveedores(dry: boolean): Promise<void> {
  console.log(`▶ Proveedores 3c ${dry ? '(DRY-RUN) ' : ''}— maestro LC_V_PROVEEDORES`);
  const filas = await consultarProxy(queryProveedores());
  const datos = filas.slice(1).filter((f) => (f[0] ?? '').trim() !== '' && (f[1] ?? '').trim() !== '');
  if (datos.length < MINIMO_PROVEEDORES) {
    throw new Error(
      `El maestro de proveedores trajo solo ${datos.length} fila(s) (mínimo esperado ${MINIMO_PROVEEDORES}): se aborta.`,
    );
  }

  const existentes = new Set(
    (await db.select({ n: proveedores.numero3c }).from(proveedores))
      .map((p) => p.n)
      .filter((n): n is number => n !== null),
  );
  const nuevos = datos.filter((f) => !existentes.has(Number((f[0] ?? '').trim())));
  console.log(`  Maestro 3c: ${datos.length} proveedor(es) · ${nuevos.length} sin alta en la app`);
  for (const f of nuevos.slice(0, 20)) console.log(`    ${dry ? '[dry] ' : ''}+ ${f[0]} ${f[1]}`);
  if (nuevos.length > 20) console.log(`    … y ${nuevos.length - 20} más.`);
  if (dry) return;

  // Encabezados que entiende import:proveedores. El CUIT '0' de 3c se manda vacío para
  // que quede en null y no como un cuit falso.
  const cabecera = ['NUMERO', 'NOMBRE', 'CUIT'];
  const cuerpo = datos.map((f) => [f[0] ?? '', f[1] ?? '', (f[2] ?? '').trim() === '0' ? '' : (f[2] ?? '')]);
  await importarProveedores([cabecera, ...cuerpo]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTOS — el maestro de 3c (V_ARTICULO). Reemplaza el export a mano que había que
// bajar de Firefox cada vez que daban de alta un artículo. En ESTA vista `ID` es el
// codigo_3c (1 = AJUSTE CENTAVO, 10 = BOLSA RESIDUOS…), no un id interno.
//
// Pisa nombre, unidad, familia y subfamilia (3c manda, regla #1) pero NO toca las columnas
// que son enriquecimiento propio de la app (presentación de compra, unidades por bulto,
// clasificación ABC, información): al no venir en las filas, el upsert las conserva.
const MINIMO_PRODUCTOS = 500;

function queryProductos(): string {
  return `SELECT ID, DENOMINACION, UMEDIDA, FAMILIA_DESCR, SUBFAM_DESCR
    FROM LACELESTE.V_ARTICULO
    ORDER BY ID`;
}

async function syncProductos(dry: boolean): Promise<void> {
  console.log(`▶ Productos 3c ${dry ? '(DRY-RUN) ' : ''}— maestro V_ARTICULO`);
  const filas = await consultarProxy(queryProductos());
  const datos = filas.slice(1).filter((f) => (f[0] ?? '').trim() !== '');
  if (datos.length < MINIMO_PRODUCTOS) {
    throw new Error(
      `El maestro de 3c trajo solo ${datos.length} producto(s) (mínimo esperado ${MINIMO_PRODUCTOS}): se aborta.`,
    );
  }

  const existentes = new Set((await db.select({ c: productos.codigo3c }).from(productos)).map((p) => p.c));
  const nuevos = datos.filter((f) => !existentes.has((f[0] ?? '').trim()));
  console.log(`  Maestro 3c: ${datos.length} producto(s) · ${nuevos.length} sin alta en la app`);
  for (const f of nuevos.slice(0, 20)) {
    console.log(`    ${dry ? '[dry] ' : ''}+ ${f[0]} ${f[1]} (${f[3] ?? 'sin familia'} / ${f[4] ?? '-'}) · ${f[2] ?? 'UNIDAD'}`);
  }
  if (nuevos.length > 20) console.log(`    … y ${nuevos.length - 20} más.`);
  if (dry) return;

  // Encabezados que entiende import:productos (ver sus alias).
  const cabecera = ['3C', 'PRODUCTOS', 'UNIDAD', 'FAMILIA', 'SUBFAMILIA'];
  await importarProductos([cabecera, ...datos.map((f) => f.slice(0, 5))]);
}

async function syncCompras(dias: number, dry: boolean): Promise<void> {
  console.log(`▶ Compras 3c ${dry ? '(DRY-RUN) ' : ''}— últimos ${dias} días (vista V_COMP_PRECIOS_CPRA)`);
  const filas = await consultarProxy(queryCompras(dias));
  const { registros, saltadas, excluidasFamilia } = interpretarCompras(filas);
  const gastoNeto = registros.reduce((a, r) => a + r.precioTotal, 0);
  const gastoConIva = registros.reduce((a, r) => a + (r.totalConIva ?? r.precioTotal), 0);
  console.log(
    `  Filas: ${filas.length - 1} · válidas: ${registros.length} · saltadas: ${saltadas} · excluidas por familia: ${excluidasFamilia} · neto: $${gastoNeto.toLocaleString('es-AR')} · con IVA: $${gastoConIva.toLocaleString('es-AR')}`,
  );
  if (dry) {
    for (const r of registros.slice(0, 5)) {
      console.log(`    [dry] ${r.fecha} ${r.numero} · ${r.producto3c} ${r.nombre} · ${r.proveedorNombre} · ${r.cantidad} × $${r.precioUnitario} = $${r.precioTotal}`);
    }
    return;
  }
  const escritos = await persistirCompras(registros);
  console.log(`  ✔ ${escritos} renglón(es) de compra importados/actualizados.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK — la FOTO de 3c (V_LACELESTE_STOCK). 3c es la fuente de verdad del stock
// (Opción A, decisión de J 2026-09-04): la foto se aplica como RECUENTO y deja el stock
// parado exacto en lo que dice 3c. Se reusa aplicarInventario() → mismo camino que el
// conteo físico: genera movimientos INVENTARIO contra el balde 101, auditable.
//
// Alcance: SOLO los depósitos que la app ya lleva (`lleva_stock`). 3c tiene 36 depósitos
// con existencias (PAÑOL, UNIFORMES, ADMINISTRACIÓN…) que la app deliberadamente no
// stockea; traerlos sería un cambio de alcance, no un sync.
//
// Es AUTORITATIVA (--exclusivo): un producto con stock en la app que la foto no lista
// queda en 0. Por eso los guardas de abajo: una foto vacía o cortada borraría el stock.
const MINIMO_FILAS_FOTO = 500;

function queryStock(): string {
  return `SELECT ARTICU_ID, DEPOSITOS_ID, STOCK_ACTUAL
    FROM LACELESTE.V_LACELESTE_STOCK
    ORDER BY DEPOSITOS_ID, ARTICU_ID`;
}

async function syncStock(dry: boolean): Promise<void> {
  console.log(`▶ Stock 3c ${dry ? '(DRY-RUN) ' : ''}— foto V_LACELESTE_STOCK`);
  const filas = await consultarProxy(queryStock());
  const datos = filas.slice(1).filter((f) => f.length >= 3);
  if (datos.length < MINIMO_FILAS_FOTO) {
    throw new Error(
      `La foto de 3c trajo solo ${datos.length} fila(s) (mínimo esperado ${MINIMO_FILAS_FOTO}). ` +
        'Aplicarla borraría stock: se aborta.',
    );
  }

  // Depósitos que la app lleva + productos del maestro: la foto NO crea ni depósitos ni
  // productos (regla #1: los códigos son de 3c, pero el alta al maestro es su propio paso,
  // con nombre y rubro de verdad — acá no tenemos la denominación).
  const depsApp = new Set(
    (
      await db
        .select({ depId3c: ubicaciones.depId3c })
        .from(ubicaciones)
        .where(eq(ubicaciones.llevaStock, true))
    ).map((u) => u.depId3c),
  );
  const prodsApp = new Set((await db.select({ c: productos.codigo3c }).from(productos)).map((p) => p.c));

  const conocidas: string[][] = [];
  const depsFuera = new Set<number>();
  const prodsFuera = new Set<string>();
  for (const f of datos) {
    const prod = (f[0] ?? '').trim();
    const dep = Number((f[1] ?? '').trim());
    const cant = (f[2] ?? '').trim();
    if (!prod || !Number.isInteger(dep)) continue;
    if (!depsApp.has(dep)) {
      depsFuera.add(dep);
      continue;
    }
    if (!prodsApp.has(prod)) {
      prodsFuera.add(prod);
      continue;
    }
    conocidas.push([String(dep), prod, cant]);
  }

  console.log(
    `  Foto: ${datos.length} fila(s) · ${conocidas.length} en depósitos que la app lleva ` +
      `· ${depsFuera.size} depósito(s) de 3c fuera de alcance · ${prodsFuera.size} producto(s) sin alta en el maestro`,
  );
  if (prodsFuera.size > 0) {
    console.log(`  ⚠ Sin alta (no se tocan, corré import:productos): ${[...prodsFuera].join(', ')}`);
  }
  if (conocidas.length === 0) throw new Error('La foto no dejó ninguna fila aplicable: se aborta.');

  await aplicarInventario([['DEPOSITO', '3C', 'STOCK'], ...conocidas], {
    dry,
    exclusivo: true,
    etiqueta: 'foto de 3c (V_LACELESTE_STOCK)',
    // Encabeza las observaciones del movimiento: en la hoja de Movimientos se distingue
    // a simple vista lo que vino de 3c de lo que vino de la app del compañero.
    origen: 'Foto 3c',
  });
}

async function main(): Promise<void> {
  const { dry, dias, fuentes } = parseArgs(process.argv.slice(2));
  console.log(`▶ Sync 3c ${dry ? '(DRY-RUN) ' : ''}· fuentes: ${fuentes.join(', ')}`);
  for (const f of fuentes) {
    if (f === 'productos') await syncProductos(dry);
    if (f === 'proveedores') await syncProveedores(dry);
    if (f === 'compras') await syncCompras(dias, dry);
    if (f === 'stock') await syncStock(dry);
  }
  console.log(`\n${dry ? 'DRY-RUN — nada se escribió.' : '✔ Sync 3c completo.'}`);
}

main()
  .catch((e) => {
    console.error('✗ Sync 3c abortado:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
