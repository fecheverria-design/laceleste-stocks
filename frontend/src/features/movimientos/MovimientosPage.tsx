import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import type { EstadoMovimiento, ListaMovimientos } from '../../shared/api/types';

type FiltroEstado = EstadoMovimiento | 'TODOS';
const FILTROS: FiltroEstado[] = ['TODOS', 'CONFIRMADO', 'ANULADO', 'BORRADOR'];

const BADGE: Record<EstadoMovimiento, string> = {
  CONFIRMADO: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ANULADO: 'bg-rose-50 text-rose-700 ring-rose-200',
  BORRADOR: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const TIPO_LABEL: Record<string, string> = {
  RECEPCION: 'Recepción',
  RINT: 'Remito interno',
  AJUSTE: 'Ajuste',
};

export function MovimientosPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<FiltroEstado>('TODOS');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movimientos', estado],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '50' });
      if (estado !== 'TODOS') qs.set('estado', estado);
      return apiGet<ListaMovimientos>(`/api/movimientos?${qs.toString()}`);
    },
  });

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Movimientos</h2>
          <p className="text-sm text-slate-500">
            {data ? `${data.total} movimiento${data.total === 1 ? '' : 's'}` : 'Cargando…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {FILTROS.map((f) => (
              <button
                key={f}
                onClick={() => setEstado(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  estado === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {f === 'TODOS' ? 'Todos' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <Link
            to="/movimientos/nuevo"
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
          >
            + Nuevo
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && <p className="p-6 text-slate-500">Cargando movimientos…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.items.length === 0 && <p className="p-6 text-slate-500">No hay movimientos para este filtro.</p>}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Nro</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Origen → Destino</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/movimientos/${m.id}`)}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{m.nro}</td>
                  <td className="px-4 py-3 text-slate-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[m.estado]}`}
                    >
                      {m.estado.charAt(0) + m.estado.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.fecha}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {m.origen_nombre} <span className="text-slate-400">→</span> {m.destino_nombre}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
