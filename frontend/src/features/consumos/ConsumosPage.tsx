import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../../shared/api/client';
import type { Consumos } from '../../shared/api/types';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const hoyYmd = () => new Date().toISOString().slice(0, 10);
const haceSemanas = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().slice(0, 10);
};

const COLORS = ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16'];

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

export function ConsumosPage() {
  const [desde, setDesde] = useState(haceSemanas(12));
  const [hasta, setHasta] = useState(hoyYmd());
  const [texto, setTexto] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['consumos', desde, hasta],
    queryFn: () => apiGet<Consumos>(`/api/consumos?desde=${desde}&hasta=${hasta}`),
  });

  const q = texto.trim().toLowerCase();
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (i) => !q || i.producto_nombre.toLowerCase().includes(q) || i.producto_3c.toLowerCase().includes(q),
      ),
    [data, q],
  );

  // Productos distintos en el filtro actual (para decidir el gráfico).
  const productosFiltrados = useMemo(() => [...new Set(items.map((i) => i.producto_3c))], [items]);
  const unProducto = productosFiltrados.length === 1 ? items[0] : null;

  // Gráfico: si hay un solo producto filtrado → consumo semanal por área de ese producto.
  //          si no → top 12 combinaciones (producto · área) por consumo semanal.
  const chart = unProducto
    ? items
        .filter((i) => i.promedio_semanal > 0)
        .map((i) => ({ label: i.area_nombre, valor: i.promedio_semanal }))
    : [...items]
        .filter((i) => i.promedio_semanal > 0)
        .sort((a, b) => b.promedio_semanal - a.promedio_semanal)
        .slice(0, 12)
        .map((i) => ({ label: `${i.producto_nombre} · ${i.area_nombre}`, valor: i.promedio_semanal }))
        .reverse();

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Consumos por área</h2>
          <p className="text-sm text-slate-500">
            {data
              ? `Promedio semanal sobre ${nf.format(data.semanas)} semanas (${data.desde} → ${data.hasta})`
              : 'Cargando…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className={inputCls}
            placeholder="Buscar producto…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <label className="flex items-center gap-1 text-sm text-slate-500">
            Desde
            <input type="date" className={inputCls} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-500">
            Hasta
            <input type="date" className={inputCls} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
        </div>
      </div>

      {isError && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">Error: {(error as Error).message}</p>
      )}
      {isLoading && <p className="text-slate-500">Cargando consumos…</p>}

      {data && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              {unProducto
                ? `Consumo semanal por área · ${unProducto.producto_nombre} (${unProducto.unidad_base})`
                : 'Top consumos semanales (producto · área)'}
            </h3>
            {chart.length === 0 ? (
              <p className="text-sm text-slate-500">Sin consumo en el período/filtro.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, chart.length * 30)}>
                <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => nf0.format(v)}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={unProducto ? 120 : 220}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [`${nf.format(Number(v))} ${unProducto?.unidad_base ?? ''}/sem`, 'Promedio']}
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                    {chart.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Área</th>
                  <th className="px-4 py-3 text-right font-medium">Prom. semanal</th>
                  <th className="px-4 py-3 text-right font-medium">Total período</th>
                  <th className="px-4 py-3 font-medium">Unidad</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-slate-500">
                      Sin consumos para este filtro.
                    </td>
                  </tr>
                )}
                {items.map((i) => (
                  <tr key={`${i.producto_3c}-${i.area_id}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-700">
                      <span className="mr-1.5 font-mono text-xs text-slate-400">{i.producto_3c}</span>
                      {i.producto_nombre}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{i.area_nombre}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                      {nf.format(i.promedio_semanal)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{nf.format(i.total)}</td>
                    <td className="px-4 py-2 text-slate-500">{i.unidad_base}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
