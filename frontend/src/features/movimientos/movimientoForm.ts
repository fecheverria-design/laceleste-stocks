import type { MovimientoDetalle, Ubicacion } from '../../shared/api/types';

// Estado y conversión del form de movimiento (compartido entre crear y editar).

export interface RenglonForm {
  producto_3c: string;
  cantidad_real: string;
  cantidad_sugerida: string;
  stock_contado: string; // preservado (no se muestra)
  unidad: string;
  observaciones: string; // preservado (no se muestra)
}

export interface FormState {
  tipo: string;
  origen_dep_id_3c: number;
  destino_dep_id_3c: number;
  fecha: string;
  turno: string;
  proyeccion: string; // preservado (no se muestra)
  observaciones: string;
  renglones: RenglonForm[];
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const renglonVacio = (): RenglonForm => ({
  producto_3c: '',
  cantidad_real: '',
  cantidad_sugerida: '',
  stock_contado: '',
  unidad: 'KG',
  observaciones: '',
});

// Form prellenado desde un movimiento existente (editar).
export function aFormState(m: MovimientoDetalle): FormState {
  return {
    tipo: m.tipo,
    origen_dep_id_3c: m.origen_dep_id_3c,
    destino_dep_id_3c: m.destino_dep_id_3c,
    fecha: m.fecha,
    turno: m.turno ?? '',
    proyeccion: m.proyeccion ?? '',
    observaciones: m.observaciones ?? '',
    renglones: m.detalle.map((r) => ({
      producto_3c: r.producto_3c,
      cantidad_real: r.cantidad_real,
      cantidad_sugerida: r.cantidad_sugerida ?? '',
      stock_contado: r.stock_contado ?? '',
      unidad: r.unidad,
      observaciones: r.observaciones ?? '',
    })),
  };
}

// Baldes virtuales de 3c: no son áreas de producción reales, no sirven de destino default.
const BALDES_VIRTUALES = new Set([101, 102]);

// Form vacío con defaults razonables (crear): RINT, origen = FABRICA (dep 1),
// destino = primer área de producción (excluye baldes), fecha de hoy, un renglón.
export function formVacio(ubicaciones: Ubicacion[], tipoDefault: string): FormState {
  const fabrica =
    ubicaciones.find((u) => u.dep_id_3c === 1) ??
    ubicaciones.find((u) => u.nombre.toUpperCase() === 'FABRICA') ??
    ubicaciones.find((u) => u.tipo === 'DEPOSITO') ??
    ubicaciones[0];
  const area =
    ubicaciones.find((u) => u.tipo === 'AREA' && !BALDES_VIRTUALES.has(u.dep_id_3c)) ??
    ubicaciones.find((u) => u.tipo === 'AREA') ??
    ubicaciones[0];
  const dep = fabrica;
  return {
    tipo: tipoDefault,
    origen_dep_id_3c: dep?.dep_id_3c ?? 0,
    destino_dep_id_3c: area?.dep_id_3c ?? dep?.dep_id_3c ?? 0,
    fecha: hoy(),
    turno: '',
    proyeccion: '',
    observaciones: '',
    renglones: [renglonVacio()],
  };
}

export { renglonVacio };

// ── Validación (front) ───────────────────────────────────────────────────────
// Refleja las reglas del schema Zod del backend (regla #8, mientras no haya paquete
// compartido) + chequeos de UX: cantidad_real obligatoria y > 0 (mueve stock, regla
// #2), hasta 3 decimales, producto y unidad presentes, origen ≠ destino.

export interface RenglonErrores {
  producto_3c?: string;
  cantidad_real?: string;
  cantidad_sugerida?: string;
  unidad?: string;
}

export interface FormErrores {
  origen_dep_id_3c?: string;
  destino_dep_id_3c?: string;
  fecha?: string;
  detalle?: string; // error a nivel lista (sin renglones)
  renglones: RenglonErrores[];
}

// Valida una cantidad escrita en el form. `requerido` exige presencia y > 0.
function errorCantidad(v: string, requerido: boolean): string | undefined {
  const t = v.trim();
  if (t === '') return requerido ? 'Requerido' : undefined;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return 'Número inválido';
  if (n < 0) return 'No puede ser negativo';
  if (requerido && n === 0) return 'Debe ser mayor a 0';
  const decimales = t.includes('.') ? (t.split('.')[1]?.length ?? 0) : t.includes(',') ? (t.split(',')[1]?.length ?? 0) : 0;
  if (decimales > 3) return 'Hasta 3 decimales';
  return undefined;
}

export function validar(f: FormState): FormErrores {
  const e: FormErrores = { renglones: [] };
  if (!f.origen_dep_id_3c) e.origen_dep_id_3c = 'Elegí un origen';
  if (!f.destino_dep_id_3c) e.destino_dep_id_3c = 'Elegí un destino';
  if (f.origen_dep_id_3c && f.destino_dep_id_3c && f.origen_dep_id_3c === f.destino_dep_id_3c) {
    e.destino_dep_id_3c = 'Origen y destino no pueden ser el mismo';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) e.fecha = 'Fecha inválida';
  if (f.renglones.length === 0) e.detalle = 'Agregá al menos un renglón';

  e.renglones = f.renglones.map((r) => {
    const re: RenglonErrores = {};
    if (!r.producto_3c) re.producto_3c = 'Elegí un producto';
    const cr = errorCantidad(r.cantidad_real, true);
    if (cr) re.cantidad_real = cr;
    const cs = errorCantidad(r.cantidad_sugerida, false);
    if (cs) re.cantidad_sugerida = cs;
    if (!r.unidad.trim()) re.unidad = 'Requerido';
    return re;
  });
  return e;
}

export function tieneErrores(e: FormErrores): boolean {
  return (
    Boolean(e.origen_dep_id_3c || e.destino_dep_id_3c || e.fecha || e.detalle) ||
    e.renglones.some((r) => Object.values(r).some(Boolean))
  );
}

// Convierte el form al payload de la API (POST/PUT comparten shape).
export function aPayload(f: FormState) {
  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    tipo: f.tipo,
    origen_dep_id_3c: f.origen_dep_id_3c,
    destino_dep_id_3c: f.destino_dep_id_3c,
    fecha: f.fecha,
    turno: f.turno || undefined,
    proyeccion: f.proyeccion || undefined,
    observaciones: f.observaciones.trim() || undefined,
    detalle: f.renglones.map((r) => ({
      producto_3c: r.producto_3c,
      cantidad_real: Number(r.cantidad_real),
      cantidad_sugerida: numOrUndef(r.cantidad_sugerida),
      stock_contado: numOrUndef(r.stock_contado),
      unidad: r.unidad,
      observaciones: r.observaciones.trim() || undefined,
    })),
  };
}
