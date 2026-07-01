import { db } from '../db/client.js';
import { notFound } from '../domain/errors.js';
import type { CrearArticuloInput, EditarArticuloInput } from '../domain/articulos.schema.js';
import {
  actualizarArticulo,
  contarArticulos,
  generarCodigoArticulo,
  insertarArticulo,
  listarArticulos,
  listarFamiliasArticulos,
  obtenerArticulo,
  type ArticulosFiltros,
  type FilaArticulo,
} from '../repositories/articulos.repository.js';

export interface ListarArticulosParams extends ArticulosFiltros {
  page: number;
  limit: number;
}

export interface ListaArticulosResult {
  items: FilaArticulo[];
  page: number;
  limit: number;
  total: number;
}

export async function obtenerArticulos(params: ListarArticulosParams): Promise<ListaArticulosResult> {
  const { page, limit, ...filtros } = params;
  const [items, total] = await Promise.all([listarArticulos(filtros, page, limit), contarArticulos(filtros)]);
  return { items, page, limit, total };
}

export const obtenerFamiliasArticulos = (): Promise<string[]> => listarFamiliasArticulos();

// Alta de artículo NUEVO (no está en 3c). El código se genera solo, continuando la
// numeración (regla #1 matizada por J), en una tx con lock → sin colisión de correlativo.
// Queda marcado creado_local = true para trazabilidad.
export async function crearArticulo(input: CrearArticuloInput): Promise<FilaArticulo> {
  return db.transaction(async (tx) => {
    const codigo3c = await generarCodigoArticulo(tx);
    return insertarArticulo(tx, {
      codigo3c,
      nombre: input.nombre,
      unidadBase: input.unidad_base,
      familia: input.familia,
      subfamilia: input.subfamilia,
      creadoLocal: true,
    });
  });
}

export async function editarArticulo(codigo3c: string, input: EditarArticuloInput): Promise<FilaArticulo> {
  const actualizado = await actualizarArticulo(codigo3c, {
    nombre: input.nombre,
    unidadBase: input.unidad_base,
    familia: input.familia,
    subfamilia: input.subfamilia,
    activo: input.activo,
  });
  if (!actualizado) throw notFound('ARTICULO_NO_ENCONTRADO', `No existe el artículo ${codigo3c}`);
  return actualizado;
}

export async function obtenerArticuloPorCodigo(codigo3c: string): Promise<FilaArticulo> {
  const art = await obtenerArticulo(codigo3c);
  if (!art) throw notFound('ARTICULO_NO_ENCONTRADO', `No existe el artículo ${codigo3c}`);
  return art;
}
