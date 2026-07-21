// Genera un CSV apto para Excel es-AR (separador ';', BOM UTF-8) y dispara la
// descarga en el navegador. Los valores se pasan ya como string; para números con
// decimales usá coma (ej. "1380,000") para que Excel los lea como número.

function celda(v: string | number): string {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function descargarCsv(filename: string, headers: string[], filas: (string | number)[][]): void {
  const lineas = [headers, ...filas].map((f) => f.map(celda).join(';'));
  const csv = '﻿' + lineas.join('\r\n'); // BOM para que Excel reconozca UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 1380.000 -> 1380,000 (decimal con coma para Excel es-AR).
export const dec = (s: string | number): string => String(s).replace('.', ',');
