import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../shared/api/client';
import type {
  FilaHistorial,
  MovimientoDetalle,
  Producto,
  TipoMovimiento,
  Ubicacion,
} from '../../shared/api/types';

interface RenglonForm {
  producto_3c: string;
  cantidad_real: string;
  cantidad_sugerida: string;
  stock_contado: string; // preservado (no se muestra)
  unidad: string;
  observaciones: string; // preservado (no se muestra)
}

interface FormState {
  tipo: string;
  origen_dep_id_3c: number;
  destino_dep_id_3c: number;
  fecha: string;
  turno: string;
  proyeccion: string; // preservado (no se muestra)
  observaciones: string;
  renglones: RenglonForm[];
}

function aFormState(m: MovimientoDetalle): FormState {
  return {
    tipo: m.tipo,
    origen_dep_id_3c: m.origen_dep_id_3c,
    destino_dep_id_3c: m.destino_dep_id_3c,
    fecha: m.fecha,
    turno: m.turno ?? '',
    proyeccion: m.proyeccion ?? '',
    observaciones: m.observaciones ?? '',
    renglones: m.detalle.map((r) => ({
      producto_3c: r.producto_3c,
      cantidad_real: r.cantidad_real,
      cantidad_sugerida: r.cantidad_sugerida ?? '',
      stock_contado: r.stock_contado ?? '',
      unidad: r.unidad,
      observaciones: r.observaciones ?? '',
    })),
  };
}

function aPayload(f: FormState) {
  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    tipo: f.tipo,
    origen_dep_id_3c: f.origen_dep_id_3c,
    destino_dep_id_3c: f.destino_dep_id_3c,
    fecha: f.fecha,
    turno: f.turno || undefined,
    proyeccion: f.proyeccion || undefined,
    observaciones: f.observaciones.trim() || undefined,
    detalle: f.renglones.map((r) => ({
      producto_3c: r.producto_3c,
      cantidad_real: Number(r.cantidad_real),
      cantidad_sugerida: numOrUndef(r.cantidad_sugerida),
      stock_contado: numOrUndef(r.stock_contado),
      unidad: r.unidad,
      observaciones: r.observaciones.trim() || undefined,
    })),
  };
}

