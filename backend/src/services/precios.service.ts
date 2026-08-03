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
  const tipo = input.tipo ?? 'COMPRA'; // default COMPRA (precio que se paga → vigente)
  const proveedorId = input.proveedor_id ?? null;
  if (await existePrecioEnFecha(input.producto_3c, proveedorId, vigenteDesde, tipo)) {
    throw conflict(
      'PRECIO_DUPLICADO',
      `Ya hay un precio (${tipo.toLowerCase()}) para ${input.producto_3c} de ese proveedor con fecha ${vigenteDesde}`,
    );
  }
  return insertarPrecio({
    producto3c: input.producto_3c,
    proveedorId,
    precio: input.precio,
    tipo,
    vigenteDesde,
    usuarioId: ctx.usuarioId,
  });
}

// PUT — corregir un precio ya cargado (monto, fecha y/o tipo).
export async function editarPrecio(id: number, input: EditarPrecioInput): Promise<PrecioRow> {
  const actual = await obtenerPrecioPorId(id);
  if (!actual) throw notFound('PRECIO_NO_ENCONTRADO', `No existe el precio ${id}`);

  const nuevaFecha = input.vigente_desde ?? actual.vigente_desde;
  const nuevoTipo = input.tipo ?? actual.tipo;
  const nuevoProveedor = input.proveedor_id !== undefined ? input.proveedor_id : actual.proveedor_id;
  // Si cambia fecha, tipo o proveedor, revisar que no choque con otro registro de esa clave.
  if (
    (input.vigente_desde || input.tipo || input.proveedor_id !== undefined) &&
    (await existePrecioEnFecha(actual.producto_3c, nuevoProveedor, nuevaFecha, nuevoTipo, id))
  ) {
    throw conflict(
      'PRECIO_DUPLICADO',
      `Ya hay otro precio (${nuevoTipo.toLowerCase()}) para ${actual.producto_3c} de ese proveedor con fecha ${nuevaFecha}`,
    );
  }

  const row = await actualizarPrecio(id, {
    precio: input.precio,
    tipo: input.tipo,
    vigenteDesde: input.vigente_desde,
    proveedorId: input.proveedor_id,
  });
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
