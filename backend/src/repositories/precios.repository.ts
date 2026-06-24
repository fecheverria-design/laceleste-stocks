import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { precios, productos } from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a datos de precios. El "precio vigente" de un producto es el de mayor
// vigente_desde <= hoy (DISTINCT ON). El historial completo alimenta el gráfico
// de evolución. Inserts/updates/deletes corrigen la curva.
// ─────────────────────────────────────────────────────────────────────────────

export type FilaPrecioVigente = {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  precio: string | null; // null = producto sin precio cargado
  vigente_desde: string | null;
  precio_id: number | null;
};

// Precio vigente por producto (incluye productos sin precio: precio = null).
// DISTINCT ON toma, por producto, la fila de mayor vigente_desde <= hoy.
export async function listarPreciosVigentes(): Promise<FilaPrecioVigente[]> {
  const res = await db.execute<FilaPrecioVigente>(
    sql`SELECT
          p.codigo_3c AS producto_3c,
          p.nombre AS producto_nombre,
          p.unidad_base AS unidad_base,
          v.precio AS precio,
          v.vigente_desde::text AS vigente_desde,
          v.id AS precio_id
        FROM productos p
        LEFT JOIN LATERAL (
          SELECT id, precio, vigente_desde
          FROM precios
          WHERE producto_3c = p.codigo_3c AND vigente_desde <= current_date
          ORDER BY vigente_desde DESC, id DESC
          LIMIT 1
        ) v ON TRUE
        WHERE p.activo = true
        ORDER BY p.nombre`,
  );
  return res.rows;
}

export interface FilaPrecioHistorial {
  id: number;
  precio: string;
  vigente_desde: string;
  usuario_id: number;
  creado_en: string;
}

// Historial completo de un producto (más reciente primero), para tabla + gráfico.
export async function listarHistorialPrecios(producto3c: string): Promise<FilaPrecioHistorial[]> {
  return db
    .select({
      id: precios.id,
      precio: precios.precio,
      vigente_desde: precios.vigenteDesde,
      usuario_id: precios.usuarioId,
      creado_en: sql<string>`${precios.creadoEn}::text`,
    })
    .from(precios)
    .where(eq(precios.producto3c, producto3c))
    .orderBy(desc(precios.vigenteDesde), desc(precios.id));
}

export async function existeProducto(producto3c: string): Promise<boolean> {
  const [row] = await db
    .select({ codigo: productos.codigo3c })
    .from(productos)
    .where(eq(productos.codigo3c, producto3c))
    .limit(1);
  return row !== undefined;
}

export interface PrecioRow {
  id: number;
  producto_3c: string;
  precio: string;
  vigente_desde: string;
  usuario_id: number;
  creado_en: string;
}

const selectPrecio = {
  id: precios.id,
  producto_3c: precios.producto3c,
  precio: precios.precio,
  vigente_desde: precios.vigenteDesde,
  usuario_id: precios.usuarioId,
  creado_en: sql<string>`${precios.creadoEn}::text`,
};

export async function insertarPrecio(datos: {
  producto3c: string;
  precio: number;
  vigenteDesde: string;
  usuarioId: number;
}): Promise<PrecioRow> {
  const [row] = await db
    .insert(precios)
    .values({
      producto3c: datos.producto3c,
      precio: String(datos.precio),
      vigenteDesde: datos.vigenteDesde,
      usuarioId: datos.usuarioId,
    })
    .returning(selectPrecio);
  if (!row) throw new Error('No se pudo insertar el precio');
  return row;
}

export async function obtenerPrecioPorId(id: number): Promise<PrecioRow | undefined> {
  const [row] = await db.select(selectPrecio).from(precios).where(eq(precios.id, id)).limit(1);
  return row;
}

export async function actualizarPrecio(
  id: number,
  cambios: { precio?: number; vigenteDesde?: string },
): Promise<PrecioRow | undefined> {
  const set: { precio?: string; vigenteDesde?: string } = {};
  if (cambios.precio !== undefined) set.precio = String(cambios.precio);
  if (cambios.vigenteDesde !== undefined) set.vigenteDesde = cambios.vigenteDesde;
  const [row] = await db.update(precios).set(set).where(eq(precios.id, id)).returning(selectPrecio);
  return row;
}

export async function borrarPrecio(id: number): Promise<boolean> {
  const res = await db.delete(precios).where(eq(precios.id, id)).returning({ id: precios.id });
  return res.length > 0;
}

// Evita cargar dos precios con la MISMA fecha de vigencia para un producto
// (ambigüedad: cuál vale ese día). exceptoId ignora la fila que se está editando.
export async function existePrecioEnFecha(
  producto3c: string,
  vigenteDesde: string,
  exceptoId?: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: precios.id })
    .from(precios)
    .where(and(eq(precios.producto3c, producto3c), eq(precios.vigenteDesde, vigenteDesde)));
  return rows.some((r) => r.id !== exceptoId);
}
