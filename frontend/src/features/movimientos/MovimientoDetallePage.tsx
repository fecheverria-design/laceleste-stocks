import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../shared/api/client';
import type { FilaHistorial, MovimientoDetalle, Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';
import { aFormState, aPayload, renglonVacio, tieneErrores, validar, type FormState, type RenglonForm } from './movimientoForm';
import { MovimientoFormFields } from './MovimientoFormFields';
import { HistorialEdiciones } from './HistorialEdiciones';
import { useAuth } from '../../shared/auth/AuthContext';

export function MovimientoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const movId = Number(id);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<FormState | null>(null);
  const [okMsg, setOkMsg] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [confirmarAnular, setConfirmarAnular] = useState(false);

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

  const anular = useMutation({
    mutationFn: () => apiPut<MovimientoDetalle>(`/api/movimientos/${movId}/anular`),
    onSuccess: async () => {
      setConfirmarAnular(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['movimiento', movId] }),
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
  const puedeAnular = user?.rol === 'ADMIN' && mov.estado === 'CONFIRMADO';
  const errores = validar(form);
  const hayErrores = tieneErrores(errores);
  const guardarSiValido = () => {
    setIntentado(true);
    if (!hayErrores) guardar.mutate(form);
  };
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
        <div className="flex items-center gap-3">
          {puedeAnular &&
            (confirmarAnular ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-slate-600">¿Anular?</span>
                <button
                  type="button"
                  onClick={() => anular.mutate()}
                  disabled={anular.isPending}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {anular.isPending ? 'Anulando…' : 'Sí, anular'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmarAnular(false)}
                  disabled={anular.isPending}
                  className="text-slate-500 hover:underline"
                >
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmarAnular(true)}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                Anular
              </button>
            ))}
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
              anulado ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            }`}
          >
            {mov.estado.charAt(0) + mov.estado.slice(1).toLowerCase()}
          </span>
        </div>
      </div>

      {mov.tipo === 'RECEPCION' && (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          Proveedor:{' '}
          {mov.proveedor_nombre ? (
            <span className="font-medium text-slate-800">
              {mov.proveedor_nombre}
              {mov.proveedor_numero_3c != null && (
                <span className="ml-1 font-normal text-slate-400">(#{mov.proveedor_numero_3c})</span>
              )}
            </span>
          ) : (
            <span className="italic text-slate-400">sin asociar</span>
          )}
        </p>
      )}

      {anulado && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Este movimiento está anulado: no se puede editar.
        </p>
      )}

      {anular.isError && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No se pudo anular: {(anular.error as Error).message}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          guardarSiValido();
        }}
        className="space-y-6"
      >
        <fieldset disabled={anulado || guardar.isPending} className="space-y-6">
          <MovimientoFormFields
            form={form}
            ubicaciones={ubicaciones.data ?? []}
            productos={productos.data ?? []}
            tipos={tipos.data ?? []}
            errores={intentado ? errores : undefined}
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
            {intentado && hayErrores && (
              <span className="text-sm text-rose-700">Revisá los campos marcados.</span>
            )}
            {okMsg && <span className="text-sm text-emerald-700">Guardado ✓</span>}
            {guardar.isError && <span className="text-sm text-rose-700">{(guardar.error as Error).message}</span>}
          </div>
        </fieldset>
      </form>

      <HistorialEdiciones
        nro={mov.nro}
        historial={historial.data ?? []}
        ubicaciones={ubicaciones.data ?? []}
        productos={productos.data ?? []}
        tipos={tipos.data ?? []}
      />
    </section>
  );
}
