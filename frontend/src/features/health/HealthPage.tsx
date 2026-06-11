import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';

interface Health {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

// Pantalla placeholder de Fase 0: pega a /api/health y muestra el estado.
export function HealthPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<Health>('/api/health'),
    refetchInterval: 10_000,
  });

  const dbUp = data?.db === 'up';

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-8">
        <p className="text-xs font-medium uppercase tracking-widest text-sky-600">La Celeste</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Movimientos Internos</h1>
        <p className="mt-1 text-sm text-slate-500">Estado del backend · Fase 0</p>

        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          {isLoading && <p className="text-slate-500">Consultando <code>/api/health</code>…</p>}

          {isError && (
            <div className="flex items-center gap-3">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
              <div>
                <p className="font-medium text-red-700">Backend inalcanzable</p>
                <p className="text-sm text-slate-500">{(error as Error).message}</p>
                <p className="mt-1 text-xs text-slate-400">¿Está levantado en localhost:3000?</p>
              </div>
            </div>
          )}

          {data && (
            <div className="flex items-center gap-3">
              <span
                className={`inline-block h-3 w-3 rounded-full ${dbUp ? 'bg-emerald-500' : 'bg-amber-500'}`}
              />
              <div className="flex-1">
                <p className="font-medium text-slate-900">
                  API: {data.status} · DB: {data.db}
                </p>
                <p className="text-sm text-slate-500">
                  uptime {data.uptimeSeconds}s · {new Date(data.timestamp).toLocaleTimeString('es-AR')}
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-400">Se refresca cada 10s.</p>
      </div>
    </main>
  );
}
