import {
  juzgar,
  tieneSesgoSistematico,
  TOLERANCIA_ABSOLUTA,
  TOLERANCIA_RELATIVA,
  type Motivo,
  type Resultado,
} from '../domain/abastecimiento.js';
import {
  AREAS_MEDIDAS,
  pedidoContraDespacho,
  type FilaAbastecimiento,
} from '../repositories/abastecimiento.repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Arma el indicador de abastecimiento. Tres cosas salen de acá y son distintas:
//
//   1. EL INDICADOR   — % de casos bien abastecidos, sobre los productos "sanos".
//   2. LOS CASOS      — la lista de lo que difiere, para revisar de a uno con un check.
//   3. A RECALIBRAR   — los productos que fallan siempre para el mismo lado: ahí lo que está
//                       mal es el pedido, no el despacho, y ensucian el indicador.
//
// La revisión manual le GANA a la regla: si alguien marcó un caso como bien abastecido,
// cuenta como cumplido aunque la regla lo hubiera marcado (y al revés).
// ─────────────────────────────────────────────────────────────────────────────

export type VeredictoManual = 'BIEN' | 'MAL';

export interface CasoAbastecimiento {
  fecha: string;
  area_dep_3c: number;
  area_nombre: string;
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string | null;
  presentacion_compra: string | null;
  unidades_por_bulto: number | null;
  pedido: number;
  despacho: number;
  diferencia: number; // despacho − pedido
  diferencia_pct: number | null;
  /** Rango de despacho que la regla considera correcto (el pedido redondeado a piezas). */
  piso: number;
  techo: number;
  resultado: Resultado; // lo que dice la regla
  motivo: Motivo; // qué razón legítima lo salvó (null = quedó marcado)
  /** Lo que dijo la persona al revisarlo, si lo revisó. Le gana a la regla. */
  revision: { veredicto: VeredictoManual; nota: string | null; por: string | null; cuando: string | null } | null;
  /** Conclusión final: la revisión si existe, si no la regla. */
  bien: boolean;
  /** El producto tiene sesgo sistemático → el caso no entra al indicador. */
  recalibrar: boolean;
}

export interface ProductoARecalibrar {
  area_dep_3c: number;
  area_nombre: string;
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string | null;
  presentacion_compra: string | null;
  unidades_por_bulto: number | null;
  dias: number;
  marcados: number;
  sesgo: 'DE_MAS' | 'DE_MENOS';
  /** Cuántas veces el despacho entra en el pedido (0,23 = se despacha la quinta parte). */
  ratio_medio: number;
  /** Qué tan constante es ese ratio: cuanto más bajo, más claro que es parametrización. */
  desvio: number;
}

export interface ResumenAbastecimiento {
  casos: number; // casos del indicador (sin los productos a recalibrar)
  bien: number;
  de_mas: number;
  de_menos: number;
  bien_pct: number | null;
  revisados: number; // cuántos pasaron por el check manual
  pendientes_de_revisar: number; // marcados por la regla y todavía sin revisar
  casos_recalibrar: number; // los que quedaron afuera por producto mal parametrizado
}

export interface AreaAbastecimiento extends ResumenAbastecimiento {
  area_dep_3c: number;
  area_nombre: string;
}

export interface Abastecimiento {
  desde: string;
  hasta: string;
  tolerancias: { relativa: number; absoluta: number };
  total: ResumenAbastecimiento;
  areas: AreaAbastecimiento[];
  casos: CasoAbastecimiento[];
  recalibrar: ProductoARecalibrar[];
}

function clave(area: number, producto: string): string {
  return `${area}|${producto}`;
}

/** Convierte las filas crudas en casos juzgados. Pura: sin DB, se testea sola. */
export function armarCasos(filas: FilaAbastecimiento[]): CasoAbastecimiento[] {
  return filas.map((f) => {
    const pedido = Number(f.pedido);
    const despacho = Number(f.despacho);
    const horma = f.unidades_por_bulto === null ? null : Number(f.unidades_por_bulto);
    const v = juzgar(pedido, despacho, horma, f.unidad_base);
    const revision =
      f.veredicto === null
        ? null
        : {
            veredicto: f.veredicto as VeredictoManual,
            nota: f.nota,
            por: f.revisado_por,
            cuando: f.revisado_en,
          };
    return {
      fecha: f.fecha,
      area_dep_3c: f.area_dep_3c,
      area_nombre: f.area_nombre,
      producto_3c: f.producto_3c,
      producto_nombre: f.producto_nombre ?? `${f.producto_3c} (sin alta en el maestro)`,
      unidad_base: f.unidad_base,
      presentacion_compra: f.presentacion_compra,
      unidades_por_bulto: horma,
      pedido,
      despacho,
      diferencia: Math.round((despacho - pedido) * 1000) / 1000,
      diferencia_pct: pedido === 0 ? null : Math.round(((despacho - pedido) / pedido) * 1000) / 10,
      piso: v.piso,
      techo: v.techo,
      resultado: v.resultado,
      motivo: v.motivo,
      revision,
      // La persona manda: revisar un caso es más información que la regla.
      bien: revision !== null ? revision.veredicto === 'BIEN' : v.resultado === 'CUMPLE',
      recalibrar: false, // lo completa marcarRecalibrar()
    };
  });
}

