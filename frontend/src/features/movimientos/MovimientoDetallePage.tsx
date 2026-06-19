import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../shared/api/client';
import type { FilaHistorial, MovimientoDetalle, Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';
import { aFormState, aPayload, renglonVacio, type FormState, type RenglonForm } from './movimientoForm';
import { MovimientoFormFields } from './MovimientoFormFields';

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
  if (detalle.isError) return <p className="text-rose-700">Error: {(detalle.error as Error).message}</p>;
  if (!detalle.data || !form) return null;

  const mov = detalle.data;
  const anulado = mov.estado === 'ANULADO';
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setOkMsg(false);
  };
  const setRenglon = (i: number, k: keyof RenglonForm, v: string) =>
    setForm((f) => (f ? { ...f, renglones: f.renglones.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } : f));
  const addRenglon = () => setForm((f) => (f ? { ...f, renglones: [...f.renglones, renglonVacio()] } : f));
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
            anulado ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
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
          <MovimientoFormFields
            form={form}
            ubicaciones={ubicaciones.data ?? []}
            productos={productos.data ?? []}
            tipos={tipos.data ?? []}
            onField={setField}
            onRenglon={setRenglon}
            onAddRenglon={addRenglon}
            onRemoveRenglon={removeRenglon}
          />
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
