// Piezas visuales compartidas por todas las hojas. La idea: que el celeste de La Celeste sea
// el color de la marca (acentos, foco, lo accionable) y el slate quede de fondo neutro para
// que los datos se lean. El color se usa para decir algo, no para decorar.

import type { ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Encabezado de página: título, bajada y acciones. La barrita celeste a la izquierda
// es el hilo visual que se repite en todas las hojas.
// ─────────────────────────────────────────────────────────────────────────────
export function EncabezadoPagina({
  titulo,
  bajada,
  acciones,
}: {
  titulo: string;
  bajada?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="border-l-4 border-sky-500 pl-3">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{titulo}</h2>
        {bajada && <p className="text-sm text-slate-500">{bajada}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tarjeta de dato: un número grande con su etiqueta. Para los totales de arriba
// de cada hoja (cuántos productos, cuánto vale el stock, cuántos sin precio…).
// `tono` marca cuándo el número pide atención en vez de solo informar.
// ─────────────────────────────────────────────────────────────────────────────
const TONOS = {
  neutro: 'border-slate-200 bg-white',
  celeste: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white',
  alerta: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white',
  ok: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
} as const;

const TONOS_VALOR = {
  neutro: 'text-slate-900',
  celeste: 'text-sky-700',
  alerta: 'text-amber-700',
  ok: 'text-emerald-700',
} as const;

export function Tarjeta({
  etiqueta,
  valor,
  detalle,
  tono = 'neutro',
  onClick,
}: {
  etiqueta: string;
  valor: ReactNode;
  detalle?: ReactNode;
  tono?: keyof typeof TONOS;
  onClick?: () => void;
}) {
  const contenido = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${TONOS_VALOR[tono]}`}>{valor}</p>
      {detalle && <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>}
    </>
  );
  const cls = `rounded-xl border p-4 shadow-sm ${TONOS[tono]}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} text-left transition hover:shadow-md`}>
        {contenido}
      </button>
    );
  }
  return <div className={cls}>{contenido}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiqueta de familia. Color estable derivado del nombre: la misma familia se ve
// siempre del mismo color, así se reconoce de un vistazo al escanear la tabla.
// ─────────────────────────────────────────────────────────────────────────────
const COLORES_FAMILIA = [
  'bg-sky-50 text-sky-700 ring-sky-200',
  'bg-violet-50 text-violet-700 ring-violet-200',
  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'bg-amber-50 text-amber-700 ring-amber-200',
  'bg-rose-50 text-rose-700 ring-rose-200',
  'bg-teal-50 text-teal-700 ring-teal-200',
  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'bg-orange-50 text-orange-700 ring-orange-200',
];

export function EtiquetaFamilia({ familia }: { familia: string | null }) {
  if (!familia) return <span className="text-xs text-slate-400">—</span>;
  // Hash simple y estable (no hace falta que sea criptográfico, solo determinístico).
  let h = 0;
  for (let i = 0; i < familia.length; i++) h = (h * 31 + familia.charCodeAt(i)) >>> 0;
  const cls = COLORES_FAMILIA[h % COLORES_FAMILIA.length];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {familia}
    </span>
  );
}

// Contenedor de tabla: el marco blanco redondeado que usan todas las hojas.
export function Panel({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{children}</div>;
}

// Estado vacío con una salida a mano (limpiar filtros), en vez de un texto suelto.
export function Vacio({ mensaje, accion }: { mensaje: string; accion?: ReactNode }) {
  return (
    <div className="p-10 text-center">
      <p className="font-medium text-slate-700">{mensaje}</p>
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}
