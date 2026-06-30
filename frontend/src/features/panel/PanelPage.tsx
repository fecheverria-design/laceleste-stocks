import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../../shared/api/client';
import type { Valorizacion } from '../../shared/api/types';

const ars0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
// Abrevia magnitudes grandes para ejes/tooltips: 78.000.000.000 → "$78,1 MM".
function arsCorto(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)} mil`;
  return `$${n.toFixed(0)}`;
}

// Paleta sky/teal para las barras (combina con el resto).
const COLORS = ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e'];

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function PanelPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['valorizacion'],
    queryFn: () => apiGet<Valorizacion>('/api/valorizacion'),
  });

  if (isLoading) return <p className="text-slate-500">Cargando panel…</p>;
  if (isError)
    return (
      <p className="text-rose-700">
        Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
      </p>
    );
  if (!data) return null;

  const total = Number(data.total.valor_total);
  // Top productos para el gráfico (de mayor a menor; Recharts dibuja de abajo hacia arriba).
  const topChart = [...data.top_productos]
    .map((p) => ({ nombre: p.producto_nombre, valor: Number(p.valor) }))
    .reverse();

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Panel</h2>
        <p className="text-sm text-slate-500">Valorización del stock a precio vigente</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Valor total del stock" value={ars0.format(total)} sub="cantidad × precio vigente" />
        <KpiCard
          label="Ítems valorizados"
          value={num.format(data.total.items_valorizados)}
          sub={data.total.items_sin_precio > 0 ? `${data.total.items_sin_precio} sin precio` : 'cobertura total'}
        />
        <KpiCard label="Depósitos con stock" value={String(data.total.depositos)} />
      </div>

      {/* Top productos por valor */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Top productos por valor</h3>
        {topChart.length === 0 ? (
          <p className="text-sm text-slate-500">Sin datos para valorizar.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, topChart.length * 34)}>
            <BarChart data={topChart} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <XAxis
                type="number"
                tickFormatter={arsCorto}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                width={150}
                tick={{ fontSize: 11, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [ars2.format(Number(v)), 'Valor']}
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                {topChart.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Valor por depósito (tabla: FABRICA suele dominar, una barra no rinde) */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Valor por depósito</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 font-medium">Dep</th>
              <th className="px-4 py-2 font-medium">Depósito</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
              <th className="px-4 py-2 text-right font-medium">Participación</th>
            </tr>
          </thead>
          <tbody>
            {data.por_deposito.map((d) => {
              const v = Number(d.valor);
              const pct = total > 0 ? (v / total) * 100 : 0;
              return (
                <tr key={d.ubicacion_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{d.ubicacion_dep_id_3c}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {d.ubicacion_nombre}
                    {d.sin_precio > 0 && (
                      <span className="ml-2 text-xs text-amber-600">{d.sin_precio} s/precio</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">{ars0.format(v)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                    <div className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                      </span>
                      {pct.toFixed(1)}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
