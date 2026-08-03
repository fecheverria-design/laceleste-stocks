import type { ControlPreciosQuery } from '../domain/precios.schema.js';
import {
  cotizacionesProductos,
  preciosCompraPorMesCargado,
  preciosUsadosProductos,
} from '../repositories/informe.repository.js';
import {
  DIAS_FRESCA,
  DIAS_VENCIDO,
  OBJETIVO_COTIZACIONES,
  UMBRAL_SALTO,
  armarMatriz,
  indexarSerie,
  type FilaMatriz,
} from './informe-precios.service.js';
import { mesAnteriorDe, ventanaMeses } from './informe.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Control de precios — la hoja de trabajo del área de compras.
//
// Es la MISMA información que la matriz del informe, pero ordenada para trabajar: en vez
// de "acá están los precios", responde "esto es lo que hay que revisar y por qué". Cada
// producto trae sus alertas; la pantalla arranca filtrada por los que tienen alguna.
//
// Los umbrales son los del informe (se importan, no se repiten): si mañana cambia el
// objetivo de cotizaciones, cambia en los dos lados a la vez.
// ─────────────────────────────────────────────────────────────────────────────

/** Motivos por los que un producto entra a la lista de revisión. */
export type Alerta =
  | 'SIN_COMPRA' // no tiene ningún precio de tipo COMPRA: se usa un fallback
  | 'VENCIDO' // el precio que se usa tiene más de DIAS_VENCIDO días
  | 'POCAS_COTIZACIONES' // menos de OBJETIVO_COTIZACIONES proveedores vigentes
  | 'SALTO' // el precio usado pegó un salto mayor a UMBRAL_SALTO en un mes
  | 'SIN_PROVEEDOR'; // el precio que se usa no tiene proveedor asignado

export interface FilaControl extends FilaMatriz {
  alertas: Alerta[];
  /** Cotizaciones frescas (≤90 días) de otros proveedores: con cuántas se puede comparar. */
  alternativas_frescas: number;
  /** El salto más grande detectado, si lo hubo. */
  salto: { mes: string; de: number; a: number; var: number } | null;
}

export interface ControlPrecios {
  filtro: ControlPreciosQuery;
  objetivo_cotizaciones: number;
  dias_vencido: number;
  resumen: {
    productos: number;
    a_revisar: number;
    sin_compra: number;
    vencidos: number;
    pocas_cotizaciones: number;
    saltos: number;
    sin_proveedor: number;
  };
  items: FilaControl[];
}

const VENTANA_SALTOS = 12;

// Por qué un producto entra a la lista de revisión. Pura, para poder testear las reglas.
export function calcularAlertas(
  m: FilaMatriz,
  extra: { tieneSalto: boolean; proveedorUsado: number | null | undefined },
): Alerta[] {
  const alertas: Alerta[] = [];
  if (m.sin_compra) alertas.push('SIN_COMPRA');
  if (m.dias !== null && m.dias > DIAS_VENCIDO) alertas.push('VENCIDO');
  if (m.n_prov < OBJETIVO_COTIZACIONES) alertas.push('POCAS_COTIZACIONES');
  if (extra.tieneSalto) alertas.push('SALTO');
  // Sin proveedor no se puede comparar contra nadie: el producto queda fuera del ahorro.
  if (extra.proveedorUsado === null) alertas.push('SIN_PROVEEDOR');
  return alertas;
}

export async function controlDePrecios(filtro: ControlPreciosQuery): Promise<ControlPrecios> {
  // La ventana de saltos termina en el mes pasado: el mes en curso casi nunca tiene todavía
  // el precio cargado y aparecería como un salto que no existe.
  const hasta = mesAnteriorDe(new Date().toISOString().slice(0, 7));
  const meses = ventanaMeses(hasta, VENTANA_SALTOS);

  const [cotizaciones, usados, serieCompra] = await Promise.all([
    cotizacionesProductos(filtro),
    preciosUsadosProductos(filtro),
    preciosCompraPorMesCargado(meses[0]!, hasta, filtro),
  ]);

  const matriz = armarMatriz(cotizaciones, usados);
  const nombres = new Map(matriz.map((m) => [m.producto_3c, m.producto]));
  const serie = indexarSerie(serieCompra, nombres);
  const proveedorUsado = new Map(usados.map((u) => [u.producto_3c, u.proveedor_id]));

  // Salto más grande del precio usado, por producto.
  const saltoDe = new Map<string, { mes: string; de: number; a: number; var: number }>();
  for (const [producto3c, porMes] of serie.precios) {
    for (let i = 1; i < meses.length; i++) {
      const antes = porMes.get(meses[i - 1]!);
      const ahora = porMes.get(meses[i]!);
      if (antes === undefined || ahora === undefined || antes <= 0) continue;
      const v = ahora / antes - 1;
      if (Math.abs(v) <= UMBRAL_SALTO) continue;
      const previo = saltoDe.get(producto3c);
      if (!previo || Math.abs(v) > Math.abs(previo.var)) {
        saltoDe.set(producto3c, { mes: meses[i]!, de: antes, a: ahora, var: v });
      }
    }
  }

  const items: FilaControl[] = matriz.map((m) => {
    const salto = saltoDe.get(m.producto_3c) ?? null;
    return {
      ...m,
      alertas: calcularAlertas(m, { tieneSalto: salto !== null, proveedorUsado: proveedorUsado.get(m.producto_3c) }),
      alternativas_frescas: m.cotizaciones.filter((c) => !c.es_usado && c.dias <= DIAS_FRESCA).length,
      salto,
    };
  });

  const cuenta = (a: Alerta) => items.filter((i) => i.alertas.includes(a)).length;

  return {
    filtro,
    objetivo_cotizaciones: OBJETIVO_COTIZACIONES,
    dias_vencido: DIAS_VENCIDO,
    resumen: {
      productos: items.length,
      a_revisar: items.filter((i) => i.alertas.length > 0).length,
      sin_compra: cuenta('SIN_COMPRA'),
      vencidos: cuenta('VENCIDO'),
      pocas_cotizaciones: cuenta('POCAS_COTIZACIONES'),
      saltos: cuenta('SALTO'),
      sin_proveedor: cuenta('SIN_PROVEEDOR'),
    },
    // Primero lo que más falta: más alertas arriba, y a igualdad, orden alfabético.
    items: items.sort((a, b) => b.alertas.length - a.alertas.length || a.producto.localeCompare(b.producto)),
  };
}
