import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { productos } from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Maestro de artículos (tabla productos). Lecturas ricas para la pantalla de
// Artículos + alta con código propio (continúa la numeración de 3c) y edición.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaArticulo {
  codigo_3c: string;
  nombre: string;
  unidad_base: string;
  familia: string | null;
  subfamilia: string | null;
  activo: boolean;
  creado_local: boolean;
}

export interface ArticulosFiltros {
  q?: string;
  familia?: string;
  activo?: boolean;
}

function condiciones(f: ArticulosFiltros) {
  const conds = [];
  if (f.q) conds.push(or(ilike(productos.nombre, `%${f.q}%`), ilike(productos.codigo3c, `%${f.q}%`)));
  if (f.familia) conds.push(eq(productos.familia, f.familia));
  if (f.activo !== undefined) conds.push(eq(productos.activo, f.activo));
  return conds;
}

const COLS = {
  codigo_3c: productos.codigo3c,
  nombre: productos.nombre,
  unidad_base: productos.unidadBase,
  familia: productos.familia,
  subfamilia: productos.subfamilia,
  activo: productos.activo,
  creado_local: productos.creadoLocal,
};

export async function listarArticulos(f: ArticulosFiltros, page: number, limit: number): Promise<FilaArticulo[]> {
  const conds = condiciones(f);
  return db
    .select(COLS)
    .from(productos)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(productos.nombre))
    .limit(limit)
    .offset((page - 1) * limit);
}

export async function contarArticulos(f: ArticulosFiltros): Promise<number> {
  const conds = condiciones(f);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productos)
    .where(conds.length ? and(...conds) : undefined);
  return row?.n ?? 0;
}

export async function obtenerArticulo(codigo3c: string): Promise<FilaArticulo | undefined> {
  const [row] = await db.select(COLS).from(productos).where(eq(productos.codigo3c, codigo3c)).limit(1);
  return row;
}

// Familias distintas cargadas (para el filtro de la pantalla y el arranque del inventario).
export async function listarFamiliasArticulos(): Promise<string[]> {
  const res = await db.execute<{ familia: string }>(
    sql`SELECT DISTINCT familia FROM productos WHERE familia IS NOT NULL ORDER BY familia`,
  );
  return res.rows.map((r) => r.familia);
}

// Genera el próximo código propio = max(codigo_3c numérico) + 1, DENTRO de la tx y con
// advisory lock para serializar altas concurrentes (dos altas simultáneas no toman el
// mismo número). "Continúa la numeración" de 3c y se adapta si entran códigos nuevos por
// import (siempre mira el max actual). Todos los códigos hoy son numéricos.
export async function generarCodigoArticulo(tx: Tx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('articulos_codigo'))`);
  const res = await tx.execute<{ next: string }>(
    sql`SELECT COALESCE(MAX(codigo_3c::bigint), 0) + 1 AS next
        FROM productos WHERE codigo_3c ~ '^[0-9]+$'`,
  );
  const next = res.rows[0]?.next;
  if (next === undefined) throw new Error('No se pudo generar el código del artículo');
  return String(next);
}

export async function insertarArticulo(
  tx: Tx,
  datos: {
    codigo3c: string;
    nombre: string;
    unidadBase: string;
    familia: string | null;
    subfamilia: string | null;
    creadoLocal: boolean;
  },
): Promise<FilaArticulo> {
  const [row] = await tx
    .insert(productos)
    .values({
      codigo3c: datos.codigo3c,
      nombre: datos.nombre,
      unidadBase: datos.unidadBase,
      familia: datos.familia,
      subfamilia: datos.subfamilia,
      creadoLocal: datos.creadoLocal,
    })
    .returning(COLS);
  if (!row) throw new Error('No se pudo crear el artículo');
  return row;
}

export async function actualizarArticulo(
  codigo3c: string,
  datos: { nombre: string; unidadBase: string; familia: string | null; subfamilia: string | null; activo?: boolean },
): Promise<FilaArticulo | undefined> {
  const [row] = await db
    .update(productos)
    .set({
      nombre: datos.nombre,
      unidadBase: datos.unidadBase,
      familia: datos.familia,
      subfamilia: datos.subfamilia,
      ...(datos.activo === undefined ? {} : { activo: datos.activo }),
    })
    .where(eq(productos.codigo3c, codigo3c))
    .returning(COLS);
  return row;
}