export function MovimientoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const movId = Number(id);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [okMsg, setOkMsg] = useState(false);

  const detalle = useQuery({
    queryKey: ['movimiento', movId],
    queryFn: () => apiGet<MovimientoDetalle>(`/api/movimientos/${movId}`),
  });
  const ubicaciones = useQuery({ queryKey: ['ubicaciones'], queryFn: () => apiGet<Ubicacion[]>('/api/ubicaciones') });
  const productos = useQuery({ queryKey: ['productos'], queryFn: () => apiGet<Producto[]>('/api/productos') });
  const tipos = useQuery({ queryKey: ['tipos'], queryFn: () => apiGet<TipoMovimiento[]>('/api/tipos') });
  const historial = useQuery({
    queryKey: ['historial', movId],
    queryFn: () => apiGet<FilaHistorial[]>(`/api/movimientos/${movId}/historial`),
  });

  // Inicializa el form cuando llega el detalle (y al reabrir tras guardar).
  useEffect(() => {
    if (detalle.data) setForm(aFormState(detalle.data));
  }, [detalle.data]);

  const guardar = useMutation({
    mutationFn: (f: FormState) => apiPut<MovimientoDetalle>(`/api/movimientos/${movId}`, aPayload(f)),
    onSuccess: async () => {
      setOkMsg(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['movimiento', movId] }),
        queryClient.invalidateQueries({ queryKey: ['historial', movId] }),
        queryClient.invalidateQueries({ queryKey: ['movimientos'] }),
        queryClient.invalidateQueries({ queryKey: ['stock'] }),
      ]);
    },
  });

  if (detalle.isLoading) return <p className="text-slate-500">Cargando movimiento…</p>;
  if (detalle.isError)
    return <p className="text-rose-700">Error: {(detalle.error as Error).message}</p>;
  if (!detalle.data || !form) return null;

  const mov = detalle.data;
  const anulado = mov.estado === 'ANULADO';
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setOkMsg(false);
  };
  const setRenglon = (i: number, k: keyof RenglonForm, v: string) =>
    setForm((f) =>
      f ? { ...f, renglones: f.renglones.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } : f,
    );
  const addRenglon = () =>
    setForm((f) =>
      f
        ? {
            ...f,
            renglones: [
              ...f.renglones,
              { producto_3c: '', cantidad_real: '', cantidad_sugerida: '', stock_contado: '', unidad: 'KG', observaciones: '' },
            ],
          }
        : f,
    );
  const removeRenglon = (i: number) =>
    setForm((f) => (f ? { ...f, renglones: f.renglones.filter((_, j) => j !== i) } : f));

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/movimientos" className="text-sm text-sky-600 hover:underline">
            ← Movimientos
          </Link>
          <h2 className="mt-1 font-mono text-xl font-semibold">{mov.nro}</h2>
        </div>
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            anulado
              ? 'bg-rose-50 text-rose-700 ring-rose-200'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          }`}
        >
          {mov.estado.charAt(0) + mov.estado.slice(1).toLowerCase()}
        </span>
      </div>

      {anulado && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Este movimiento está anulado: no se puede editar.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form) guardar.mutate(form);
        }}
        className="space-y-6"
      >
        <fieldset disabled={anulado || guardar.isPending} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Tipo">
              <select className={inputCls} value={form.tipo} onChange={(e) => setField('tipo', e.target.value)}>
                {(tipos.data ?? []).map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Origen">
              <select
                className={inputCls}
                value={form.origen_dep_id_3c}
                onChange={(e) => setField('origen_dep_id_3c', Number(e.target.value))}
              >
                {(ubicaciones.data ?? []).map((u) => (
                  <option key={u.id} value={u.dep_id_3c}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Destino">
              <select
                className={inputCls}
                value={form.destino_dep_id_3c}
                onChange={(e) => setField('destino_dep_id_3c', Number(e.target.value))}
              >
                {(ubicaciones.data ?? []).map((u) => (
                  <option key={u.id} value={u.dep_id_3c}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Fecha">
              <input type="date" className={inputCls} value={form.fecha} onChange={(e) => setField('fecha', e.target.value)} />
            </Campo>
            <Campo label="Turno">
              <select className={inputCls} value={form.turno} onChange={(e) => setField('turno', e.target.value)}>
                <option value="">—</option>
                <option value="MAÑANA">Mañana</option>
                <option value="TARDE">Tarde</option>
              </select>
            </Campo>
            <Campo label="Observaciones">
              <input
                type="text"
                className={inputCls}
                value={form.observaciones}
                onChange={(e) => setField('observaciones', e.target.value)}
              />
            </Campo>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold">Renglones</h3>
              <button type="button" onClick={addRenglon} className="text-sm font-medium text-sky-600 hover:underline">
                + Agregar
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 font-medium">Cant. real</th>
                  <th className="px-3 py-2 font-medium">Sugerida</th>
                  <th className="px-3 py-2 font-medium">Unidad</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {form.renglones.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-5 py-2">
                      <select className={inputCls} value={r.producto_3c} onChange={(e) => setRenglon(i, 'producto_3c', e.target.value)}>
                        <option value="">Elegir…</option>
                        {(productos.data ?? []).map((p) => (
                          <option key={p.codigo_3c} value={p.codigo_3c}>
                            {p.nombre} ({p.codigo_3c})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" step="0.001" min="0" className={`${inputCls} w-28`} value={r.cantidad_real} onChange={(e) => setRenglon(i, 'cantidad_real', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" step="0.001" min="0" className={`${inputCls} w-28`} value={r.cantidad_sugerida} onChange={(e) => setRenglon(i, 'cantidad_sugerida', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" className={`${inputCls} w-20`} value={r.unidad} onChange={(e) => setRenglon(i, 'unidad', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {form.renglones.length > 1 && (
                        <button type="button" onClick={() => removeRenglon(i)} className="text-rose-500 hover:text-rose-700">
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {okMsg && <span className="text-sm text-emerald-700">Guardado ✓</span>}
            {guardar.isError && <span className="text-sm text-rose-700">{(guardar.error as Error).message}</span>}
          </div>
        </fieldset>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold">Historial de ediciones</h3>
        {historial.data && historial.data.length === 0 && (
          <p className="text-sm text-slate-500">Sin ediciones registradas.</p>
        )}
        <ul className="space-y-3">
          {(historial.data ?? []).map((h) => (
            <li key={h.id} className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">
                {new Date(h.creado_en).toLocaleString('es-AR')} · usuario #{h.usuario_id} · {h.accion}
              </p>
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {h.cambios.map((c, j) => (
                  <li key={j}>
                    <span className="font-medium">{c.campo}</span>: <code className="text-xs">{JSON.stringify(c.antes)}</code>{' '}
                    → <code className="text-xs">{JSON.stringify(c.despues)}</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50';

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
