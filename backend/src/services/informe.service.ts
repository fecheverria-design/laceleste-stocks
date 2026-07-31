import { compradorDeFamilia, type Comprador } from '../domain/familias.js';
import {
  gastoMensualPorProveedor,
  gastoPorMesProveedorProducto,
  mesesConCompras,
  preciosVigentesPorMes,
  type FilaGastoMes,
  type FilaGastoMensual,
  type FilaPrecioMes,
} from '../repositories/informe.repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Compras — solapa "Por Comprador".
//
// Reproduce el informe que J genera con Apps Script: gasto real del mes por proveedor y
// por producto, separado por comprador, con la variación de precio contra el mes anterior.
//
// DOS FUENTES DISTINTAS, a propósito:
//   - el GASTO sale de `compras` y se mide CON IVA (columna "VALOR TOTAL" de su planilla):
//     es lo que efectivamente se pagó y lo que tiene que cerrar contra su informe;
//   - el PRECIO sale de la tabla `precios`: es el VIGENTE al cierre del mes (última COMPRA
//     con fecha <= fin de mes, el "tick Usar" del script). Por eso corregir un precio a mano
//     en la hoja de Precios mueve el informe, sin reimportar nada.
//
// Se probó al revés (precio = promedio ponderado de lo pagado ese mes, derivado de `compras`)
// y estaba mal: J corrigió un precio y el informe no se movía, porque no miraba esa tabla.
// Decisión de J, 2026-07-31.
//
// `precio_pagado` se conserva al lado como referencia: es lo que salió en promedio ese mes
// según las compras. Sirve justamente para ver cuándo el precio de lista y lo pagado no
// coinciden, pero NO es lo que manda la variación.
//
// La atribución a comprador sale de la familia del producto (domain/familias.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaProveedorInforme {
  proveedor_id: number | null;
  nombre: string;
  gasto: number;
  gasto_anterior: number;
  var_gasto: number | null;
  // Variación de precio ponderada por gasto de los productos que le compramos a ese
  // proveedor en los dos meses. null si ninguno tiene con qué comparar.
  var_precio: number | null;
  productos: number;
}

export interface FilaProductoInforme {
  producto_3c: string;
  nombre: string;
  familia: string | null;
  comprador: Comprador;
  clasificacion_abc: string | null;
  gasto: number;
  gasto_anterior: number;
  cantidad: number;
  precio: number | null; // vigente al cierre del mes (el que manda la variación)
  precio_anterior: number | null;
  var_precio: number | null;
  precio_pagado: number | null; // promedio de lo pagado ese mes, solo como referencia
}

export interface InformeCompradores {
  mes: string;
  mes_anterior: string;
  resumen: {
    gasto: number;
    gasto_anterior: number;
    var_gasto: number | null;
    renglones: number;
    proveedores: number;
    productos: number;
  };
  por_comprador: Array<{ comprador: Comprador; gasto: number; gasto_anterior: number; var_gasto: number | null }>;
  proveedores: FilaProveedorInforme[];
  productos: FilaProductoInforme[];
}

