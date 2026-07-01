import { db } from '../db/client.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import type { CrearInventarioInput, GuardarLineasInput } from '../domain/inventarios.schema.js';
import { generarNro, refrescarStock, tipoPorCodigo } from '../repositories/movimientos.repository.js';
import {
  agregarLinea as repoAgregarLinea,
  asegurarBalde101,
  bloquearInventario,
  borrarInventario,
  crearAjuste,
  crearCabecera,
  guardarContadas,
  insertarLineas,
  lineasDetalle,
  listarInventarios,
  marcarConfirmado,
  obtenerCabecera,
  obtenerUbicacionPorId,
  obtenerUnidadProducto,
  productosDeFamilias,
  stockPorUbicacion,
  type InventarioCabecera,
  type InventarioResumen,
} from '../repositories/inventarios.repository.js';

// Familias de INSUMOS que se cuentan el fin de semana (default de la hoja).
export const FAMILIAS_INSUMOS = ['PACKAGING', 'MATERIAS PRIMAS', 'DESCARTABLES', 'LIMPIEZA', 'MERCHANDISING'];

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface LineaInventario {
  producto_3c: string;
  nombre: string;
  familia: string | null;
  subfamilia: string | null;
  unidad: string;
  stock_sistema: number;
  cantidad_contada: number | null;
  diferencia: number | null; // contado − sistema (null si no se contó)
  porcentaje: number | null; // diferencia / sistema * 100 (null si no se contó o sistema=0)
}

export interface InventarioDetalle extends InventarioCabecera {
  lineas: LineaInventario[];
}

// Arma las líneas con stock vivo + diferencia/%.
async function armarDetalle(cab: InventarioCabecera): Promise<InventarioDetalle> {
  const filas = await lineasDetalle(cab.id, cab.ubicacion_id);
  const lineas: LineaInventario[] = filas.map((f) => {
    const sistema = Number(f.stock_sistema);
    const contada = f.cantidad_contada === null ? null : Number(f.cantidad_contada);
    const diferencia = contada === null ? null : round3(contada - sistema);
    const porcentaje =
      contada === null || sistema === 0 ? null : round3(((contada - sistema) / sistema) * 100);
    return {
      producto_3c: f.producto_3c,
      nombre: f.nombre,
      familia: f.familia,
      subfamilia: f.subfamilia,
      unidad: f.unidad,
      stock_sistema: sistema,
      cantidad_contada: contada,
      diferencia,
      porcentaje,
    };
  });
  return { ...cab, lineas };
}

export const obtenerInventarios = (): Promise<InventarioResumen[]> => listarInventarios();

export async function obtenerInventarioDetalle(id: number): Promise<InventarioDetalle> {
  const cab = await obtenerCabecera(db, id);
  if (!cab) throw notFound('INVENTARIO_NO_ENCONTRADO', `No existe el inventario id=${id}`);
  return armarDetalle(cab);
}

// Crea una hoja BORRADOR para (depósito, fecha) con una línea por producto de las
// familias pedidas (default: las 5 de insumos). Solo depósitos que llevan stock.
export async function crearInventario(input: CrearInventarioInput, usuarioId: number): Promise<InventarioDetalle> {
  const ubic = await obtenerUbicacionPorId(input.ubicacion_id);
  if (!ubic) throw notFound('UBICACION_NO_ENCONTRADA', `No existe la ubicación id=${input.ubicacion_id}`);
  if (!ubic.lleva_stock) {
    throw badRequest('UBICACION_SIN_STOCK', `La ubicación "${ubic.nombre}" no lleva stock: no se inventaría acá`);
  }

  const familias = (input.familias && input.familias.length > 0 ? input.familias : FAMILIAS_INSUMOS).map((f) =>
    f.trim().toUpperCase(),
  );
  const prods = await productosDeFamilias(familias);
  if (prods.length === 0) {
    throw badRequest('SIN_PRODUCTOS', `No hay productos activos en esas familias: ${familias.join(', ')}`);
  }

  const id = await db.transaction(async (tx) => {
    const invId = await crearCabecera(tx, {
      ubicacionId: input.ubicacion_id,
      fecha: input.fecha,
      familias,
      usuarioId,
      observaciones: input.observaciones,
    });
    await insertarLineas(tx, invId, prods);
    return invId;
  });

  return obtenerInventarioDetalle(id);
}

// Guarda avances del conteo (solo en BORRADOR). No confirma nada.
export async function guardarLineas(id: number, input: GuardarLineasInput): Promise<InventarioDetalle> {
  const cab = await obtenerCabecera(db, id);
  if (!cab) throw notFound('INVENTARIO_NO_ENCONTRADO', `No existe el inventario id=${id}`);
  if (cab.estado !== 'BORRADOR') {
    throw conflict('INVENTARIO_NO_EDITABLE', `El inventario está ${cab.estado}: no se puede editar`);
  }
  await guardarContadas(
    id,
    input.lineas.map((l) => ({ producto3c: l.producto_3c, cantidadContada: l.cantidad_contada })),
  );
  return obtenerInventarioDetalle(id);
}

