import pkg from 'xlsx';

// Lector de los .xls que escupe el servlet SqlToExcel de 3c
// (`GeneraExcel/servlet/SqlToExcel?id=…`). Son Excel binarios de verdad (BIFF/OLE), no un
// CSV disfrazado, así que hace falta SheetJS: no se pueden partir a mano.
//
// El archivo NO arranca con los encabezados: el servlet mete un preámbulo de 4 filas con el
// título del informe, el id y la fecha de generación. Por eso se BUSCA la fila de
// encabezados en vez de asumir que es la primera, y así el lector no se rompe si mañana el
// preámbulo tiene una línea más o una menos.
//
// Devuelve el mismo `string[][]` que `parseDelimited()` (encabezado + filas), para que los
// importadores que ya existen lo consuman sin enterarse de si vino de un CSV o de un .xls.

const { readFile, utils } = pkg;

/** Cuántas columnas no vacías tiene que tener una fila para pasar por encabezado. */
const MINIMO_COLUMNAS_ENCABEZADO = 5;
/** Hasta qué fila se busca el encabezado antes de darse por vencido. */
const MAXIMO_PREAMBULO = 25;

function limpiar(v: unknown): string {
  if (v === null || v === undefined) return '';
  // En modo crudo las fechas llegan como Date: se emiten dd/mm/yyyy, que es lo que
  // esperan los importadores (igual que las formateadas de Excel).
  if (v instanceof Date) {
    const dd = String(v.getDate()).padStart(2, '0');
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${v.getFullYear()}`;
  }
  return String(v).trim();
}

/**
 * Lee la primera hoja de un .xls/.xlsx y devuelve encabezado + filas de datos.
 *
 * @param archivo ruta al archivo.
 * @param columnaClave nombre de una columna que TIENE que estar en el encabezado. Sirve de
 *   ancla para no confundir una fila del preámbulo con los encabezados. Si no se pasa, se
 *   toma la primera fila con al menos `MINIMO_COLUMNAS_ENCABEZADO` celdas con texto.
 * @param opts.crudo lee los valores como los guardó Excel en vez de como los MUESTRA. Hace
 *   falta cuando el archivo trae plata: una celda con formato moneda se muestra "$5,832" y
 *   ahí ya se perdieron los centavos (el valor real es 5831.83). Las fechas siguen saliendo
 *   dd/mm/yyyy y los booleanos TRUE/FALSE.
 */
export function leerXls(archivo: string, columnaClave?: string, opts: { crudo?: boolean } = {}): string[][] {
  const crudo = opts.crudo === true;
  const wb = readFile(archivo, { cellDates: crudo });
  const nombreHoja = wb.SheetNames[0];
  if (nombreHoja === undefined) throw new Error(`El archivo ${archivo} no tiene ninguna hoja.`);
  const hoja = wb.Sheets[nombreHoja];
  if (hoja === undefined) throw new Error(`No se pudo leer la hoja "${nombreHoja}" de ${archivo}.`);

  // raw:false → los valores vienen ya formateados como los muestra Excel (las fechas salen
  // dd/mm/yyyy, que es lo que esperan los importadores). Con `crudo` se lee el valor real:
  // ver el porqué en el doc de arriba.
  const crudas = utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: crudo, defval: null });

  let iEncabezado = -1;
  for (let i = 0; i < Math.min(crudas.length, MAXIMO_PREAMBULO); i++) {
    const fila = (crudas[i] ?? []).map(limpiar);
    if (columnaClave !== undefined) {
      if (fila.some((c) => c.toUpperCase() === columnaClave.toUpperCase())) {
        iEncabezado = i;
        break;
      }
      continue;
    }
    if (fila.filter((c) => c !== '').length >= MINIMO_COLUMNAS_ENCABEZADO) {
      iEncabezado = i;
      break;
    }
  }
  if (iEncabezado === -1) {
    throw new Error(
      columnaClave !== undefined
        ? `No se encontró la fila de encabezados (buscando la columna "${columnaClave}") en ${archivo}.`
        : `No se encontró la fila de encabezados en ${archivo}.`,
    );
  }

  const encabezado = (crudas[iEncabezado] ?? []).map(limpiar);
  const filas = crudas
    .slice(iEncabezado + 1)
    .map((f) => (f ?? []).map(limpiar))
    // El servlet cierra con filas vacías; y una fila sin la 1ª columna no es un renglón.
    .filter((f) => f.some((c) => c !== ''));

  return [encabezado, ...filas];
}
