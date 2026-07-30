// Barra de filtros compartida. El problema que resuelve: cuando una hoja tiene 9 filtros en
// una fila, todos pesan lo mismo, no se ve cuáles están puestos y hay que barrer con la vista
// para encontrar el que buscás. Acá lo frecuente queda a la vista, el resto se pliega, y lo
// que está activo se muestra como chips que se sacan de a uno.

import type { ReactNode } from 'react';
import { IconoCruz, IconoFiltro } from './iconos';

// Un filtro activo, para el chip. `label` es lo que se lee ("Área: Panadería").
export interface ChipFiltro {
  key: string;
  label: string;
  onQuitar: () => void;
}

interface BarraFiltrosProps {
  // Fila siempre visible: buscador, pestañas de estado, lo que use la hoja.
  principal: ReactNode;
  // Filtros secundarios: se muestran solo con el panel abierto.
  avanzados?: ReactNode;
  abierto: boolean;
  onToggle: () => void;
  chips: ChipFiltro[];
  onLimpiar: () => void;
  acciones?: ReactNode;
}

export function BarraFiltros({
  principal,
  avanzados,
  abierto,
  onToggle,
  chips,
  onLimpiar,
  acciones,
}: BarraFiltrosProps) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {principal}
        {avanzados && (
          <button
            type="button"
            onClick={onToggle}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
              abierto || chips.length > 0
                ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <IconoFiltro />
            Filtros
            {chips.length > 0 && (
              <span className="rounded-full bg-sky-600 px-1.5 text-xs font-semibold text-white">{chips.length}</span>
            )}
          </button>
        )}
        {acciones && <div className="ml-auto flex items-center gap-2">{acciones}</div>}
      </div>

      {abierto && avanzados && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {avanzados}
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-2.5 pr-1.5 text-xs font-medium text-slate-700"
            >
              {c.label}
              <button
                type="button"
                onClick={c.onQuitar}
                className="rounded-full p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                title={`Quitar ${c.label}`}
              >
                <IconoCruz />
              </button>
            </span>
          ))}
          <button type="button" onClick={onLimpiar} className="text-xs font-medium text-sky-600 hover:underline">
            Limpiar todo
          </button>
        </div>
      )}
    </div>
  );
}

// Campo etiquetado para el panel de avanzados: la etiqueta arriba y chico, para que se
// entienda qué es cada select sin tener que abrirlo.
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
