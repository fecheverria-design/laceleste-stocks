// Piezas de tabla que se repiten en todas las hojas de listado: encabezado ordenable y
// paginado. Viven acá para que Movimientos, Stock, Precios y Artículos se vean y se
// comporten igual (y para no volver a escribir la lógica de la flechita).

import type { ReactNode } from 'react';
import { IconoChevron } from './iconos';

export const CLS_INPUT =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition ' +
  'placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20';

export const CLS_BOTON =
  'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium ' +
  'text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100';

export const CLS_BOTON_PRIMARIO =
  'inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition ' +
  'hover:bg-sky-700 active:bg-sky-800';

// ─────────────────────────────────────────────────────────────────────────────
// Encabezado ordenable: clic alterna asc/desc; la flecha solo aparece en la
// columna activa (una flecha en cada columna es ruido y no dice nada).
// ─────────────────────────────────────────────────────────────────────────────
interface ThOrdenProps<T extends string> {
  campo: T;
  orden: T;
  dir: 'asc' | 'desc';
  onOrdenar: (campo: T) => void;
  children: ReactNode;
  alineado?: 'izq' | 'der';
}

export function ThOrden<T extends string>({
  campo,
  orden,
  dir,
  onOrdenar,
  children,
  alineado = 'izq',
}: ThOrdenProps<T>) {
  const activo = orden === campo;
  return (
    <th className={`px-4 py-3 font-medium ${alineado === 'der' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onOrdenar(campo)}
        className={`group inline-flex items-center gap-1 transition hover:text-slate-900 ${
          activo ? 'text-slate-900' : 'text-slate-500'
        }`}
        title={`Ordenar por ${String(children)}`}
      >
        {children}
        <IconoChevron
          className={`h-3.5 w-3.5 transition ${
            activo
              ? `opacity-100 ${dir === 'asc' ? 'rotate-180' : ''}`
              : 'opacity-0 group-hover:opacity-40'
          }`}
        />
      </button>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginado. Muestra el rango real ("51–100 de 18.649") porque saber cuántos hay
// en total sin saber dónde estás parado no orienta a nadie.
// ─────────────────────────────────────────────────────────────────────────────
interface PaginacionProps {
  page: number;
  limit: number;
  total: number;
  onPage: (p: number) => void;
}

export function Paginacion({ page, limit, total, onPage }: PaginacionProps) {
  const paginas = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  const desde = (page - 1) * limit + 1;
  const hasta = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
      <p className="text-slate-500">
        <span className="font-medium text-slate-700">
          {desde.toLocaleString('es-AR')}–{hasta.toLocaleString('es-AR')}
        </span>{' '}
        de {total.toLocaleString('es-AR')}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          ← Anterior
        </button>
        <span className="px-2 text-slate-500">
          {page} / {paginas.toLocaleString('es-AR')}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= paginas}
          className="rounded-lg px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}
