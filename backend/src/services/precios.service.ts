import { conflict, notFound } from '../domain/errors.js';
import { obtenerValorizacion, type Valorizacion } from '../repositories/valorizacion.repository.js';
import type { CrearPrecioInput, EditarPrecioInput } from '../domain/precios.schema.js';
import {
  actualizarPrecio,
  borrarPrecio,
  existePrecioEnFecha,
  existeProducto,
  insertarPrecio,
  listarHistorialPrecios,
  listarPreciosVigentes,
  obtenerPrecioPorId,
  type FilaPrecioHistorial,
  type FilaPrecioVigente,
  type PrecioRow,
} from '../repositories/precios.repository.js';

// Fecha local YYYY-MM-DD (default de vigente_desde si no la mandan).
function hoyYmd(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// GET — precio vigente por producto (incluye productos sin precio cargado).
export const obtenerPreciosVigentes = (): Promise<FilaPrecioVigente[]> => listarPreciosVigentes();

// GET — historial completo de un producto (alimenta el gráfico de evolución).
export async function obtenerHistorialPrecios(producto3c: string): Promise<FilaPrecioHistorial[]> {
  if (!(await existeProducto(producto3c))) {
    throw notFound('PRODUCTO_NO_ENCONTRADO', `No existe el producto ${producto3c}`);
  }
  return listarHistorialPrecios(producto3c);
}

// POST — cargar un precio nuevo (con fecha de vigencia). Audita al usuario.
export async function crearPrecio(input: CrearPrecioInput, ctx: { usuarioId: number }): Promise<PrecioRow> {
  if (!(await existeProducto(input.producto_3c))) {
    throw notFound('PRODUCTO_NO_ENCONTRADO', `No existe el producto ${input.producto_3c}`);
  }
  const vigenteDesde = input.vigente_desde ?? hoyYmd();
  // Carga manual desde la UI: sin proveedor (null) y como COMPRA (precio que se paga →
  // pasa a ser el vigente).
  if (await existePrecioEnFecha(input.producto_3c, null, vigenteDesde, 'COMPRA')) {
    throw conflict('PRECIO_DUPLICADO', `Ya hay un precio para ${input.producto_3c} con vigencia ${vigenteDesde}`);
  }
  return insertarPrecio({
    producto3c: input.producto_3c,
    precio: input.precio,
    tipo: 'COMPRA',
    vigenteDesde,
    usuarioId: ctx.usuarioId,
  });
}

// PUT — corregir un precio ya cargado (monto y/o fecha).
export async function editarPrecio(id: number, input: EditarPrecioInput): Promise<PrecioRow> {
  const actual = await obtenerPrecioPorId(id);
  if (!actual) throw notFound('PRECIO_NO_ENCONTRADO', `No existe el precio ${id}`);

  const nuevaFecha = input.vigente_desde ?? actual.vigente_desde;
  if (
    input.vigente_desde &&
    (await existePrecioEnFecha(actual.producto_3c, actual.proveedor_id, nuevaFecha, actual.tipo, id))
  ) {
    throw conflict('PRECIO_DUPLICADO', `Ya hay otro precio para ${actual.producto_3c} con vigencia ${nuevaFecha}`);
  }

  const row = await actualizarPrecio(id, { precio: input.precio, vigenteDesde: input.vigente_desde });
  if (!row) throw notFound('PRECIO_NO_ENCONTRADO', `No existe el precio ${id}`);
  return row;
}

// DELETE — borrar un precio mal cargado.
export async function eliminarPrecio(id: number): Promise<void> {
  const ok = await borrarPrecio(id);
  if (!ok) throw notFound('PRECIO_NO_ENCONTRADO', `No existe el precio ${id}`);
}

// GET — valorización del stock (cantidad × precio vigente). topN top productos.
export const obtenerValorizacionStock = (topN = 15): Promise<Valorizacion> => obtenerValorizacion(topN);
