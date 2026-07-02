import { conflict } from '../domain/errors.js';
import type { CrearProveedorInput } from '../domain/proveedores.schema.js';
import {
  existeNumero3c,
  gastoMensual,
  gastoPorProveedorFamilia,
  insertarProveedor,
  listarFamilias,
  listarProveedores,
  productosPorProveedor,
  type FilaProveedor,
  type FiltrosGasto,
  type GastoMes,
  type GastoProveedor,
  type ProductoDeProveedor,
} from '../repositories/proveedores.repository.js';

export const obtenerProveedores = (filtros?: FiltrosGasto): Promise<FilaProveedor[]> =>
  listarProveedores(filtros);
export const obtenerFamilias = (): Promise<string[]> => listarFamilias();

export const obtenerProductosProveedor = (id: number, filtros?: FiltrosGasto): Promise<ProductoDeProveedor[]> =>
  productosPorProveedor(id, filtros);

export const obtenerGastoProveedores = (filtros: {
  familia?: string;
  desde?: string;
  hasta?: string;
}): Promise<GastoProveedor[]> => gastoPorProveedorFamilia(filtros);

export const obtenerGastoMensual = (filtros: {
  familia?: string;
  desde?: string;
  hasta?: string;
}): Promise<GastoMes[]> => gastoMensual(filtros);

export async function crearProveedor(input: CrearProveedorInput): Promise<{
  id: number;
  numero_3c: number | null;
  nombre: string;
  cuit: string | null;
}> {
  if (await existeNumero3c(input.numero_3c)) {
    throw conflict('PROVEEDOR_DUPLICADO', `Ya existe un proveedor con número 3c ${input.numero_3c}`);
  }
  return insertarProveedor({ numero3c: input.numero_3c, nombre: input.nombre, cuit: input.cuit });
}
