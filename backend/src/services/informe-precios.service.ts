import { compradorDeFamilia, type Comprador } from '../domain/familias.js';
import {
  cotizacionesProductos,
  gastoPorProductoDelMes,
  preciosCompraPorMesCargado,
  preciosUsadosProductos,
  type FilaCotizacion,
  type FilaGastoProducto,
  type FilaPrecioMesCargado,
  type FilaPrecioUsado,
} from '../repositories/informe.repository.js';
import { ventanaMeses } from './informe.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Compras — todo lo que se calcula sobre la tabla `precios`:
// matriz de cotizaciones, cobertura, control de datos, ahorro potencial,
// variación 1/3/6 meses, evolución y canasta A.
//
// Traduce las fórmulas del Apps Script de J (ver docs/INFORME-COMPRAS.md). Las funciones
// son PURAS: reciben las filas y devuelven el resultado, para poder testear las reglas
// con datos de laboratorio. Al final está el orquestador que hace las consultas.
//
// El "precio de compra" es la última fila de tipo COMPRA (el tick `Usar` de la planilla).
// Todas las variaciones se devuelven como FRACCIÓN (0.12 = +12%), igual que el resto del
// informe; el formateo a % vive en el frontend.
// ─────────────────────────────────────────────────────────────────────────────

/** Una cotización de más de 180 días no cuenta como vigente (no suma al N° de proveedores). */
export const DIAS_VIGENTE = 180;
/** Marca visual "+60d": la cotización sigue vigente pero ya no es reciente. */
export const DIAS_RECIENTE = 60;
/** Solo una cotización fresca sirve para comparar precios en el ahorro potencial. */
export const DIAS_FRESCA = 90;
/** Precio usado con más de 90 días: entra al control de datos como desactualizado. */
export const DIAS_VENCIDO = 90;
/** Salto mes a mes del precio usado que amerita revisión (dedazo / cambio de unidad). */
export const UMBRAL_SALTO = 0.4;
/** Variación mensual imposible: se excluye del índice de la canasta y se reporta aparte. */
export const OUTLIER_MAX = 1.0;
/** Objetivo de cotizaciones por producto A. */
export const OBJETIVO_COTIZACIONES = 3;
/** Mes base del índice de la canasta. Fijo, para que los meses históricos no se muevan. */
export const ANCLA_CANASTA = '2026-01';

