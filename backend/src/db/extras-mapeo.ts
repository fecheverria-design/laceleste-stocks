// Lógica pura del sync de abastecimientos EXTRAS (ver sync-extras.ts): mapeo de áreas,
// interpretación de fecha_hora y agrupación de los extras sueltos en movimientos.
// Vive aparte del script para poder testearla sin salir a la API ni tocar la DB
// (mismo patrón que sync-maestro.ts).

// Una fila del GET /api/movimientos de la app del compañero: un egreso extra suelto.
// OJO (verificado 2026-07-31 contra los primeros 11 extras reales): la respuesta NO trae
// `codigo_3c`. Trae `articulo_id`, que es el id de la fila del catálogo integral
// (GET /api/abastecimiento/tabla-integral), de donde sale el codigo_3c → ver CatalogoExtras.
// `codigo_3c` queda como opcional por si algún día lo agregan: si viene, gana.
export interface FilaExtra {
  id: number | string | null;
  fecha_hora: string | null;
  articulo_id: string | number | null;
  codigo_3c?: string | number | null;
  articulo_nombre: string | null;
  area: string | null;
  codigo_area?: string | number | null;
  cantidad: string | number | null;
  unidad: string | null;
  nota: string | null;
  usuario: string | null;
}

// articulo_id de su app → codigo_3c del producto. Se arma con la tabla integral de su propia
// API (ver sync-extras.ts): el código NO se deriva ni se inventa, sale de su dato (regla #1).
export type CatalogoExtras = Map<number, string>;

// Fila de la tabla integral, lo mínimo que necesitamos para armar el catálogo.
export interface FilaCatalogo {
  id: number | string | null;
  codigo_3c: string | number | null;
}

export function armarCatalogo(filas: FilaCatalogo[], acumulado?: CatalogoExtras): CatalogoExtras {
  const cat: CatalogoExtras = acumulado ?? new Map();
  for (const f of filas) {
    const id = aNumero(f.id);
    const cod = f.codigo_3c === null || f.codigo_3c === undefined ? '' : String(f.codigo_3c).trim();
    if (id === null || cod === '') continue;
    cat.set(id, cod);
  }
  return cat;
}

// Áreas de su app → dep_id_3c (regla #1: los ids son de 3c, no se inventan). La tabla es la
// que su propio front usa para el <select> del botón de extras; verificada contra el export
// de movimientos de 3c del 29/07/2026 (aparecen 39, 43, 45, 47, 48, 49, 51).
// `null` = área sin depósito en 3c → no hay dónde imputar el egreso: se saltea y se avisa.
export const AREAS_3C: Record<string, number | null> = {
  SANDWICHERIA: 50,
  PANADERIA: 47,
  RECETAS: 49,
  PASTELERIA: 48,
  HELADERIA: 51,
  'RECETAS EN AREAS': null,
  CRIOLLITA: 39,
  LIMPIEZA: 45,
  LOCALES: 43,
  'ADM/CADETERIA/DUENOS': 40,
};

