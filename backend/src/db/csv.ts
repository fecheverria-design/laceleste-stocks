// Parser de texto delimitado (CSV/TSV) robusto y sin dependencias.
// Autodetecta el separador (tab, ';' o ',') de la primera línea, maneja campos
// entre comillas dobles con "" escapadas, BOM UTF-8 y saltos \r\n.

export function parseDelimited(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM

  // Detectar separador: el que más aparece en la primera línea no vacía.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let delim = ',';
  let mejor = -1;
  for (const c of ['\t', ';', ',']) {
    const n = firstLine.split(c).length - 1;
    if (n > mejor) {
      mejor = n;
      delim = c;
    }
  }

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Descarta filas totalmente vacías.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Mapea nombres de columna requeridos a su índice (case-insensitive), para no
// depender del orden. Lanza si falta alguna.
export function indexarColumnas(headers: string[], requeridas: string[]): Record<string, number> {
  const norm = headers.map((h) => h.trim().toUpperCase());
  const idx: Record<string, number> = {};
  for (const req of requeridas) {
    const i = norm.indexOf(req.toUpperCase());
    if (i === -1) {
      throw new Error(`Falta la columna "${req}". Encabezados encontrados: ${headers.join(' | ')}`);
    }
    idx[req] = i;
  }
  return idx;
}
