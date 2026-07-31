// Lectura del export de COMPRAS de 3c: interpreta las filas del CSV y arma los renglones
// listos para escribir. Vive aparte de import-compras.ts (que es el CLI y habla con la DB)
// para poder testear la lógica sin archivo ni base, igual que extras-mapeo.ts.

import { esCompraReal } from '../domain/familias.js';

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. "5.395.000,00" -> 5395000 ; "107,90" -> 107.9.
function parseNum(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

export interface FilaCompra {
  numero: string;
  renglon: number;
  fecha: string;
  producto3c: string;
  nombre: string;
  familia: string;
  proveedorNum: number;
  proveedorNombre: string;
  cantidad: number;
  precioUnitario: number;
  precioTotal: number;
  iva: number | null;
  totalConIva: number | null;
}

export interface LecturaCompras {
  registros: FilaCompra[];
  saltadas: number;
  excluidasFamilia: number;
}

// Lee las filas del CSV ya parseado y devuelve los renglones de compra listos para escribir.
// Vive aparte de main() y sin tocar la DB para poder testear el numerado de renglones.
export function interpretarCompras(filas: string[][]): LecturaCompras {
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const h = filas[0]!;
  const norm = h.map((x) => x.trim().toUpperCase());
  const idx = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    throw new Error(`Falta la columna (${aliases.join(' / ')}). Encabezados: ${h.join(' | ')}`);
  };
  const opt = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const col = {
    NUMERO: idx(['NUMERO']),
    FECHA: idx(['FECHA']),
    ARTICU_ID: idx(['ARTICU_ID', 'ID ARTICULO', 'CODIGO']),
    CANTIDAD: idx(['CANTIDAD']),
    PRECIO_UNITARIO: idx(['PRECIO_UNITARIO', 'PRECIO']),
    PRECIO_TOTAL: idx(['PRECIO_TOTAL']),
    PERSONAS_ID: idx(['PERSONAS_ID', 'COD. PROVEEDOR', 'ID PROVEEDOR']),
    PROVEEDOR: idx(['PROVEEDORES', 'PROVEEDOR']),
    DENOMINACION: opt(['DENOMINACION', 'ARTICULO']),
    FAMILIA: opt(['FAMILIA']),
    IVA: opt(['IVA']),
    VALOR_TOTAL: opt(['VALOR TOTAL', 'VALOR_TOTAL', 'TOTAL']),
  };
  const c = (f: string[], i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');

  const porClave = new Map<string, FilaCompra>();
  // Un remito puede repetir el MISMO producto en varias líneas (p.ej. A 0002-00001718 trae
  // STICKER REDONDO tres veces, con distinta cantidad). Como 3c no exporta un id de línea, se
  // numeran por orden de aparición: sin esto la segunda pisaba a la primera y la plata se
  // perdía (65 renglones / $60,7M en el export del 31/07/2026).
  const renglonesVistos = new Map<string, number>();
  let saltadas = 0;
  let excluidasFamilia = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const numero = c(f, col.NUMERO);
    const fecha = parseFecha(c(f, col.FECHA));
    const producto3c = c(f, col.ARTICU_ID).slice(0, 32);
    const proveedorNum = Number(c(f, col.PERSONAS_ID));
    const cantidad = parseNum(c(f, col.CANTIDAD));
    const precioUnitario = parseNum(c(f, col.PRECIO_UNITARIO));
    const precioTotal = parseNum(c(f, col.PRECIO_TOTAL));
    if (!numero || !fecha || !producto3c || !Number.isInteger(proveedorNum) || proveedorNum <= 0 || !Number.isFinite(precioTotal)) {
      saltadas++;
      continue;
    }
    const familia = c(f, col.FAMILIA).slice(0, 64);
    // Familias que no son compras reales (servicios, flete tercerizado, ajuste de
    // saldo) no cuentan en el gasto (ver domain/familias.ts, decisión de J 2026-07-01).
    if (!esCompraReal(familia)) {
      excluidasFamilia++;
      continue;
    }
    const ivaRaw = c(f, col.IVA);
    const totalRaw = c(f, col.VALOR_TOTAL);
    const claveProducto = `${numero}|${producto3c}`;
    const renglon = (renglonesVistos.get(claveProducto) ?? 0) + 1;
    renglonesVistos.set(claveProducto, renglon);
    porClave.set(`${claveProducto}|${renglon}`, {
      numero,
      renglon,
      fecha,
      producto3c,
      nombre: c(f, col.DENOMINACION).slice(0, 200) || `Art ${producto3c}`,
      familia,
      proveedorNum,
      proveedorNombre: c(f, col.PROVEEDOR).slice(0, 150) || `Proveedor ${proveedorNum}`,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      precioUnitario: Number.isFinite(precioUnitario) ? precioUnitario : 0,
      precioTotal,
      iva: ivaRaw ? parseNum(ivaRaw) : null,
      totalConIva: totalRaw ? parseNum(totalRaw) : null,
    });
  }
  return { registros: [...porClave.values()], saltadas, excluidasFamilia };
}