const num = (s: string | null | undefined): number => {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Clave estable de proveedor: un precio puede no tener proveedor resuelto (id null).
const claveProveedor = (id: number | null, nombre: string | null): string =>
  id === null ? `s/p:${nombre ?? ''}` : String(id);

// ─────────────────────────────────────────────────────────────────────────────
// Matriz de precios + cobertura + control de datos
// ─────────────────────────────────────────────────────────────────────────────

export interface CotizacionProducto {
  /** id de la fila de `precios`: la hoja de Control la usa para editarla o marcarla. */
  precio_id: number;
  proveedor: string;
  proveedor_id: number | null;
  tipo: string; // COMPRA | ACTUALIZACION
  precio: number;
  fecha: string;
  dias: number;
  reciente: boolean;
  vigente: boolean;
  es_usado: boolean;
}

export interface FilaMatriz {
  producto_3c: string;
  producto: string;
  familia: string | null;
  comprador: Comprador | null;
  /** Proveedores con cotización VIGENTE (≤180 días). Es el número que se compara contra 3. */
  n_prov: number;
  n_prov_hist: number;
  precio: number | null;
  proveedor: string | null;
  fecha: string | null;
  dias: number | null;
  /** El producto no tiene ningún precio de tipo COMPRA: se está usando un fallback. */
  sin_compra: boolean;
  cotizaciones: CotizacionProducto[];
}

export interface Cobertura {
  c1: number;
  c2: number;
  c3: number;
  riesgo: Array<{ producto: string; familia: string | null; n_prov: number }>;
}

export function armarMatriz(cotizaciones: FilaCotizacion[], usados: FilaPrecioUsado[]): FilaMatriz[] {
  const usadoDe = new Map(usados.map((u) => [u.producto_3c, u]));
  const porProducto = new Map<string, FilaCotizacion[]>();
  for (const c of cotizaciones) {
    const lista = porProducto.get(c.producto_3c) ?? [];
    lista.push(c);
    porProducto.set(c.producto_3c, lista);
  }

  const filas: FilaMatriz[] = [];
  for (const [producto3c, lista] of porProducto) {
    const primera = lista[0]!;
    const usado = usadoDe.get(producto3c);
    const claveUsada = usado ? claveProveedor(usado.proveedor_id, usado.proveedor) : null;

    const cots: CotizacionProducto[] = lista
      .map((c) => ({
        precio_id: c.id,
        proveedor: c.proveedor ?? 'Sin proveedor',
        proveedor_id: c.proveedor_id,
        tipo: c.tipo,
        precio: num(c.precio),
        fecha: c.fecha,
        dias: c.dias,
        reciente: c.dias <= DIAS_RECIENTE,
        vigente: c.dias <= DIAS_VIGENTE,
        es_usado: claveUsada !== null && claveProveedor(c.proveedor_id, c.proveedor) === claveUsada,
      }))
      .sort((a, b) => a.precio - b.precio); // el más barato primero, como en el informe

    filas.push({
      producto_3c: producto3c,
      producto: primera.producto,
      familia: primera.familia,
      comprador: compradorDeFamilia(primera.familia),
      n_prov: cots.filter((c) => c.vigente).length,
      n_prov_hist: cots.length,
      precio: usado ? num(usado.precio) : null,
      proveedor: usado?.proveedor ?? null,
      fecha: usado?.fecha ?? null,
      dias: usado?.dias ?? null,
      sin_compra: usado?.sin_compra ?? true,
      cotizaciones: cots,
    });
  }
  return filas.sort((a, b) => a.producto.localeCompare(b.producto));
}

export function armarCobertura(matriz: FilaMatriz[]): Cobertura {
  const cob: Cobertura = { c1: 0, c2: 0, c3: 0, riesgo: [] };
  for (const m of matriz) {
    if (m.n_prov >= OBJETIVO_COTIZACIONES) cob.c3++;
    else if (m.n_prov === 2) cob.c2++;
    else cob.c1++;
    if (m.n_prov < OBJETIVO_COTIZACIONES) {
      cob.riesgo.push({ producto: m.producto, familia: m.familia, n_prov: m.n_prov });
    }
  }
  cob.riesgo.sort((a, b) => a.n_prov - b.n_prov || a.producto.localeCompare(b.producto));
  return cob;
}

export interface Salto {
  producto: string;
  familia: string | null;
  mes: string;
  de: number;
  a: number;
  var: number;
}

export interface ControlDatos {
  saltos: Salto[];
  vencidos: Array<{ producto: string; familia: string | null; proveedor: string | null; dias: number }>;
  sin_compra: Array<{ producto: string; familia: string | null }>;
  umbral: number;
  dias_vencido: number;
}

// Caza precios usados sospechosos ANTES de que ensucien el informe: saltos bruscos mes a
// mes (dedazo, cambio de unidad o tick en la fila equivocada), precios vigentes con fecha
// vieja, y productos que nunca tuvieron una COMPRA marcada.
export function armarControl(matriz: FilaMatriz[], serie: SeriePrecios, meses: string[]): ControlDatos {
  const saltos: Salto[] = [];
  for (const [producto3c, porMes] of serie.precios) {
    for (let i = 1; i < meses.length; i++) {
      const antes = porMes.get(meses[i - 1]!);
      const ahora = porMes.get(meses[i]!);
      if (antes === undefined || ahora === undefined || antes <= 0) continue;
      const v = ahora / antes - 1;
      if (Math.abs(v) > UMBRAL_SALTO) {
        saltos.push({
          producto: serie.nombres.get(producto3c) ?? producto3c,
          familia: serie.familias.get(producto3c) ?? null,
          mes: meses[i]!,
          de: antes,
          a: ahora,
          var: v,
        });
      }
    }
  }
  saltos.sort((a, b) => Math.abs(b.var) - Math.abs(a.var));

  return {
    saltos,
    vencidos: matriz
      .filter((m) => m.dias !== null && m.dias > DIAS_VENCIDO)
      .map((m) => ({ producto: m.producto, familia: m.familia, proveedor: m.proveedor, dias: m.dias! }))
      .sort((a, b) => b.dias - a.dias),
    sin_compra: matriz.filter((m) => m.sin_compra).map((m) => ({ producto: m.producto, familia: m.familia })),
    umbral: UMBRAL_SALTO,
    dias_vencido: DIAS_VENCIDO,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ahorro potencial
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaAhorro {
  producto: string;
  familia: string | null;
  comprador: Comprador | null;
  compra: number;
  mejor: number;
  mejor_proveedor: string;
  gap: number; // fracción, siempre positiva (el lado lo da la lista)
  gasto: number;
  monto: number;
}

export interface Ahorro {
  favor: FilaAhorro[];
  contra: FilaAhorro[];
  total_favor: number;
  total_contra: number;
  neto: number;
  gasto_a: number;
  pct_favor: number | null;
  pct_contra: number | null;
  por_comprador: Record<string, { favor: { monto: number; pct: number | null }; contra: { monto: number; pct: number | null } }>;
}

// Por cada A comprado en el mes: precio de compra vs la mejor cotización FRESCA de OTRO
// proveedor. Si la alternativa es más cara compramos bien (a favor); si es más barata,
// había algo mejor disponible (mala compra). El gap se aplica sobre el gasto real del mes.
export function armarAhorro(matriz: FilaMatriz[], gastoPorProducto: Map<string, number>): Ahorro {
  const favor: FilaAhorro[] = [];
  const contra: FilaAhorro[] = [];

  for (const m of matriz) {
    const gasto = gastoPorProducto.get(m.producto_3c) ?? 0;
    if (gasto <= 0 || m.precio === null || m.precio <= 0) continue; // solo A con gasto real

    let mejor: CotizacionProducto | null = null;
    for (const c of m.cotizaciones) {
      if (c.es_usado || c.dias > DIAS_FRESCA) continue; // otro proveedor, y con precio fresco
      if (mejor === null || c.precio < mejor.precio) mejor = c;
    }
    if (mejor === null) continue; // sin alternativa fresca con qué comparar

    const delta = mejor.precio - m.precio;
    if (delta === 0) continue;
    const gap = delta / m.precio;
    const fila: FilaAhorro = {
      producto: m.producto,
      familia: m.familia,
      comprador: m.comprador,
      compra: m.precio,
      mejor: mejor.precio,
      mejor_proveedor: mejor.proveedor,
      gap: Math.abs(gap),
      gasto,
      monto: Math.abs(gap) * gasto,
    };
    (delta > 0 ? favor : contra).push(fila);
  }

  const porMonto = (a: FilaAhorro, b: FilaAhorro) => b.monto - a.monto;
  favor.sort(porMonto);
  contra.sort(porMonto);

  const suma = (l: FilaAhorro[]) => l.reduce((a, x) => a + x.monto, 0);
  const gastoDe = (c: Comprador) =>
    matriz.reduce((a, m) => (m.comprador === c ? a + (gastoPorProducto.get(m.producto_3c) ?? 0) : a), 0);

  const totalFavor = suma(favor);
  const totalContra = suma(contra);
  const gastoA = matriz.reduce((a, m) => a + (gastoPorProducto.get(m.producto_3c) ?? 0), 0);
  const pct = (monto: number, base: number) => (base > 0 ? monto / base : null);

  const porComprador: Ahorro['por_comprador'] = {};
  for (const c of ['Lautaro', 'Fausto'] as const) {
    const base = gastoDe(c);
    const f = suma(favor.filter((x) => x.comprador === c));
    const k = suma(contra.filter((x) => x.comprador === c));
    porComprador[c] = { favor: { monto: f, pct: pct(f, base) }, contra: { monto: k, pct: pct(k, base) } };
  }

  return {
    favor,
    contra,
    total_favor: totalFavor,
    total_contra: totalContra,
    neto: totalFavor - totalContra,
    gasto_a: gastoA,
    pct_favor: pct(totalFavor, gastoA),
    pct_contra: pct(totalContra, gastoA),
    por_comprador: porComprador,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serie de precios de compra (base de la variación 1/3/6m y de la canasta)
// ─────────────────────────────────────────────────────────────────────────────

export interface SeriePrecios {
  /** producto_3c → (mes → precio de compra cargado ese mes) */
  precios: Map<string, Map<string, number>>;
  nombres: Map<string, string>;
  familias: Map<string, string | null>;
}

export function indexarSerie(filas: FilaPrecioMesCargado[], nombres: Map<string, string>): SeriePrecios {
  const precios = new Map<string, Map<string, number>>();
  const familias = new Map<string, string | null>();
  for (const f of filas) {
    const p = num(f.precio);
    if (p <= 0) continue;
    const porMes = precios.get(f.producto_3c) ?? new Map<string, number>();
    porMes.set(f.mes, p);
    precios.set(f.producto_3c, porMes);
    familias.set(f.producto_3c, f.familia);
  }
  return { precios, nombres, familias };
}

export interface FilaVariacionVentana {
  producto: string;
  familia: string | null;
  precio: number;
  /** Mes del precio usado. Puede ser anterior al mes del informe si no hubo carga nueva. */
  mes_precio: string;
  var_1: number | null;
  var_3: number | null;
  var_6: number | null;
}

// El gráfico de barras del informe: variación del precio de compra a 1, 3 y 6 meses, solo
// de los productos A que efectivamente se compraron en el mes.
//
// ⚠ La ventana se cuenta desde el MES DEL PRECIO, no desde el mes del informe. Si el
// producto se compró en julio pero su último precio cargado es de mayo, "1 mes" compara
// mayo contra abril. Anclarlo al mes del informe comparaba el precio de mayo contra el de
// junio — es decir, contra sí mismo (0% falso) o al revés (variación con el signo dado
// vuelta). Era el bug del gráfico de 1 mes.
export function armarVariacionVentanas(
  serie: SeriePrecios,
  meses: string[],
  gastoPorProducto: Map<string, number>,
): FilaVariacionVentana[] {
  const mesFoco = meses[meses.length - 1]!;
  const indice = new Map(meses.map((m, i) => [m, i]));
  const salida: FilaVariacionVentana[] = [];

  for (const [producto3c, porMes] of serie.precios) {
    if ((gastoPorProducto.get(producto3c) ?? 0) <= 0) continue; // solo lo comprado este mes

    // Precio del mes foco; si ese mes no hubo carga, el más reciente disponible.
    let actual = porMes.get(mesFoco) ?? null;
    let idxActual = meses.length - 1;
    if (actual === null) {
      let mejorIdx = -1;
      for (const [mes, precio] of porMes) {
        const i = indice.get(mes) ?? -1;
        if (i > mejorIdx) {
          mejorIdx = i;
          actual = precio;
        }
      }
      if (mejorIdx < 0) continue;
      idxActual = mejorIdx;
    }
    if (actual === null || actual <= 0) continue;

    const hacia = (atras: number): number | null => {
      const i = idxActual - atras;
      if (i < 0) return null;
      const base = porMes.get(meses[i]!);
      if (base === undefined || base <= 0) return null;
      return actual! / base - 1;
    };

    salida.push({
      producto: serie.nombres.get(producto3c) ?? producto3c,
      familia: serie.familias.get(producto3c) ?? null,
      precio: actual,
      mes_precio: meses[idxActual]!,
      var_1: hacia(1),
      var_3: hacia(3),
      var_6: hacia(6),
    });
  }

  return salida.sort((a, b) => (b.var_6 ?? -Infinity) - (a.var_6 ?? -Infinity));
}

// ─────────────────────────────────────────────────────────────────────────────
// Canasta A: índice de precios ponderado por gasto, anclado a un mes base
// ─────────────────────────────────────────────────────────────────────────────

export interface Anomalia {
  producto: string;
  familia: string | null;
  mes: string;
  de: number;
  a: number;
  var: number;
  gasto: number;
}

export interface Contribucion {
  mes: string;
  var_indice: number;
  items: Array<{ producto: string; familia: string | null; gasto: number; peso: number; var: number; aporte: number }>;
}

export interface Canasta {
  meses: string[];
  ancla: string;
  outlier_max: number;
  /** alcance ('TOTAL' | familia) → serie acumulada desde el ancla, en fracción. */
  scopes: Record<string, Array<number | null>>;
  contrib: Record<string, Contribucion>;
  anomalias: Anomalia[];
}

const ALCANCES = ['TOTAL', 'MATERIAS PRIMAS', 'PACKAGING', 'DESCARTABLES'] as const;

// Convierte variaciones mes a mes en una serie acumulada con base 0 en el mes ancla.
// Compone hacia adelante y descompone hacia atrás, para que los meses previos al ancla
// también tengan valor (y el gráfico no arranque en el aire).
export function anclar(varMensual: Array<number>, anclaIdx: number): Array<number | null> {
  const out: Array<number | null> = varMensual.map(() => null);
  out[anclaIdx] = 0;
  let factor = 1;
  for (let i = anclaIdx + 1; i < varMensual.length; i++) {
    factor *= 1 + (varMensual[i] ?? 0);
    out[i] = factor - 1;
  }
  factor = 1;
  for (let j = anclaIdx - 1; j >= 0; j--) {
    factor /= 1 + (varMensual[j + 1] ?? 0);
    out[j] = factor - 1;
  }
  return out;
}

export function armarCanasta(
  serie: SeriePrecios,
  meses: string[],
  gastoPorProducto: Map<string, number>,
): Canasta {
  const anomalias = new Map<string, Anomalia>();
  const anclaIdx = Math.max(0, meses.indexOf(ANCLA_CANASTA));

  const miembros = (alcance: string): string[] =>
    [...serie.precios.keys()].filter((p) => {
      if ((gastoPorProducto.get(p) ?? 0) <= 0) return false;
      return alcance === 'TOTAL' || (serie.familias.get(p) ?? '').toUpperCase() === alcance;
    });

  // Meses cuyo precio quedó bajo sospecha: los que llegaron con un salto imposible. No se
  // usan NI como destino NI como base de comparación — si el precio de mayo está mal, la
  // "baja" de junio contra ese precio tampoco es real, es la corrección del error.
  //
  // Sin esto pasaba lo siguiente: MARGARINA MTK MASA cargada en mayo a $23.665 (seis veces
  // su precio) subía +490% y quedaba excluida, pero en junio volvía a $4.863 y ese −79% SÍ
  // entraba, hundiendo el índice de junio 2,1 puntos. El filtro atrapaba la ida y dejaba
  // pasar la vuelta.
  const sospechosos = new Set<string>();
  for (const [producto3c, porMes] of serie.precios) {
    // Los meses que tienen precio, en orden. Los huecos importan: un producto puede pasar
    // varios meses sin compras.
    const conPrecio = meses
      .map((mes, i) => ({ mes, i, precio: porMes.get(mes) }))
      .filter((x): x is { mes: string; i: number; precio: number } => x.precio !== undefined && x.precio > 0);

    for (let k = 0; k < conPrecio.length; k++) {
      const actual = conPrecio[k]!;
      const previo = conPrecio[k - 1];
      const siguiente = conPrecio[k + 1];

      // 1) Salto contra el mes inmediatamente anterior.
      if (previo && previo.i === actual.i - 1 && Math.abs(actual.precio / previo.precio - 1) > OUTLIER_MAX) {
        sospechosos.add(`${producto3c}|${actual.mes}`);
        continue;
      }

      // 2) Pico aislado: se dispara respecto del precio anterior Y vuelve con el siguiente,
      // aunque entre medio haya meses sin compras. Es la firma de un error de carga.
      //
      // Caso real: MARGARINA MTK MASA valía $2.756 en diciembre, no se compró en cuatro
      // meses, apareció a $23.665 en mayo y volvió a $3.910 en junio. Sin esta regla el
      // pico no se detectaba (no había mes anterior con qué compararlo) y la vuelta entraba
      // como un −79% que hundía el índice de junio.
      if (
        previo &&
        siguiente &&
        Math.abs(actual.precio / previo.precio - 1) > OUTLIER_MAX &&
        Math.abs(actual.precio / siguiente.precio - 1) > OUTLIER_MAX
      ) {
        sospechosos.add(`${producto3c}|${actual.mes}`);
      }
    }
  }

  const varMensualDe = (alcance: string): number[] => {
    const lista = miembros(alcance);
    const mv = meses.map(() => 0);
    for (let i = 1; i < meses.length; i++) {
      let numerador = 0;
      let peso = 0;
      for (const producto3c of lista) {
        const porMes = serie.precios.get(producto3c)!;
        const antes = porMes.get(meses[i - 1]!);
        const ahora = porMes.get(meses[i]!);
        if (antes === undefined || ahora === undefined || antes <= 0) continue;
        const v = ahora / antes - 1;
        const g = gastoPorProducto.get(producto3c) ?? 0;
        const baseSospechosa = sospechosos.has(`${producto3c}|${meses[i - 1]}`);
        if (Math.abs(v) > OUTLIER_MAX || baseSospechosa) {
          // Un salto así casi siempre es dedazo o cambio de unidad: se excluye del índice
          // y se reporta aparte para que alguien lo revise en la hoja de Precios.
          anomalias.set(`${producto3c}|${meses[i]}`, {
            producto: serie.nombres.get(producto3c) ?? producto3c,
            familia: serie.familias.get(producto3c) ?? null,
            mes: meses[i]!,
            de: antes,
            a: ahora,
            var: v,
            gasto: g,
          });
          continue;
        }
        numerador += v * g;
        peso += g;
      }
      mv[i] = peso > 0 ? numerador / peso : 0;
    }
    return mv;
  };

  const scopes: Record<string, Array<number | null>> = {};
  const contrib: Record<string, Contribucion> = {};

  for (const alcance of ALCANCES) {
    scopes[alcance] = anclar(varMensualDe(alcance), anclaIdx);

    // Cómo se pondera la variación del último mes: aporte = peso × variación, y la suma
    // de los aportes es exactamente la variación del índice de ese mes.
    const ultimo = meses[meses.length - 1]!;
    const previo = meses.length > 1 ? meses[meses.length - 2]! : null;
    const crudos: Array<{ producto3c: string; g: number; v: number }> = [];
    let total = 0;
    if (previo) {
      for (const producto3c of miembros(alcance)) {
        const porMes = serie.precios.get(producto3c)!;
        const antes = porMes.get(previo);
        const ahora = porMes.get(ultimo);
        if (antes === undefined || ahora === undefined || antes <= 0) continue;
        const v = ahora / antes - 1;
        // Misma regla que el índice: ni saltos imposibles ni comparaciones contra un
        // precio ya marcado como sospechoso.
        if (Math.abs(v) > OUTLIER_MAX || sospechosos.has(`${producto3c}|${previo}`)) continue;
        const g = gastoPorProducto.get(producto3c) ?? 0;
        total += g;
        crudos.push({ producto3c, g, v });
      }
    }
    const items = crudos
      .map((c) => {
        const peso = total > 0 ? c.g / total : 0;
        return {
          producto: serie.nombres.get(c.producto3c) ?? c.producto3c,
          familia: serie.familias.get(c.producto3c) ?? null,
          gasto: c.g,
          peso,
          var: c.v,
          aporte: peso * c.v,
        };
      })
      .sort((a, b) => Math.abs(b.aporte) - Math.abs(a.aporte));

    contrib[alcance] = {
      mes: ultimo,
      var_indice: items.reduce((a, x) => a + x.aporte, 0),
      items,
    };
  }

  return {
    meses,
    ancla: meses[anclaIdx] ?? ANCLA_CANASTA,
    outlier_max: OUTLIER_MAX,
    scopes,
    contrib,
    anomalias: [...anomalias.values()].sort((a, b) => Math.abs(b.var) - Math.abs(a.var)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador
// ─────────────────────────────────────────────────────────────────────────────

export interface InformePrecios {
  mes: string;
  meses: string[];
  matriz: FilaMatriz[];
  cobertura: Cobertura;
  control: ControlDatos;
  ahorro: Ahorro;
  variacion_ventanas: FilaVariacionVentana[];
  canasta: Canasta;
}

export async function informePrecios(mes: string, cantidadMeses = 12): Promise<InformePrecios> {
  const meses = ventanaMeses(mes, cantidadMeses);
  const desde = meses[0]!;

  const [cotizaciones, usados, serieCompra, gastos] = await Promise.all([
    cotizacionesProductos(),
    preciosUsadosProductos(),
    preciosCompraPorMesCargado(desde, mes),
    gastoPorProductoDelMes(mes),
  ]);

  const gastoPorProducto = new Map<string, number>();
  const nombres = new Map<string, string>();
  for (const g of gastos as FilaGastoProducto[]) {
    gastoPorProducto.set(g.producto_3c, num(g.gasto));
    nombres.set(g.producto_3c, g.producto);
  }
  for (const c of cotizaciones) nombres.set(c.producto_3c, c.producto);

  const matriz = armarMatriz(cotizaciones, usados);
  const serie = indexarSerie(serieCompra, nombres);

  return {
    mes,
    meses,
    matriz,
    cobertura: armarCobertura(matriz),
    control: armarControl(matriz, serie, meses),
    ahorro: armarAhorro(matriz, gastoPorProducto),
    variacion_ventanas: armarVariacionVentanas(serie, meses, gastoPorProducto),
    canasta: armarCanasta(serie, meses, gastoPorProducto),
  };
}
