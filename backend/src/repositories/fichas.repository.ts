import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// Los datos que la ficha de cada hoja necesita para decir números de verdad. Una sola ida a
// la base: son todos conteos baratos y se piden juntos para no hacer ocho viajes.

export interface DatosFichas {
  productos: { total: number; conPrecio: number; creadosLocal: number };
  proveedores: number;
  stock: { filas: number; depositosConStock: number; ultimaFoto: string | null };
  precios: { filas: number; controlados: number };
  movimientos: { confirmados: number; desde: string | null; hasta: string | null; deTresC: number };
  /** Ventana que cubre el espejo de movimientos de 3c (el export semanal). */
  espejo3c: { desde: string | null; hasta: string | null; renglones: number };
  renglonesUltimoMes: number;
}

export async function datosFichas(): Promise<DatosFichas> {
  const res = await db.execute<{
    productos: number;
    con_precio: number;
    creados_local: number;
    proveedores: number;
    stock_filas: number;
    depositos_con_stock: number;
    ultima_foto: string | null;
    precios_filas: number;
    precios_controlados: number;
    movs: number;
    movs_desde: string | null;
    movs_hasta: string | null;
    movs_de_3c: number;
    espejo_desde: string | null;
    espejo_hasta: string | null;
    espejo_renglones: number;
    renglones_ultimo_mes: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM productos) AS productos,
      -- "con precio" = tiene al menos un precio mayor que cero; un 0 se trata como sin precio.
      (SELECT count(DISTINCT producto_3c)::int FROM precios WHERE precio > 0) AS con_precio,
      (SELECT count(*)::int FROM productos WHERE creado_local) AS creados_local,
      (SELECT count(*)::int FROM proveedores) AS proveedores,
      (SELECT count(*)::int FROM stock_actual) AS stock_filas,
      (SELECT count(*)::int FROM ubicaciones WHERE lleva_stock) AS depositos_con_stock,
      (SELECT to_char(max(confirmado_en), 'DD/MM/YYYY HH24:MI')
         FROM movimientos WHERE observaciones LIKE 'Foto 3c%' AND estado = 'CONFIRMADO') AS ultima_foto,
      (SELECT count(*)::int FROM precios) AS precios_filas,
      (SELECT count(*)::int FROM precios WHERE controlado_en IS NOT NULL) AS precios_controlados,
      (SELECT count(*)::int FROM movimientos WHERE estado = 'CONFIRMADO') AS movs,
      (SELECT to_char(min(fecha), 'DD/MM/YYYY') FROM movimientos WHERE estado = 'CONFIRMADO') AS movs_desde,
      (SELECT to_char(max(fecha), 'DD/MM/YYYY') FROM movimientos WHERE estado = 'CONFIRMADO') AS movs_hasta,
      (SELECT count(*)::int FROM movimientos WHERE estado = 'CONFIRMADO' AND nro_3c IS NOT NULL) AS movs_de_3c,
      (SELECT to_char(min(fecha), 'DD/MM/YYYY') FROM movimientos_3c WHERE tipo_doc = 'Rint') AS espejo_desde,
      (SELECT to_char(max(fecha), 'DD/MM/YYYY') FROM movimientos_3c WHERE tipo_doc = 'Rint') AS espejo_hasta,
      (SELECT count(*)::int FROM movimientos_3c WHERE tipo_doc = 'Rint') AS espejo_renglones,
      (SELECT count(*)::int FROM compras
        WHERE to_char(fecha, 'YYYY-MM') = (SELECT to_char(max(fecha), 'YYYY-MM') FROM compras)) AS renglones_ultimo_mes
  `);
  const r = res.rows[0];
  return {
    productos: { total: r?.productos ?? 0, conPrecio: r?.con_precio ?? 0, creadosLocal: r?.creados_local ?? 0 },
    proveedores: r?.proveedores ?? 0,
    stock: {
      filas: r?.stock_filas ?? 0,
      depositosConStock: r?.depositos_con_stock ?? 0,
      ultimaFoto: r?.ultima_foto ?? null,
    },
    precios: { filas: r?.precios_filas ?? 0, controlados: r?.precios_controlados ?? 0 },
    movimientos: {
      confirmados: r?.movs ?? 0,
      desde: r?.movs_desde ?? null,
      hasta: r?.movs_hasta ?? null,
      deTresC: r?.movs_de_3c ?? 0,
    },
    espejo3c: {
      desde: r?.espejo_desde ?? null,
      hasta: r?.espejo_hasta ?? null,
      renglones: r?.espejo_renglones ?? 0,
    },
    renglonesUltimoMes: r?.renglones_ultimo_mes ?? 0,
  };
}