function num(s: string | null | undefined): number {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Variación relativa. null cuando no hay base con qué comparar (mes anterior sin compras):
// un 0 ahí mentiría, porque "no compré" no es "no cambió".
export function variacion(actual: number, anterior: number): number | null {
  if (!Number.isFinite(anterior) || anterior <= 0) return null;
  return actual / anterior - 1;
}

// Mes anterior a un 'YYYY-MM'.
export function mesAnteriorDe(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  if (!a || !m) throw new Error(`Mes inválido: ${mes} (esperado YYYY-MM)`);
  const d = new Date(Date.UTC(a, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

interface Acumulado {
  gasto: number;
  gastoNeto: number;
  cantidad: number;
  renglones: number;
}

const vacio = (): Acumulado => ({ gasto: 0, gastoNeto: 0, cantidad: 0, renglones: 0 });

function sumar(a: Acumulado, f: FilaGastoMes): void {
  a.gasto += num(f.gasto);
  a.gastoNeto += num(f.gasto_neto);
  a.cantidad += num(f.cantidad);
  a.renglones += f.renglones;
}

// Precio promedio ponderado del mes (neto / cantidad). null si no hay cantidad.
function precioPromedio(a: Acumulado | undefined): number | null {
  if (!a || a.cantidad <= 0) return null;
  return a.gastoNeto / a.cantidad;
}

// Arma el informe a partir de las filas crudas de los dos meses. Pura: sin DB, para poder
// testear las variaciones y la ponderación con datos de laboratorio.
// Índice (mes, producto) → precio vigente, para no recorrer el array por cada producto.
function indicePrecios(filas: FilaPrecioMes[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of filas) {
    const p = Number(f.precio);
    if (Number.isFinite(p) && p > 0) m.set(`${f.mes}|${f.producto_3c}`, p);
  }
  return m;
}

export function armarInforme(
  filas: FilaGastoMes[],
  precios: FilaPrecioMes[],
  mes: string,
  mesAnterior: string,
  comprador?: Comprador,
): InformeCompradores {
  const precioDe = indicePrecios(precios);
  const productos = new Map<string, { info: FilaGastoMes; actual: Acumulado; previo: Acumulado }>();
  const proveedores = new Map<string, { id: number | null; nombre: string; actual: Acumulado; previo: Acumulado }>();
  // (proveedor, producto) para poder ponderar la variación de precio por proveedor.
  const proveedorProducto = new Map<string, { proveedorClave: string; producto3c: string; actual: Acumulado; previo: Acumulado }>();
  const porComprador = new Map<Comprador, { actual: Acumulado; previo: Acumulado }>();

  for (const f of filas) {
    const suComprador = compradorDeFamilia(f.familia);
    if (!suComprador) continue; // sin comprador no entra al informe
    if (comprador && suComprador !== comprador) continue;
    if (f.mes !== mes && f.mes !== mesAnterior) continue;
    const esActual = f.mes === mes;

    const prod = productos.get(f.producto_3c) ?? { info: f, actual: vacio(), previo: vacio() };
    // El nombre/familia se toma de la fila del mes pedido si existe (puede haberse renombrado).
    if (esActual) prod.info = f;
    sumar(esActual ? prod.actual : prod.previo, f);
    productos.set(f.producto_3c, prod);

    const provClave = f.proveedor_id === null ? `s/p:${f.proveedor ?? ''}` : String(f.proveedor_id);
    const prov = proveedores.get(provClave) ?? {
      id: f.proveedor_id,
      nombre: f.proveedor ?? 'Sin proveedor',
      actual: vacio(),
      previo: vacio(),
    };
    sumar(esActual ? prov.actual : prov.previo, f);
    proveedores.set(provClave, prov);

    const ppClave = `${provClave}|${f.producto_3c}`;
    const pp = proveedorProducto.get(ppClave) ?? {
      proveedorClave: provClave,
      producto3c: f.producto_3c,
      actual: vacio(),
      previo: vacio(),
    };
    sumar(esActual ? pp.actual : pp.previo, f);
    proveedorProducto.set(ppClave, pp);

    const comp = porComprador.get(suComprador) ?? { actual: vacio(), previo: vacio() };
    sumar(esActual ? comp.actual : comp.previo, f);
    porComprador.set(suComprador, comp);
  }

  // Variación de precio de un producto: la del precio VIGENTE al cierre de cada mes.
  const varDeProducto = (producto3c: string): number | null => {
    const ahora = precioDe.get(`${mes}|${producto3c}`);
    const antes = precioDe.get(`${mesAnterior}|${producto3c}`);
    if (ahora === undefined || antes === undefined) return null;
    return variacion(ahora, antes);
  };

  // Variación de precio ponderada por gasto, por proveedor: pesa cada producto por lo que
  // se le gastó este mes, así un insumo grande mueve la aguja más que uno chico.
  const ponderadaPorProveedor = new Map<string, { suma: number; peso: number }>();
  for (const pp of proveedorProducto.values()) {
    const v = varDeProducto(pp.producto3c);
    if (v === null || pp.actual.gasto <= 0) continue;
    const acum = ponderadaPorProveedor.get(pp.proveedorClave) ?? { suma: 0, peso: 0 };
    acum.suma += v * pp.actual.gasto;
    acum.peso += pp.actual.gasto;
    ponderadaPorProveedor.set(pp.proveedorClave, acum);
  }

  const filasProveedores: FilaProveedorInforme[] = [...proveedores.entries()]
    .filter(([, p]) => p.actual.gasto > 0 || p.previo.gasto > 0)
    .map(([clave, p]) => {
      const pond = ponderadaPorProveedor.get(clave);
      return {
        proveedor_id: p.id,
        nombre: p.nombre,
        gasto: p.actual.gasto,
        gasto_anterior: p.previo.gasto,
        var_gasto: variacion(p.actual.gasto, p.previo.gasto),
        var_precio: pond && pond.peso > 0 ? pond.suma / pond.peso : null,
        productos: [...proveedorProducto.values()].filter((pp) => pp.proveedorClave === clave && pp.actual.gasto > 0).length,
      };
    })
    .sort((a, b) => b.gasto - a.gasto);

  const filasProductos: FilaProductoInforme[] = [...productos.values()]
    .filter((p) => p.actual.gasto > 0 || p.previo.gasto > 0)
    .map((p) => ({
      producto_3c: p.info.producto_3c,
      nombre: p.info.producto,
      familia: p.info.familia,
      comprador: compradorDeFamilia(p.info.familia)!,
      clasificacion_abc: p.info.clasificacion_abc,
      gasto: p.actual.gasto,
      gasto_anterior: p.previo.gasto,
      cantidad: p.actual.cantidad,
      precio: precioDe.get(`${mes}|${p.info.producto_3c}`) ?? null,
      precio_anterior: precioDe.get(`${mesAnterior}|${p.info.producto_3c}`) ?? null,
      var_precio: varDeProducto(p.info.producto_3c),
      precio_pagado: precioPromedio(p.actual),
    }))
    .sort((a, b) => b.gasto - a.gasto);

  const gasto = filasProductos.reduce((a, p) => a + p.gasto, 0);
  const gastoAnterior = filasProductos.reduce((a, p) => a + p.gasto_anterior, 0);

  return {
    mes,
    mes_anterior: mesAnterior,
    resumen: {
      gasto,
      gasto_anterior: gastoAnterior,
      var_gasto: variacion(gasto, gastoAnterior),
      renglones: [...productos.values()].reduce((a, p) => a + p.actual.renglones, 0),
      proveedores: filasProveedores.filter((p) => p.gasto > 0).length,
      productos: filasProductos.filter((p) => p.gasto > 0).length,
    },
    por_comprador: [...porComprador.entries()]
      .map(([c, v]) => ({
        comprador: c,
        gasto: v.actual.gasto,
        gasto_anterior: v.previo.gasto,
        var_gasto: variacion(v.actual.gasto, v.previo.gasto),
      }))
      .sort((a, b) => b.gasto - a.gasto),
    proveedores: filasProveedores,
    productos: filasProductos,
  };
}

export async function informePorComprador(mes: string, comprador?: Comprador): Promise<InformeCompradores> {
  const anterior = mesAnteriorDe(mes);
  const [filas, precios] = await Promise.all([
    gastoPorMesProveedorProducto([mes, anterior]),
    preciosVigentesPorMes([mes, anterior]),
  ]);
  return armarInforme(filas, precios, mes, anterior, comprador);
}

export async function mesesDisponibles(): Promise<string[]> {
  return mesesConCompras();
}

// ─────────────────────────────────────────────────────────────────────────────
// Evolución del gasto (el gráfico "chProv" del informe de J): la serie de los últimos N
// meses, total y desagregada por los proveedores más grandes de la ventana.
// ─────────────────────────────────────────────────────────────────────────────

export interface SerieProveedor {
  nombre: string;
  // Un null es "ese mes no se le compró", que NO es lo mismo que cero: la línea se corta.
  serie: Array<number | null>;
  total: number;
}

export interface EvolucionGasto {
  meses: string[];
  total: number[];
  proveedores: SerieProveedor[];
}

// Los N meses que terminan en `mes` (incluido), viejo → nuevo.
export function ventanaMeses(mes: string, cantidad: number): string[] {
  const out: string[] = [];
  let actual = mes;
  for (let i = 0; i < cantidad; i++) {
    out.unshift(actual);
    actual = mesAnteriorDe(actual);
  }
  return out;
}

export function armarEvolucion(
  filas: FilaGastoMensual[],
  meses: string[],
  comprador?: Comprador,
  topProveedores = 6,
): EvolucionGasto {
  const indice = new Map(meses.map((m, i) => [m, i]));
  const total = meses.map(() => 0);
  const porProveedor = new Map<string, Array<number | null>>();

  for (const f of filas) {
    const suComprador = compradorDeFamilia(f.familia);
    if (!suComprador) continue;
    if (comprador && suComprador !== comprador) continue;
    const i = indice.get(f.mes);
    if (i === undefined) continue;

    const monto = Number(f.gasto) || 0;
    total[i] = (total[i] ?? 0) + monto;

    const nombre = f.proveedor ?? 'Sin proveedor';
    const serie = porProveedor.get(nombre) ?? meses.map(() => null);
    serie[i] = (serie[i] ?? 0) + monto;
    porProveedor.set(nombre, serie);
  }

  const proveedores = [...porProveedor.entries()]
    .map(([nombre, serie]) => ({
      nombre,
      serie,
      total: serie.reduce<number>((a, v) => a + (v ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, topProveedores);

  return { meses, total, proveedores };
}

export async function evolucionGasto(mes: string, cantidadMeses: number, comprador?: Comprador): Promise<EvolucionGasto> {
  const meses = ventanaMeses(mes, cantidadMeses);
  const filas = await gastoMensualPorProveedor(meses[0]!, meses[meses.length - 1]!);
  return armarEvolucion(filas, meses, comprador);
}
