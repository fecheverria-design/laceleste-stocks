import { consumoPorArea, type FilaConsumo } from '../repositories/consumos.repository.js';

export interface ConsumoArea {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  area_id: number;
  area_dep_id_3c: number;
  area_nombre: string;
  total: number;
  promedio_semanal: number;
  renglones: number;
  precio_vigente: number | null; // null = producto sin precio
  costo: number | null; // total × precio_vigente
}

export interface Consumos {
  desde: string;
  hasta: string;
  semanas: number;
  costo_total: number; // suma de costos (ignora productos sin precio)
  items: ConsumoArea[];
}

// Semanas (con decimal) entre dos fechas inclusive, mínimo 1.
function semanasEntre(desde: string, hasta: string): number {
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
  return Math.max(1, dias / 7);
}

// Consumo por (producto, área) con promedio semanal sobre el período pedido.
export async function obtenerConsumos(filtros: {
  desde: string;
  hasta: string;
  producto3c?: string;
}): Promise<Consumos> {
  const semanas = semanasEntre(filtros.desde, filtros.hasta);
  const filas = await consumoPorArea(filtros);
  let costoTotal = 0;
  const items: ConsumoArea[] = filas.map((f: FilaConsumo) => {
    const total = Number(f.total);
    const precio = f.precio_vigente === null ? null : Number(f.precio_vigente);
    const costo = f.costo === null ? null : Math.round(Number(f.costo) * 100) / 100;
    if (costo !== null) costoTotal += costo;
    return {
      producto_3c: f.producto_3c,
      producto_nombre: f.producto_nombre,
      unidad_base: f.unidad_base,
      area_id: f.area_id,
      area_dep_id_3c: f.area_dep_id_3c,
      area_nombre: f.area_nombre,
      total,
      promedio_semanal: Math.round((total / semanas) * 1000) / 1000,
      renglones: f.renglones,
      precio_vigente: precio,
      costo,
    };
  });
  return {
    desde: filtros.desde,
    hasta: filtros.hasta,
    semanas: Math.round(semanas * 10) / 10,
    costo_total: Math.round(costoTotal * 100) / 100,
    items,
  };
}
