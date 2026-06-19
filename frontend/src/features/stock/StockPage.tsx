import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import type { FilaStock } from '../../shared/api/types';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

export function StockPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock'],
    queryFn: () => apiGet<FilaStock[]>('/api/stock'),
  });

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-semibold">Stock actual</h2>
        <p className="text-sm text-slate-500">
          {data ? `${data.length} ítem${data.length === 1 ? '' : 's'} con saldo` : 'Cargando…'}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && <p className="p-6 text-slate-500">Cargando stock…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.length === 0 && <p className="p-6 text-slate-500">Sin stock cargado.</p>}
        {data && data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Ubicación</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Código 3c</th>
                <th className="px-4 py-3 text-right font-medium">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr
                  key={`${f.ubicacion_id}-${f.producto_3c}`}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-slate-700">{f.ubicacion_nombre}</td>
                  <td className="px-4 py-3 text-slate-700">{f.producto_nombre}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.producto_3c}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium tabular-nums ${
                      f.cantidad < 0 ? 'text-rose-600' : 'text-slate-900'
                    }`}
                  >
                    {nf.format(f.cantidad)}
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
