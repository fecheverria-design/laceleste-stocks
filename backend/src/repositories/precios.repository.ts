import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { precios, productos, proveedores } from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a datos de precios. Un producto puede tener precio de varios proveedores;
// el "precio vigente" es el de vigente_desde más reciente <= hoy entre todos ellos
// (decisión de J: el más nuevo gana). El historial completo alimenta el gráfico.
// ─────────────────────────────────────────────────────────────────────────────

export type FilaPrecioVigente = {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  precio: string | null; // null = producto sin precio cargado
  vigente_desde: string | null;
  precio_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
};

// Precio vigente por producto (incluye productos sin precio: precio = null).
// El LATERAL toma, por producto, la fila de mayor vigente_desde <= hoy (cualquier
// proveedor; empata por id desc). Se une proveedores para mostrar de quién es.
export async function listarPreciosVigentes(): Promise<FilaPrecioVigente[]> {
  const res = await db.execute<FilaPrecioVigente>(
    sql`SELECT
          p.codigo_3c AS producto_3c,
          p.nombre AS producto_nombre,
          p.unidad_base AS unidad_base,
          v.precio AS precio,
          v.vigente_desde::text AS vigente_desde,
          v.id AS precio_id,
          prov.nombre AS proveedor_nombre,
          prov.numero_3c AS proveedor_numero_3c
        FROM productos p
        LEFT JOIN LATERAL (
          SELECT id, precio, vigente_desde, proveedor_id
          FROM precios
          -- precio > 0: un 0 es placeholder de "sin precio real" (decisión de J),
          -- así que el vigente es el último precio REAL; si no hay, queda sin precio.
          WHERE producto_3c = p.codigo_3c AND vigente_desde <= current_date AND precio > 0
          ORDER BY vigente_desde DESC, id DESC
          LIMIT 1
        ) v ON TRUE
        LEFT JOIN proveedores prov ON prov.id = v.proveedor_id
        WHERE p.activo = true
        ORDER BY p.nombre`,
  );
  return res.rows;
}

export interface FilaPrecioHistorial {
  id: number;
  precio: string;
  vigente_desde: string;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
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
      proveedor_id: precios.proveedorId,
      proveedor_nombre: proveedores.nombre,
      proveedor_numero_3c: proveedores.numero3c,
      usuario_id: precios.usuarioId,
      creado_en: sql<string>`${precios.creadoEn}::text`,
    })
    .from(precios)
    .leftJoin(proveedores, eq(proveedores.id, precios.proveedorId))
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
  proveedor_id: number | null;
  precio: string;
  vigente_desde: string;
  usuario_id: number;
  creado_en: string;
}

const selectPrecio = {
  id: precios.id,
  producto_3c: precios.producto3c,
  proveedor_id: precios.proveedorId,
  precio: precios.precio,
  vigente_desde: precios.vigenteDesde,
  usuario_id: precios.usuarioId,
  creado_en: sql<string>`${precios.creadoEn}::text`,
};

export async function insertarPrecio(datos: {
  producto3c: string;
  proveedorId?: number | null;
  precio: number;
  vigenteDesde: string;
  usuarioId: number;
}): Promise<PrecioRow> {
  const [row] = await db
    .insert(precios)
    .values({
      producto3c: datos.producto3c,
      proveedorId: datos.proveedorId ?? null,
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

// Evita cargar dos precios con la MISMA (proveedor, fecha) para un producto. Varios
// proveedores pueden tener precio el mismo día; lo que no se permite es duplicar la
// misma terna. exceptoId ignora la fila que se está editando.
export async function existePrecioEnFecha(
  producto3c: string,
  proveedorId: number | null,
  vigenteDesde: string,
  exceptoId?: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: precios.id, proveedorId: precios.proveedorId })
    .from(precios)
    .where(and(eq(precios.producto3c, producto3c), eq(precios.vigenteDesde, vigenteDesde)));
  return rows.some((r) => (r.proveedorId ?? null) === proveedorId && r.id !== exceptoId);
}
