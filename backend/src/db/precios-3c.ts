import { eq, sql } from 'drizzle-orm';
import { db } from './client.js';
import { precios, productos, proveedores } from './schema.js';
import { interpretarPlanillaPrecios, type FilaPrecio } from './import-precios.js';

// PRECIOS DE LISTA desde 3c (V_PRECIOS_LA_CELESTE), para la fuente `precios` de sync:3c.
//
// La vista es una FOTO: una fila por (producto, proveedor) con el precio de lista actual y
// su ULTIMA_ACTUALIZACION. 3c pisa esa foto cada vez que alguien cambia el precio y NO guarda
// el histórico. Por eso se trae entera todos los días: cada fecha nueva queda como una fila
// más en `precios`, y la serie de precios de lista se construye sola.
//
// Todo entra como ACTUALIZACION, nunca como COMPRA: solo el tilde de J es COMPRA (regla del
// 2026-09-10, ver import-precios.ts). Así esto no toca ni el precio de compra ni el controlado,
// y en la prelación (repositories/precio-vigente.ts) solo manda para los productos que nunca
// tuvieron una compra.
//
// Lo que NO hace, a propósito:
//   · No pisa una fila CONTROLADA: si compras marcó esa actualización como EL precio, el sync
//     no le cambia el importe por debajo.
//   · No da de alta productos ni proveedores: eso es de las fuentes `productos` y
//     `proveedores`, que corren antes. Las filas que no matchean se saltean y se avisan.
//   · No borra nada: que un precio desaparezca de la foto no dice nada del historial.

export function queryPrecios(): string {
  // Los alias son los que ya entiende interpretarPlanillaPrecios. El nombre del proveedor
  // está en APELLIDO (NOMBRE viene vacío, igual que en LC_V_PROVEEDORES).
  return `SELECT
      ID,
      DENOMINACION,
      PRECIO,
      PERSONAS_ID,
      APELLIDO AS PROVEEDORES,
      TO_CHAR(ULTIMA_ACTUALIZACION, 'DD/MM/YYYY') AS FECHA,
      'ACTUALIZACION' AS TIPO
    FROM LACELESTE.V_PRECIOS_LA_CELESTE
    ORDER BY ID, PERSONAS_ID`;
}

/** Fila de `precios` ya existente con la misma clave (producto, proveedor, fecha). */
export interface ActualizacionExistente {
  precio: string;
  controlada: boolean;
}

export interface PlanPrecios {
  aEscribir: Array<{ producto3c: string; proveedorId: number; precio: string; vigenteDesde: string }>;
  nuevas: number;
  cambian: number;
  iguales: number;
  /** Mismo día pero otro importe, y la fila está controlada: no se toca. */
  controladas: number;
  /** Otro importe en una fecha vieja: es historial cargado por otro lado, no se toca. */
  difierenHistorial: number;
  sinProducto: Set<string>;
  sinProveedor: Set<number>;
}

export const claveActualizacion = (producto3c: string, proveedorId: number, fecha: string): string =>
  `${producto3c}|${proveedorId}|${fecha}`;

// Hasta cuántos días para atrás la foto puede corregir el importe de una fila ya guardada.
export const VENTANA_CORRECCION_DIAS = 7;

/**
 * Decide qué filas de la foto escribir. Pura, para poder testearla sin DB.
 *
 * Cuando ya hay una fila con la misma clave y otro importe:
 *   · fecha reciente (dentro de VENTANA_CORRECCION_DIAS): gana la foto. Es 3c corrigiendo el
 *     precio dos veces el mismo día y el sync viendo la segunda en la corrida siguiente.
 *   · fecha vieja: NO se toca. Esa fila vino de otro lado (la planilla de J, o una compra que
 *     la regla del tilde degradó y guarda lo que se pagó, que es mejor dato que la lista).
 *     Al 2026-10-06 eran 48 casos, casi todos el mismo importe redondeado.
 *   · fila controlada: nunca se toca.
 */
