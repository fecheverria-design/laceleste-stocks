import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { inventarioLineas, inventarios, movimientos, productos, ubicaciones } from '../db/schema.js';
import { insertarDetalle } from './movimientos.repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Inventarios (conteo físico → AJUSTE contra balde 101). El acceso a DB vive acá;
// la lógica (delta, entrada/salida) en el service. Reusa insertarDetalle y (vía el
// service) generarNro/refrescarStock/tipoPorCodigo de movimientos.
// ─────────────────────────────────────────────────────────────────────────────

export const DEP_AJUSTES = 101; // balde virtual de AJUSTES (contrapartida, no lleva stock)

// Ubicación por id interno (para validar el depósito del inventario).
export async function obtenerUbicacionPorId(
  id: number,
): Promise<{ id: number; nombre: string; dep_id_3c: number; lleva_stock: boolean } | undefined> {
  const [row] = await db
    .select({ id: ubicaciones.id, nombre: ubicaciones.nombre, dep_id_3c: ubicaciones.depId3c, lleva_stock: ubicaciones.llevaStock })
    .from(ubicaciones)
    .where(eq(ubicaciones.id, id))
    .limit(1);
  return row;
}

// Unidad base de un producto (para agregar un renglón a la hoja). undefined si no existe.
export async function obtenerUnidadProducto(producto3c: string): Promise<string | undefined> {
  const [row] = await db
    .select({ unidad: productos.unidadBase })
    .from(productos)
    .where(eq(productos.codigo3c, producto3c))
    .limit(1);
  return row?.unidad;
}

export interface ProductoFamilia {
  producto3c: string;
  unidad: string;
}

// Productos activos de las familias pedidas (arma la hoja). Orden por nombre.
export async function productosDeFamilias(familias: string[]): Promise<ProductoFamilia[]> {
  if (familias.length === 0) return [];
  const rows = await db
    .select({ producto3c: productos.codigo3c, unidad: productos.unidadBase })
    .from(productos)
    .where(and(eq(productos.activo, true), inArray(productos.familia, familias)))
    .orderBy(asc(productos.nombre));
  return rows.map((r) => ({ producto3c: r.producto3c, unidad: r.unidad }));
}

export async function crearCabecera(
  tx: Tx,
  datos: { ubicacionId: number; fecha: string; familias: string[]; usuarioId: number; observaciones?: string },
): Promise<number> {
  const [row] = await tx
    .insert(inventarios)
    .values({
      ubicacionId: datos.ubicacionId,
      fecha: datos.fecha,
      familias: datos.familias,
      usuarioId: datos.usuarioId,
      observaciones: datos.observaciones ?? null,
    })
    .returning({ id: inventarios.id });
  if (!row) throw new Error('No se pudo crear el inventario');
  return row.id;
}

export async function insertarLineas(
  tx: Tx,
  inventarioId: number,
  lineas: ProductoFamilia[],
): Promise<void> {
  if (lineas.length === 0) return;
  for (let i = 0; i < lineas.length; i += 500) {
    await tx
      .insert(inventarioLineas)
      .values(
        lineas.slice(i, i + 500).map((l) => ({
          inventarioId,
          producto3c: l.producto3c,
          unidad: l.unidad,
        })),
      )
      .onConflictDoNothing({ target: [inventarioLineas.inventarioId, inventarioLineas.producto3c] });
  }
}

export type InventarioResumen = {
  id: number;
  ubicacion_id: number;
  ubicacion_nombre: string;
  fecha: string;
  estado: string;
  lineas: number;
  contadas: number;
  creado_en: string | null;
  confirmado_en: string | null;
}

export async function listarInventarios(): Promise<InventarioResumen[]> {
  const res = await db.execute<InventarioResumen>(
    sql`SELECT inv.id, inv.ubicacion_id, u.nombre AS ubicacion_nombre, inv.fecha::text AS fecha,
               inv.estado,
               count(l.id)::int AS lineas,
               count(l.cantidad_contada)::int AS contadas,
               inv.creado_en::text AS creado_en, inv.confirmado_en::text AS confirmado_en
        FROM inventarios inv
        JOIN ubicaciones u ON u.id = inv.ubicacion_id
        LEFT JOIN inventario_lineas l ON l.inventario_id = inv.id
        GROUP BY inv.id, u.nombre
        ORDER BY inv.fecha DESC, inv.id DESC`,
  );
  return res.rows;
}

export type InventarioCabecera = {
  id: number;
  ubicacion_id: number;
  ubicacion_nombre: string;
  ubicacion_dep_id_3c: number;
  fecha: string;
  estado: string;
  familias: string[] | null;
  observaciones: string | null;
  confirmado_en: string | null;
  movimiento_entrada_id: number | null;
  movimiento_salida_id: number | null;
}

export async function obtenerCabecera(ejecutor: typeof db | Tx, id: number): Promise<InventarioCabecera | undefined> {
  const res = await ejecutor.execute<InventarioCabecera>(
    sql`SELECT inv.id, inv.ubicacion_id, u.nombre AS ubicacion_nombre, u.dep_id_3c AS ubicacion_dep_id_3c,
               inv.fecha::text AS fecha, inv.estado, inv.familias, inv.observaciones,
               inv.confirmado_en::text AS confirmado_en,
               inv.movimiento_entrada_id, inv.movimiento_salida_id
        FROM inventarios inv
        JOIN ubicaciones u ON u.id = inv.ubicacion_id
        WHERE inv.id = ${id}`,
  );
  return res.rows[0];
}

