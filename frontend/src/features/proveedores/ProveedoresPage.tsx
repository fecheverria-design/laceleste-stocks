import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet, apiPost } from '../../shared/api/client';
import type { GastoProveedor, Proveedor } from '../../shared/api/types';

const ars0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
function arsCorto(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)} mil`;
  return `$${n.toFixed(0)}`;
}
const COLORS = ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16'];
const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

export function ProveedoresPage() {
  const queryClient = useQueryClient();
  const [familia, setFamilia] = useState(''); // '' = todas
  const [texto, setTexto] = useState('');
  // Alta
  const [nuevoNum, setNuevoNum] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCuit, setNuevoCuit] = useState('');
  const [mostrarAlta, setMostrarAlta] = useState(false);

  const proveedores = useQuery({ queryKey: ['proveedores'], queryFn: () => apiGet<Proveedor[]>('/api/proveedores') });
  const familias = useQuery({ queryKey: ['familias'], queryFn: () => apiGet<string[]>('/api/familias') });
  const gasto = useQuery({
    queryKey: ['gasto-proveedores', familia],
    queryFn: () =>
      apiGet<GastoProveedor[]>(`/api/proveedores/gasto${familia ? `?familia=${encodeURIComponent(familia)}` : ''}`),
  });

  const crear = useMutation({
    mutationFn: () =>
      apiPost('/api/proveedores', { numero_3c: Number(nuevoNum), nombre: nuevoNombre, cuit: nuevoCuit || undefined }),
    onSuccess: async () => {
      setNuevoNum('');
      setNuevoNombre('');
      setNuevoCuit('');
      setMostrarAlta(false);
      await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
    },
  });

  // Gráfico: top 12 proveedores por gasto (sumando familias si no se filtró una).
  const chart = useMemo(() => {
    const porProv = new Map<string, number>();
    for (const g of gasto.data ?? []) porProv.set(g.nombre, (porProv.get(g.nombre) ?? 0) + Number(g.gasto_neto));
    return [...porProv.entries()]
      .map(([nombre, valor]) => ({ nombre, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 12)
      .reverse();
  }, [gasto.data]);

  const q = texto.trim().toLowerCase();
  const filas = (proveedores.data ?? []).filter(
    (p) => !q || p.nombre.toLowerCase().includes(q) || String(p.numero_3c ?? '').includes(q),
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Proveedores</h2>
          <p className="text-sm text-slate-500">Gasto por proveedor (compras reales, neto sin IVA)</p>
        </div>
        <button
          onClick={() => setMostrarAlta((v) => !v)}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          {mostrarAlta ? 'Cerrar' : '+ Nuevo proveedor'}
        </button>
      </div>

      {mostrarAlta && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nuevoNum && nuevoNombre) crear.mutate();
          }}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            N° 3c (obligatorio)
            <input type="number" className={inputCls} value={nuevoNum} onChange={(e) => setNuevoNum(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Nombre (obligatorio)
            <input className={`${inputCls} w-64`} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            CUIT
            <input className={inputCls} value={nuevoCuit} onChange={(e) => setNuevoCuit(e.target.value)} />
          </label>
          <button
            type="submit"
            disabled={crear.isPending || !nuevoNum || !nuevoNombre}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {crear.isPending ? 'Creando…' : 'Crear'}
          </button>
          {crear.isError && <span className="text-sm text-rose-700">{(crear.error as Error).message}</span>}
        </form>
      )}

      {/* Gráfico de gasto por proveedor (filtrable por familia) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Gasto por proveedor (top 12)</h3>
          <select className={inputCls} value={familia} onChange={(e) => setFamilia(e.target.value)}>
            <option value="">Todas las familias</option>
            {(familias.data ?? []).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        {chart.length === 0 ? (
          <p className="text-sm text-slate-500">Sin compras para este filtro.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 32)}>
            <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
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
                width={180}
                tick={{ fontSize: 11, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [ars0.format(Number(v)), 'Gasto neto']}
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

      {/* Lista de proveedores */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-xs text-slate-500">{filas.length} proveedores</span>
          <input
            type="search"
            className={inputCls}
            placeholder="Buscar nombre o N° 3c…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">N° 3c</th>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 font-medium">CUIT</th>
              <th className="px-4 py-3 text-right font-medium">Compras</th>
              <th className="px-4 py-3 text-right font-medium">Gasto neto</th>
              <th className="px-4 py-3 font-medium">Familias</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {filas.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{p.numero_3c ?? '—'}</td>
                <td className="px-4 py-2 text-slate-700">{p.nombre}</td>
                <td className="px-4 py-2 text-slate-500">{p.cuit ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">{p.compras}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                  {Number(p.gasto_neto) > 0 ? ars0.format(Number(p.gasto_neto)) : '—'}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{(p.familias ?? []).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