// Agrega un producto a la hoja (contaron algo fuera de las familias). Solo BORRADOR.
export async function agregarLineaInventario(id: number, producto3c: string): Promise<InventarioDetalle> {
  const cab = await obtenerCabecera(db, id);
  if (!cab) throw notFound('INVENTARIO_NO_ENCONTRADO', `No existe el inventario id=${id}`);
  if (cab.estado !== 'BORRADOR') {
    throw conflict('INVENTARIO_NO_EDITABLE', `El inventario está ${cab.estado}: no se puede editar`);
  }
  const unidad = await obtenerUnidadProducto(producto3c);
  if (unidad === undefined) throw notFound('PRODUCTO_NO_ENCONTRADO', `No existe el producto ${producto3c}`);
  await repoAgregarLinea(id, producto3c, unidad);
  return obtenerInventarioDetalle(id);
}

// Descarta un inventario en BORRADOR (borra la hoja y sus líneas).
export async function eliminarInventario(id: number): Promise<void> {
  const cab = await obtenerCabecera(db, id);
  if (!cab) throw notFound('INVENTARIO_NO_ENCONTRADO', `No existe el inventario id=${id}`);
  if (cab.estado !== 'BORRADOR') {
    throw conflict('INVENTARIO_NO_EDITABLE', `Solo se descarta un inventario en BORRADOR (está ${cab.estado})`);
  }
  await borrarInventario(id);
}

export interface ResultadoConfirmacion {
  inventario: InventarioDetalle;
  resumen: {
    entrada_nro: string | null; // AJUSTE que SUMA (faltaba stock: contado > sistema)
    salida_nro: string | null; // AJUSTE que RESTA (sobraba: contado < sistema)
    renglones_entrada: number;
    renglones_salida: number;
    sin_cambio: number; // contados que ya coincidían
    sin_contar: number; // líneas sin cantidad (se saltean)
  };
}

// Confirma el inventario (regla #6, transaccional): por cada línea CONTADA con diferencia,
// genera un AJUSTE contra el balde 101 para dejar el stock exacto en lo contado (regla #5:
// mueve stock → con tests). delta = contado − sistema(vivo). delta>0 → entrada (101→dep);
// delta<0 → salida (dep→101). Líneas sin contar se SALTEAN (no se ponen en 0). El resumen
// se calcula DENTRO de la tx (antes del refresh) porque después las diferencias son 0.
export async function confirmarInventario(id: number, usuarioId: number): Promise<ResultadoConfirmacion> {
  const resumen = await db.transaction(async (tx): Promise<ResultadoConfirmacion['resumen']> => {
    const inv = await bloquearInventario(tx, id);
    if (!inv) throw notFound('INVENTARIO_NO_ENCONTRADO', `No existe el inventario id=${id}`);
    if (inv.estado !== 'BORRADOR') {
      throw conflict('INVENTARIO_YA_CONFIRMADO', `El inventario id=${id} ya está ${inv.estado}`);
    }

    const filas = await lineasDetalle(id, inv.ubicacion_id);
    const stock = await stockPorUbicacion(tx, inv.ubicacion_id);

    const entradas: { producto3c: string; cantidadReal: string; unidad: string }[] = [];
    const salidas: { producto3c: string; cantidadReal: string; unidad: string }[] = [];
    let sinCambio = 0;
    let sinContar = 0;
    for (const f of filas) {
      if (f.cantidad_contada === null) {
        sinContar++;
        continue; // sin contar → se saltea (no se pone en 0)
      }
      const sistema = stock.get(f.producto_3c) ?? 0;
      const delta = round3(Number(f.cantidad_contada) - sistema);
      if (Math.abs(delta) < 0.0005) sinCambio++;
      else if (delta > 0) entradas.push({ producto3c: f.producto_3c, cantidadReal: String(delta), unidad: f.unidad });
      else salidas.push({ producto3c: f.producto_3c, cantidadReal: String(-delta), unidad: f.unidad });
    }

    let movEntradaId: number | null = null;
    let movSalidaId: number | null = null;
    let entradaNro: string | null = null;
    let salidaNro: string | null = null;

    if (entradas.length > 0 || salidas.length > 0) {
      const tipo = await tipoPorCodigo(tx, 'AJUSTE');
      if (!tipo) throw new Error('Falta el tipo AJUSTE en tipos_movimiento (corré el seed)');
      const balde = await asegurarBalde101(tx);
      const anio = Number(inv.fecha.slice(0, 4));
      const obs = `Inventario #${id} (${inv.fecha})`;

      if (entradas.length > 0) {
        entradaNro = await generarNro(tx, 'AJUSTE', anio);
        movEntradaId = await crearAjuste(tx, {
          nro: entradaNro,
          tipoId: tipo.id,
          fecha: inv.fecha,
          origenId: balde,
          destinoId: inv.ubicacion_id,
          usuarioId,
          observaciones: `${obs} (entrada)`,
          renglones: entradas,
        });
      }
      if (salidas.length > 0) {
        salidaNro = await generarNro(tx, 'AJUSTE', anio);
        movSalidaId = await crearAjuste(tx, {
          nro: salidaNro,
          tipoId: tipo.id,
          fecha: inv.fecha,
          origenId: inv.ubicacion_id,
          destinoId: balde,
          usuarioId,
          observaciones: `${obs} (salida)`,
          renglones: salidas,
        });
      }
      await refrescarStock(tx);
    }

    await marcarConfirmado(tx, id, { usuarioId, movEntradaId, movSalidaId });

    return {
      entrada_nro: entradaNro,
      salida_nro: salidaNro,
      renglones_entrada: entradas.length,
      renglones_salida: salidas.length,
      sin_cambio: sinCambio,
      sin_contar: sinContar,
    };
  });

  // Detalle final (ya con el stock reconciliado: las diferencias quedan en 0).
  const inventario = await obtenerInventarioDetalle(id);
  return { inventario, resumen };
}
