import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../shared/api/client';
import type { InventarioDetalle, InventarioResumen, Ubicacion } from '../../shared/api/types';

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';
const INSUMOS = ['PACKAGING', 'MATERIAS PRIMAS', 'DESCARTABLES', 'LIMPIEZA', 'MERCHANDISING'];

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function InventariosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [alta, setAlta] = useState(false);
  const [ubicacionId, setUbicacionId] = useState<number | ''>('');
  const [fecha, setFecha] = useState(hoy());
  const [familias, setFamilias] = useState<string[]>(INSUMOS);
  const [error, setError] = useState<string | null>(null);

  const inventarios = useQuery({ queryKey: ['inventarios'], queryFn: () => apiGet<InventarioResumen[]>('/api/inventarios') });
  const ubicaciones = useQuery({ queryKey: ['ubicaciones'], queryFn: () => apiGet<Ubicacion[]>('/api/ubicaciones') });
  const familiasDisp = useQuery({ queryKey: ['articulos-familias'], queryFn: () => apiGet<string[]>('/api/articulos/familias') });

  const depositos = (ubicaciones.data ?? []).filter((u) => u.tipo === 'DEPOSITO');

  const crear = useMutation({
    mutationFn: () =>
      apiPost<InventarioDetalle>('/api/inventarios', {
        ubicacion_id: Number(ubicacionId),
        fecha,
        familias,
      }),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: ['inventarios'] });
      navigate(`/inventarios/${inv.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo crear'),
  });

  const toggleFamilia = (f: string) =>
    setFamilias((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const puedeCrear = ubicacionId !== '' && fecha !== '' && familias.length > 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold">Inventarios</h2>
          <p className="text-sm text-slate-500">Conteo físico → genera los ajustes de stock automáticamente.</p>
        </div>
        <button
          onClick={() => {
            setAlta((v) => !v);
            setError(null);
          }}
          className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          + Nuevo inventario
        </button>
      </div>

      {alta && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Nueva hoja de inventario</h3>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Depósito
              <select className={inputCls} value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Elegí…</option>
                {depositos.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Fecha
              <input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <p className="mb-1 text-xs text-slate-500">Familias a contar</p>
            <div className="flex flex-wrap gap-2">
              {(familiasDisp.data ?? INSUMOS).map((f) => (
                <label
                  key={f}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                    familias.includes(f) ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <input type="checkbox" className="mr-1.5 align-middle" checked={familias.includes(f)} onChange={() => toggleFamilia(f)} />
                  {f}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              disabled={!puedeCrear || crear.isPending}
              onClick={() => crear.mutate()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {crear.isPending ? 'Creando…' : 'Crear y empezar a contar'}
            </button>
            <button onClick={() => setAlta(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Depósito</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Progreso</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(inventarios.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Sin inventarios. Creá uno con “+ Nuevo inventario”.
                </td>
              </tr>
            )}
            {(inventarios.data ?? []).map((inv) => (
              <tr
                key={inv.id}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                onClick={() => navigate(`/inventarios/${inv.id}`)}
              >
                <td className="px-4 py-2">{inv.fecha}</td>
                <td className="px-4 py-2">{inv.ubicacion_nombre}</td>
                <td className="px-4 py-2">
                  <span className={inv.estado === 'CONFIRMADO' ? 'text-emerald-600' : 'text-amber-600'}>{inv.estado}</span>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {inv.contadas}/{inv.lineas} contados
                </td>
                <td className="px-4 py-2 text-right text-sky-600">Abrir →</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
