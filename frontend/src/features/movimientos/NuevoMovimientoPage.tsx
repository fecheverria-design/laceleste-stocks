import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../shared/api/client';
import type { MovimientoDetalle, Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';
import { aPayload, formVacio, renglonVacio, tieneErrores, validar, type FormState, type RenglonForm } from './movimientoForm';
import { MovimientoFormFields } from './MovimientoFormFields';

export function NuevoMovimientoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [intentado, setIntentado] = useState(false);

  const ubicaciones = useQuery({ queryKey: ['ubicaciones'], queryFn: () => apiGet<Ubicacion[]>('/api/ubicaciones') });
  const productos = useQuery({ queryKey: ['productos'], queryFn: () => apiGet<Producto[]>('/api/productos') });
  const tipos = useQuery({ queryKey: ['tipos'], queryFn: () => apiGet<TipoMovimiento[]>('/api/tipos') });

  // Inicializa el form vacío cuando llegan los catálogos (para defaults de origen/destino/tipo).
  useEffect(() => {
    if (!form && ubicaciones.data && tipos.data) {
      // Default RINT (lo más común); si no está, el primero del catálogo.
      const tipoDefault = tipos.data.find((t) => t.codigo === 'RINT')?.codigo ?? tipos.data[0]?.codigo ?? 'RINT';
      setForm(formVacio(ubicaciones.data, tipoDefault));
    }
  }, [form, ubicaciones.data, tipos.data]);

  const crear = useMutation({
    mutationFn: (f: FormState) => apiPost<MovimientoDetalle>('/api/movimientos', aPayload(f)),
    onSuccess: async (mov) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['movimientos'] }),
        queryClient.invalidateQueries({ queryKey: ['stock'] }),
      ]);
      navigate(`/movimientos/${mov.id}`);
    },
  });

  if (!form) return <p className="text-slate-500">Cargando…</p>;

  const errores = validar(form);
  const hayErrores = tieneErrores(errores);
  const enviar = () => {
    setIntentado(true);
    if (!hayErrores) crear.mutate(form);
  };

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setRenglon = (i: number, k: keyof RenglonForm, v: string) =>
    setForm((f) => (f ? { ...f, renglones: f.renglones.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } : f));
  const addRenglon = () => setForm((f) => (f ? { ...f, renglones: [...f.renglones, renglonVacio()] } : f));
  const removeRenglon = (i: number) =>
    setForm((f) => (f ? { ...f, renglones: f.renglones.filter((_, j) => j !== i) } : f));

  return (
    <section className="space-y-6">
      <div>
        <Link to="/movimientos" className="text-sm text-sky-600 hover:underline">
          ← Movimientos
        </Link>
        <h2 className="mt-1 text-xl font-semibold">Nuevo movimiento</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
        className="space-y-6"
      >
        <fieldset disabled={crear.isPending} className="space-y-6">
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
              {crear.isPending ? 'Creando…' : 'Crear movimiento'}
            </button>
            {intentado && hayErrores && (
              <span className="text-sm text-rose-700">Revisá los campos marcados.</span>
            )}
            {crear.isError && <span className="text-sm text-rose-700">{(crear.error as Error).message}</span>}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
