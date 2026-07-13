import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet } from '../../shared/api/client';
import type { Consumos } from '../../shared/api/types';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const ars0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
function arsCorto(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)} mil`;
  return `$${n.toFixed(0)}`;
}
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
  const [area, setArea] = useState(''); // '' = todas

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['consumos', desde, hasta],
    queryFn: () => apiGet<Consumos>(`/api/consumos?desde=${desde}&hasta=${hasta}`),
  });

  // Áreas presentes (para el filtro).
  const areaOpts = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of data?.items ?? []) m.set(i.area_id, i.area_nombre);
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [data]);

  const q = texto.trim().toLowerCase();
  const items = useMemo(
    () =>
      (data?.items ?? []).filter((i) => {
        if (area && String(i.area_id) !== area) return false;
        if (q && !i.producto_nombre.toLowerCase().includes(q) && !i.producto_3c.toLowerCase().includes(q)) return false;
        return true;
      }),
    [data, q, area],
  );

  // El gráfico solo es representativo para UN producto (todas sus áreas en la misma
  // unidad). Comparar entre productos no sirve: mezcla kg, unidades, litros.
  // Costo de consumo por área ($, comparable entre áreas y productos). Respeta los filtros.
  const costoPorArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.costo != null) m.set(i.area_nombre, (m.get(i.area_nombre) ?? 0) + i.costo);
    return [...m.entries()].map(([label, valor]) => ({ label, valor })).sort((a, b) => b.valor - a.valor);
  }, [items]);
  const costoFiltrado = useMemo(() => items.reduce((a, i) => a + (i.costo ?? 0), 0), [items]);

  const productosFiltrados = useMemo(() => [...new Set(items.map((i) => i.producto_3c))], [items]);
  const unProducto = productosFiltrados.length === 1 ? items[0] : null;
  // Para el producto en foco, muestro TODAS sus áreas (ignora el filtro de área, que
  // afecta solo la tabla). Misma unidad → comparación válida.
  const chart = unProducto
    ? (data?.items ?? [])
        .filter((i) => i.producto_3c === unProducto.producto_3c && i.promedio_semanal > 0)
        .map((i) => ({ label: i.area_nombre, valor: i.promedio_semanal }))
        .sort((a, b) => b.valor - a.valor)
    : [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Consumos por área</h2>
          <p className="text-sm text-slate-500">
            {data
              ? `${data.desde} → ${data.hasta} (${nf.format(data.semanas)} sem) · costo consumido ${ars0.format(costoFiltrado)}`
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
          <select className={inputCls} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areaOpts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
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
          {/* Costo de consumo por área ($): comparable entre áreas y productos */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Costo de consumo por área {unProducto ? `· ${unProducto.producto_nombre}` : ''}
            </h3>
            {costoPorArea.length === 0 ? (
              <p className="text-sm text-slate-500">Sin costo (faltan precios para estos productos).</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, costoPorArea.length * 30)}>
                <BarChart data={costoPorArea} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <XAxis
                    type="number"
                    tickFormatter={arsCorto}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [ars0.format(Number(v)), 'Costo']}
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                    {costoPorArea.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              {unProducto
                ? `Consumo semanal por área · ${unProducto.producto_nombre} (${unProducto.unidad_base})`
                : 'Consumo semanal por área'}
            </h3>
            {chart.length === 0 ? (
              <p className="text-sm text-slate-500">
                {unProducto
                  ? 'Sin consumo en el período.'
                  : 'Buscá un producto para ver el gráfico por área. (No se comparan varios productos juntos: las unidades difieren — kg, unidades, litros.)'}
              </p>
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
                  <th className="px-4 py-3 text-right font-medium">Costo período</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-slate-500">
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
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {i.costo == null ? <span className="text-slate-400">s/precio</span> : ars0.format(i.costo)}
                    </td>
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
