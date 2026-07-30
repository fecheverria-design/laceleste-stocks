import type { Response } from 'express';

// Generación de CSV apto para Excel en es-AR. Vive acá (y no en cada controller) porque lo
// usan los export de movimientos, artículos, precios y proveedores, y las tres decisiones de
// formato tienen que ser IGUALES en todos: si un archivo abre bien y otro no, el problema
// es imposible de encontrar.
//
// Las tres decisiones:
//   - separador ';'   → Excel en es-AR usa la coma como decimal, así que con ',' de separador
//                       parte los números en dos columnas.
//   - BOM al principio → sin él Excel abre el UTF-8 como Latin-1 y los acentos salen rotos.
//   - CRLF             → fin de línea que espera Excel en Windows.

function celdaCsv(v: string | number): string {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function filaCsv(campos: (string | number)[]): string {
  return campos.map(celdaCsv).join(';');
}

export function aCsv(headers: string[], filas: (string | number)[][]): string {
  const lineas = [filaCsv(headers), ...filas.map(filaCsv)];
  return '﻿' + lineas.join('\r\n');
}

// 1380.000 -> 1380,000 (decimal es-AR). Los numeric de PG llegan como string.
export const dec = (s: string): string => s.replace('.', ',');

// Manda el CSV como descarga. `nombre` es el archivo que ve el usuario.
export function enviarCsv(
  res: Response,
  nombre: string,
  headers: string[],
  filas: (string | number)[][],
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.status(200).send(aCsv(headers, filas));
}