export function planificarPrecios(
  registros: FilaPrecio[],
  productosConocidos: Set<string>,
  proveedorIdPorNumero: Map<number, number>,
  existentes: Map<string, ActualizacionExistente>,
  hoy: string,
): PlanPrecios {
  const desde = new Date(`${hoy}T00:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - VENTANA_CORRECCION_DIAS);
  const limiteCorreccion = desde.toISOString().slice(0, 10);
  const plan: PlanPrecios = {
    aEscribir: [],
    nuevas: 0,
    cambian: 0,
    iguales: 0,
    controladas: 0,
    difierenHistorial: 0,
    sinProducto: new Set(),
    sinProveedor: new Set(),
  };
  for (const r of registros) {
    if (!productosConocidos.has(r.producto3c)) {
      plan.sinProducto.add(r.producto3c);
      continue;
    }
    const proveedorId = proveedorIdPorNumero.get(r.proveedorNum);
    if (proveedorId === undefined) {
      plan.sinProveedor.add(r.proveedorNum);
      continue;
    }
    const previa = existentes.get(claveActualizacion(r.producto3c, proveedorId, r.vigenteDesde));
    // numeric(14,4): se compara a 4 decimales, que es lo que la columna guarda.
    if (previa !== undefined && Number(previa.precio).toFixed(4) === r.precio.toFixed(4)) {
      plan.iguales++;
      continue;
    }
    if (previa?.controlada) {
      plan.controladas++;
      continue;
    }
    if (previa !== undefined && r.vigenteDesde < limiteCorreccion) {
      plan.difierenHistorial++;
      continue;
    }
    if (previa === undefined) plan.nuevas++;
    else plan.cambian++;
    plan.aEscribir.push({ producto3c: r.producto3c, proveedorId, precio: String(r.precio), vigenteDesde: r.vigenteDesde });
  }
  return plan;
}

// La fecha de 3c es hora argentina; el LXC corre en UTC.
function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

/** Interpreta el CSV del proxy y arma el plan contra lo que ya hay en la DB. */
export async function planDesdeFoto(filas: string[][], hoy = hoyArgentina()): Promise<PlanPrecios & { filas: number; saltadas: number }> {
  const { registros, saltados } = interpretarPlanillaPrecios(filas);

  const prods = new Set((await db.select({ c: productos.codigo3c }).from(productos)).map((p) => p.c));
  const idPorNumero = new Map<number, number>();
  for (const p of await db.select({ id: proveedores.id, n: proveedores.numero3c }).from(proveedores)) {
    if (p.n !== null) idPorNumero.set(p.n, p.id);
  }
  const existentes = new Map<string, ActualizacionExistente>();
  const filasActualizacion = await db
    .select({
      producto3c: precios.producto3c,
      proveedorId: precios.proveedorId,
      vigenteDesde: precios.vigenteDesde,
      precio: precios.precio,
      controladoEn: precios.controladoEn,
    })
    .from(precios)
    .where(eq(precios.tipo, 'ACTUALIZACION'));
  for (const e of filasActualizacion) {
    if (e.proveedorId === null) continue;
    existentes.set(claveActualizacion(e.producto3c, e.proveedorId, e.vigenteDesde), {
      precio: e.precio,
      controlada: e.controladoEn !== null,
    });
  }

  return { ...planificarPrecios(registros, prods, idPorNumero, existentes, hoy), filas: filas.length - 1, saltadas: saltados };
}

/**
 * Escribe el plan en una transacción. El `setWhere` repite la protección del plan a nivel
 * SQL: si entre que se armó el plan y ahora alguien marcó la fila como controlada, igual
 * no se pisa.
 */
export async function persistirPrecios(plan: PlanPrecios, usuarioId: number): Promise<number> {
  if (plan.aEscribir.length === 0) return 0;
  return db.transaction(async (tx) => {
    let escritas = 0;
    for (let i = 0; i < plan.aEscribir.length; i += 500) {
      const lote = plan.aEscribir.slice(i, i + 500).map((f) => ({ ...f, tipo: 'ACTUALIZACION', usuarioId }));
      const res = await tx
        .insert(precios)
        .values(lote)
        .onConflictDoUpdate({
          target: [precios.producto3c, precios.proveedorId, precios.vigenteDesde, precios.tipo],
          set: { precio: sql`excluded.precio`, usuarioId: sql`excluded.usuario_id` },
          setWhere: sql`${precios.controladoEn} IS NULL`,
        });
      escritas += res.rowCount ?? 0;
    }
    return escritas;
  });
}
