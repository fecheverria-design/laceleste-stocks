import { listarProductos, listarTipos, listarUbicaciones } from '../repositories/catalogos.repository.js';

// Wrappers finos: los catálogos no tienen lógica de negocio, solo lectura.
export const obtenerUbicaciones = (): ReturnType<typeof listarUbicaciones> => listarUbicaciones();
export const obtenerProductos = (): ReturnType<typeof listarProductos> => listarProductos();
export const obtenerTipos = (): ReturnType<typeof listarTipos> => listarTipos();