// Bloquea la cabecera para confirmar (serializa dos confirmaciones simultáneas).
export async function bloquearInventario(tx: Tx, id: number): Promise<{ id: number; estado: string; ubicacion_id: number; fecha: string } | undefined> {
  const res = await tx.execute<{ id: number; estado: string; ubicacion_id: number; fecha: string }>(
    sql`SELECT id, estado, ubicacion_id, fecha::text AS fecha FROM inventarios WHERE id = ${id} FOR UPDATE`,
  );
  return res.rows[0];
}

export type LineaDetalle = {
  producto_3c: string;
  nombre: string;
  familia: string | null;
  subfamilia: string | null;
  unidad: string;
  presentacion_compra: string | null;
  unidades_por_bulto: string | null; // factor para contar en bultos (null/1 = suelto)
  cantidad_contada: string | null;
  stock_sistema: string; // del stock_actual para la ubicación del inventario (0 si no hay)
}

// Renglones de la hoja con el stock VIVO del sistema (para mostrar diferencia y %).
export async function lineasDetalle(inventarioId: number, ubicacionId: number): Promise<LineaDetalle[]> {
  const res = await db.execute<LineaDetalle>(
    sql`SELECT l.producto_3c, p.nombre, p.familia, p.subfamilia, l.unidad,
               p.presentacion_compra, p.unidades_por_bulto::text AS unidades_por_bulto,
               l.cantidad_contada::text AS cantidad_contada,
               COALESCE(s.cantidad, 0)::text AS stock_sistema
        FROM inventario_lineas l
        JOIN productos p ON p.codigo_3c = l.producto_3c
        LEFT JOIN stock_actual s ON s.producto_3c = l.producto_3c AND s.ubicacion_id = ${ubicacionId}
        WHERE l.inventario_id = ${inventarioId}
        ORDER BY p.familia NULLS LAST, p.nombre`,
  );
  return res.rows;
}

// Guarda las cantidades contadas (una pasada por renglón). Solo toca los productos enviados.
export async function guardarContadas(
  inventarioId: number,
  lineas: { producto3c: string; cantidadContada: number | null }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const l of lineas) {
      await tx
        .update(inventarioLineas)
        .set({ cantidadContada: l.cantidadContada === null ? null : l.cantidadContada.toString() })
        .where(and(eq(inventarioLineas.inventarioId, inventarioId), eq(inventarioLineas.producto3c, l.producto3c)));
    }
  });
}

export async function agregarLinea(inventarioId: number, producto3c: string, unidad: string): Promise<void> {
  await db
    .insert(inventarioLineas)
    .values({ inventarioId, producto3c, unidad })
    .onConflictDoNothing({ target: [inventarioLineas.inventarioId, inventarioLineas.producto3c] });
}

export async function borrarInventario(id: number): Promise<void> {
  await db.delete(inventarios).where(eq(inventarios.id, id));
}

// Stock vivo del depósito → Map producto_3c → cantidad (número). Lee dentro de la tx.
export async function stockPorUbicacion(tx: Tx, ubicacionId: number): Promise<Map<string, number>> {
  const res = await tx.execute<{ producto_3c: string; cantidad: string }>(
    sql`SELECT producto_3c, cantidad FROM stock_actual WHERE ubicacion_id = ${ubicacionId}`,
  );
  const m = new Map<string, number>();
  for (const r of res.rows) m.set(r.producto_3c, Number(r.cantidad));
  return m;
}

// Asegura el balde 101 (AJUSTES) y devuelve su ubicacion_id.
export async function asegurarBalde101(tx: Tx): Promise<number> {
  const [existe] = await tx
    .select({ id: ubicaciones.id })
    .from(ubicaciones)
    .where(eq(ubicaciones.depId3c, DEP_AJUSTES))
    .limit(1);
  if (existe) return existe.id;
  const [creado] = await tx
    .insert(ubicaciones)
    .values({ nombre: 'AJUSTES', tipo: 'DEPOSITO', depId3c: DEP_AJUSTES, llevaStock: false })
    .returning({ id: ubicaciones.id });
  if (!creado) throw new Error('No se pudo asegurar el balde de AJUSTES (101)');
  return creado.id;
}

// Crea un AJUSTE CONFIRMADO (cabecera + detalle) dentro de la tx. Devuelve su id.
export async function crearAjuste(
  tx: Tx,
  datos: {
    nro: string;
    tipoId: number;
    fecha: string;
    origenId: number;
    destinoId: number;
    usuarioId: number;
    observaciones: string;
    renglones: { producto3c: string; cantidadReal: string; unidad: string }[];
  },
): Promise<number> {
  const [cab] = await tx
    .insert(movimientos)
    .values({
      nro: datos.nro,
      tipoId: datos.tipoId,
      fecha: datos.fecha,
      hora: '00:00:00',
      origenId: datos.origenId,
      destinoId: datos.destinoId,
      estado: 'CONFIRMADO',
      usuarioId: datos.usuarioId,
      observaciones: datos.observaciones,
      confirmadoEn: sql`now()`,
    })
    .returning({ id: movimientos.id });
  if (!cab) throw new Error('No se pudo crear el AJUSTE del inventario');
  await insertarDetalle(tx, cab.id, datos.renglones);
  return cab.id;
}

export async function marcarConfirmado(
  tx: Tx,
  id: number,
  datos: { usuarioId: number; movEntradaId: number | null; movSalidaId: number | null },
): Promise<void> {
  await tx
    .update(inventarios)
    .set({
      estado: 'CONFIRMADO',
      confirmadoEn: sql`now()`,
      confirmadoPor: datos.usuarioId,
      movimientoEntradaId: datos.movEntradaId,
      movimientoSalidaId: datos.movSalidaId,
    })
    .where(eq(inventarios.id, id));
}