// Normaliza el nombre del área para que el mapeo no dependa de tildes ni de mayúsculas
// (su front escribe "PASTELERÍA" con tilde y "ADM/CADETERIA/DUEÑOS" con eñe).
export function normalizarArea(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export const TZ = 'America/Argentina/Buenos_Aires';

export function hoyEnBsAs(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(new Date());
}

// fecha_hora del origen → { fecha: YYYY-MM-DD, hora: HH:MM } en hora de Buenos Aires.
// Su front lo carga con un <input type="datetime-local"> (sin zona), así que lo normal es que
// vuelva como "2026-07-30T15:42:00" o "2026-07-30 15:42:00" → se toma tal cual. Si en cambio
// viniera con Z u offset, se convierte a la zona local: sin esto un extra cargado de noche
// caería en el día siguiente y el RINT quedaría con la fecha corrida.
export function fechaHoraLocal(s: string): { fecha: string; hora: string } | null {
  const t = s.trim();
  const sinZona = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (sinZona && !/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    return { fecha: sinZona[1]!, hora: sinZona[2]! };
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    // Último recurso: si al menos empieza con una fecha, alcanza para agrupar.
    const soloFecha = t.match(/^(\d{4}-\d{2}-\d{2})/);
    return soloFecha ? { fecha: soloFecha[1]!, hora: '' } : null;
  }
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(d);
  const hora = new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return { fecha, hora };
}

// Redondea a 3 decimales (coincide con numeric(12,3) y el refine del schema).
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function aNumero(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface RenglonExtra {
  producto_3c: string;
  cantidad_real: number;
  unidad: string;
  observaciones?: string;
}

export interface GrupoExtras {
  fecha: string;
  destino_dep_id_3c: number;
  area: string;
  detalle: RenglonExtra[];
}

export interface DescartesExtras {
  fueraDeVentana: number;
  sinFecha: number;
  sinCantidad: number;
  sinProducto: number;
  areasDesconocidas: Set<string>;
  areasSinDeposito: Set<string>;
  // articulo_id que no está en el catálogo integral → no sabemos su codigo_3c.
  articulosSinCatalogo: Set<string>;
  // codigo_area del origen que no coincide con nuestra tabla: gana el del origen, pero se avisa.
  areasEnConflicto: Set<string>;
}

// Fechas (Buenos Aires) de las filas que caen dentro de la ventana. Sirve para saber de qué
// días hay que traer la tabla integral y armar el catálogo, sin pedir días de más.
export function fechasDeFilas(filas: FilaExtra[], ventana: Set<string>): string[] {
  const out = new Set<string>();
  for (const f of filas) {
    const fh = f.fecha_hora ? fechaHoraLocal(f.fecha_hora) : null;
    if (fh && ventana.has(fh.fecha)) out.add(fh.fecha);
  }
  return [...out].sort();
}

// Agrupa los extras por (fecha, área) y consolida los renglones repetidos del mismo producto.
// `fechas` acota a la ventana pedida (el origen podría devolver bordes de más).
// `catalogo` resuelve articulo_id → codigo_3c (ver armarCatalogo).
export function agruparExtras(
  filas: FilaExtra[],
  fechas: Set<string>,
  catalogo: CatalogoExtras = new Map(),
): { grupos: GrupoExtras[]; descartes: DescartesExtras } {
  const porClave = new Map<string, GrupoExtras>();
  const descartes: DescartesExtras = {
    fueraDeVentana: 0,
    sinFecha: 0,
    sinCantidad: 0,
    sinProducto: 0,
    areasDesconocidas: new Set(),
    areasSinDeposito: new Set(),
    articulosSinCatalogo: new Set(),
    areasEnConflicto: new Set(),
  };

  for (const f of filas) {
    const fh = f.fecha_hora ? fechaHoraLocal(f.fecha_hora) : null;
    if (!fh) {
      descartes.sinFecha++;
      continue;
    }
    if (!fechas.has(fh.fecha)) {
      descartes.fueraDeVentana++;
      continue;
    }

    const areaRaw = (f.area ?? '').trim();
    // El origen manda `codigo_area` (= dep_id_3c) junto al nombre: es SU dato, así que gana
    // sobre nuestra tabla (verificado 2026-07-31: RECETAS→49, LIMPIEZA→45, coinciden). Esto
    // además hace entrar solas las áreas nuevas, sin tocar AREAS_3C.
    const depOrigen = aNumero(f.codigo_area ?? null);
    const depTabla = AREAS_3C[normalizarArea(areaRaw)];
    let dep: number | null | undefined;
    if (depOrigen !== null && depOrigen > 0) {
      dep = depOrigen;
      if (typeof depTabla === 'number' && depTabla !== depOrigen) {
        descartes.areasEnConflicto.add(`${areaRaw}: origen ${depOrigen} ≠ nuestro ${depTabla}`);
      }
    } else {
      dep = depTabla;
    }
    if (dep === undefined) {
      // Área nueva en su app que todavía no mapeamos: NO se adivina un id (regla #1).
      descartes.areasDesconocidas.add(areaRaw || '(vacía)');
      continue;
    }
    if (dep === null) {
      descartes.areasSinDeposito.add(areaRaw);
      continue;
    }

    const cant = aNumero(f.cantidad);
    if (cant === null || cant <= 0) {
      descartes.sinCantidad++;
      continue;
    }

    // Producto: si algún día su API manda codigo_3c, gana; hoy hay que resolverlo por el
    // catálogo integral (articulo_id → codigo_3c). Si no está, se descarta y se avisa CON el
    // id, para poder ir a buscarlo: nunca se deriva un código de la numeración (regla #1).
    const codDirecto = f.codigo_3c === null || f.codigo_3c === undefined ? '' : String(f.codigo_3c).trim();
    const artId = aNumero(f.articulo_id);
    const prod = codDirecto !== '' ? codDirecto : artId !== null ? (catalogo.get(artId) ?? '') : '';
    if (prod === '') {
      descartes.sinProducto++;
      if (codDirecto === '' && artId !== null) {
        descartes.articulosSinCatalogo.add(`${artId}${f.articulo_nombre ? ` ${f.articulo_nombre}` : ''}`);
      }
      continue;
    }

    const clave = `${fh.fecha}:${dep}`;
    let grupo = porClave.get(clave);
    if (!grupo) {
      grupo = { fecha: fh.fecha, destino_dep_id_3c: dep, area: areaRaw, detalle: [] };
      porClave.set(clave, grupo);
    }

    // Rastro de cada extra: hora + nota + quién lo cargó. Como los agrupamos por día, esto
    // es lo único que queda de la carga individual.
    const rastro = [fh.hora, (f.nota ?? '').trim(), (f.usuario ?? '').trim()].filter((p) => p !== '').join(' · ');

    const existente = grupo.detalle.find((r) => r.producto_3c === prod);
    if (existente) {
      // Mismo producto cargado dos veces el mismo día para la misma área → un solo renglón.
      existente.cantidad_real = round3(existente.cantidad_real + cant);
      if (rastro) {
        existente.observaciones = `${existente.observaciones ? `${existente.observaciones} | ` : ''}${rastro}`.slice(0, 500);
      }
    } else {
      grupo.detalle.push({
        producto_3c: prod,
        cantidad_real: round3(cant),
        unidad: (f.unidad ?? '').trim() || 'UNIDAD',
        observaciones: rastro ? rastro.slice(0, 500) : undefined,
      });
    }
  }

  // Orden estable por producto: el diff del modo reconciliar compara los renglones en orden,
  // y sin esto el mismo contenido en distinto orden se vería como una edición.
  const grupos = [...porClave.values()].filter((g) => g.detalle.length > 0);
  for (const g of grupos) g.detalle.sort((a, b) => a.producto_3c.localeCompare(b.producto_3c));
  return { grupos, descartes };
}