/**
 * Marca los casos de productos que fallan siempre para el mismo lado y devuelve esa lista.
 * Un caso ya revisado a mano NO arrastra al producto: si alguien lo miró, la conclusión es
 * suya y no se puede achacar a la parametrización.
 */
export function marcarRecalibrar(casos: CasoAbastecimiento[]): ProductoARecalibrar[] {
  const series = new Map<
    string,
    { caso: CasoAbastecimiento; dias: number; marcados: number; deMas: number; deMenos: number; ratios: number[] }
  >();
  for (const c of casos) {
    const k = clave(c.area_dep_3c, c.producto_3c);
    let s = series.get(k);
    if (!s) {
      s = { caso: c, dias: 0, marcados: 0, deMas: 0, deMenos: 0, ratios: [] };
      series.set(k, s);
    }
    s.dias++;
    if (!c.bien) s.marcados++;
    if (!c.bien && c.resultado === 'DE_MAS') s.deMas++;
    if (!c.bien && c.resultado === 'DE_MENOS') s.deMenos++;
    if (c.pedido > 0) s.ratios.push(c.despacho / c.pedido);
  }

  const recalibrar: ProductoARecalibrar[] = [];
  const marcados = new Set<string>();
  for (const [k, s] of series) {
    if (!tieneSesgoSistematico({ dias: s.dias, marcados: s.marcados, deMas: s.deMas, deMenos: s.deMenos })) continue;
    marcados.add(k);
    const media = s.ratios.reduce((a, r) => a + r, 0) / (s.ratios.length || 1);
    const varianza = s.ratios.reduce((a, r) => a + (r - media) ** 2, 0) / (s.ratios.length || 1);
    recalibrar.push({
      area_dep_3c: s.caso.area_dep_3c,
      area_nombre: s.caso.area_nombre,
      producto_3c: s.caso.producto_3c,
      producto_nombre: s.caso.producto_nombre,
      unidad_base: s.caso.unidad_base,
      presentacion_compra: s.caso.presentacion_compra,
      unidades_por_bulto: s.caso.unidades_por_bulto,
      dias: s.dias,
      marcados: s.marcados,
      sesgo: s.deMas >= s.deMenos ? 'DE_MAS' : 'DE_MENOS',
      ratio_medio: Math.round(media * 100) / 100,
      desvio: Math.round(Math.sqrt(varianza) * 100) / 100,
    });
  }
  for (const c of casos) c.recalibrar = marcados.has(clave(c.area_dep_3c, c.producto_3c));
  // Primero los que más días fallan: son los que más ensucian el indicador.
  recalibrar.sort((a, b) => b.marcados - a.marcados || b.dias - a.dias);
  return recalibrar;
}

function resumenVacio(): ResumenAbastecimiento {
  return {
    casos: 0,
    bien: 0,
    de_mas: 0,
    de_menos: 0,
    bien_pct: null,
    revisados: 0,
    pendientes_de_revisar: 0,
    casos_recalibrar: 0,
  };
}

function acumular(r: ResumenAbastecimiento, c: CasoAbastecimiento): void {
  if (c.recalibrar) {
    r.casos_recalibrar++;
    return;
  }
  r.casos++;
  if (c.revision !== null) r.revisados++;
  if (c.bien) {
    r.bien++;
    return;
  }
  if (c.revision === null) r.pendientes_de_revisar++;
  if (c.resultado === 'DE_MAS') r.de_mas++;
  else r.de_menos++;
}

function cerrar<T extends ResumenAbastecimiento>(r: T): T {
  r.bien_pct = r.casos === 0 ? null : Math.round((r.bien / r.casos) * 1000) / 10;
  return r;
}

export function resumir(casos: CasoAbastecimiento[]): {
  total: ResumenAbastecimiento;
  areas: AreaAbastecimiento[];
} {
  const total = resumenVacio();
  const porArea = new Map<number, AreaAbastecimiento>();
  for (const c of casos) {
    acumular(total, c);
    let a = porArea.get(c.area_dep_3c);
    if (!a) {
      a = { ...resumenVacio(), area_dep_3c: c.area_dep_3c, area_nombre: c.area_nombre };
      porArea.set(c.area_dep_3c, a);
    }
    acumular(a, c);
  }
  cerrar(total);
  const areas = [...porArea.values()].map((a) => cerrar(a));
  areas.sort((x, y) => (x.bien_pct ?? 101) - (y.bien_pct ?? 101));
  return { total, areas };
}

export async function obtenerAbastecimiento(filtros: {
  desde: string;
  hasta: string;
  areas?: readonly number[];
}): Promise<Abastecimiento> {
  const filas = await pedidoContraDespacho({
    desde: filtros.desde,
    hasta: filtros.hasta,
    areas: filtros.areas ?? AREAS_MEDIDAS,
  });
  const casos = armarCasos(filas);
  const recalibrar = marcarRecalibrar(casos);
  const { total, areas } = resumir(casos);
  return {
    desde: filtros.desde,
    hasta: filtros.hasta,
    tolerancias: { relativa: TOLERANCIA_RELATIVA, absoluta: TOLERANCIA_ABSOLUTA },
    total,
    areas,
    casos,
    recalibrar,
  };
}
