import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { productos, tiposMovimiento, ubicaciones } from '../db/schema.js';

// Catálogos para poblar selects del front (ubicaciones, productos, tipos).

export async function listarUbicaciones() {
  return db
    .select({
      id: ubicaciones.id,
      nombre: ubicaciones.nombre,
      tipo: ubicaciones.tipo,
      dep_id_3c: ubicaciones.depId3c,
    })
    .from(ubicaciones)
    .where(eq(ubicaciones.activo, true))
    .orderBy(ubicaciones.nombre);
}

export async function listarProductos() {
  return db
    .select({
      codigo_3c: productos.codigo3c,
      nombre: productos.nombre,
      unidad_base: productos.unidadBase,
      // Info de referencia que el front muestra al elegir el producto en un renglón.
      familia: productos.familia,
      subfamilia: productos.subfamilia,
      presentacion_compra: productos.presentacionCompra,
      unidades_por_bulto: productos.unidadesPorBulto,
    })
    .from(productos)
    .where(eq(productos.activo, true))
    .orderBy(productos.nombre);
}

export async function listarTipos() {
  return db
    .select({
      codigo: tiposMovimiento.codigo,
      nombre: tiposMovimiento.nombre,
      signo_stock: tiposMovimiento.signoStock,
    })
    .from(tiposMovimiento)
    .orderBy(tiposMovimiento.codigo);
}
