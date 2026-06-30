import type { ReactNode } from 'react';
import type { Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';
import type { FormErrores, FormState, RenglonErrores, RenglonForm } from './movimientoForm';

export const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50';

// Borde rojo cuando hay error en el campo.
const conError = (base: string, error?: string): string =>
  error ? `${base} border-rose-400 focus:border-rose-500 focus:ring-rose-500` : base;

function ErrorMsg({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-rose-600">{msg}</p> : null;
}

function Campo({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
      <ErrorMsg msg={error} />
    </label>
  );
}

interface Props {
  form: FormState;
  ubicaciones: Ubicacion[];
  productos: Producto[];
  tipos: TipoMovimiento[];
  errores?: FormErrores; // si viene, se muestran los mensajes (tras intentar enviar)
  onField: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  onRenglon: (i: number, k: keyof RenglonForm, v: string) => void;
  onAddRenglon: () => void;
  onRemoveRenglon: (i: number) => void;
}

export function MovimientoFormFields({
  form,
  ubicaciones,
  productos,
  tipos,
  errores,
  onField,
  onRenglon,
  onAddRenglon,
  onRemoveRenglon,
}: Props) {
  const errs = errores;
  const er = (i: number): RenglonErrores => errs?.renglones[i] ?? {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Tipo">
          <select className={inputCls} value={form.tipo} onChange={(e) => onField('tipo', e.target.value)}>
            {tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Origen" error={errs?.origen_dep_id_3c}>
          <select
            className={conError(inputCls, errs?.origen_dep_id_3c)}
            value={form.origen_dep_id_3c}
            onChange={(e) => onField('origen_dep_id_3c', Number(e.target.value))}
          >
            {ubicaciones.map((u) => (
              <option key={u.id} value={u.dep_id_3c}>
                {u.dep_id_3c} — {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Destino" error={errs?.destino_dep_id_3c}>
          <select
            className={conError(inputCls, errs?.destino_dep_id_3c)}
            value={form.destino_dep_id_3c}
            onChange={(e) => onField('destino_dep_id_3c', Number(e.target.value))}
          >
            {ubicaciones.map((u) => (
              <option key={u.id} value={u.dep_id_3c}>
                {u.dep_id_3c} — {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Fecha" error={errs?.fecha}>
          <input
            type="date"
            className={conError(inputCls, errs?.fecha)}
            value={form.fecha}
            onChange={(e) => onField('fecha', e.target.value)}
          />
        </Campo>
        <Campo label="Turno">
          <select className={inputCls} value={form.turno} onChange={(e) => onField('turno', e.target.value)}>
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
            onChange={(e) => onField('observaciones', e.target.value)}
          />
        </Campo>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold">Renglones</h3>
          <button type="button" onClick={onAddRenglon} className="text-sm font-medium text-sky-600 hover:underline">
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
            {form.renglones.map((r, i) => {
              const re = er(i);
              return (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-2">
                    <select
                      className={conError(inputCls, re.producto_3c)}
                      value={r.producto_3c}
                      onChange={(e) => onRenglon(i, 'producto_3c', e.target.value)}
                    >
                      <option value="">Elegir…</option>
                      {productos.map((p) => (
                        <option key={p.codigo_3c} value={p.codigo_3c}>
                          {p.codigo_3c} — {p.nombre}
                        </option>
                      ))}
                    </select>
                    <ErrorMsg msg={re.producto_3c} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.001" min="0" className={conError(`${inputCls} w-28`, re.cantidad_real)} value={r.cantidad_real} onChange={(e) => onRenglon(i, 'cantidad_real', e.target.value)} />
                    <ErrorMsg msg={re.cantidad_real} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.001" min="0" className={conError(`${inputCls} w-28`, re.cantidad_sugerida)} value={r.cantidad_sugerida} onChange={(e) => onRenglon(i, 'cantidad_sugerida', e.target.value)} />
                    <ErrorMsg msg={re.cantidad_sugerida} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" className={conError(`${inputCls} w-20`, re.unidad)} value={r.unidad} onChange={(e) => onRenglon(i, 'unidad', e.target.value)} />
                    <ErrorMsg msg={re.unidad} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {form.renglones.length > 1 && (
                      <button type="button" onClick={() => onRemoveRenglon(i)} className="text-rose-500 hover:text-rose-700">
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {errs?.detalle && <p className="px-5 py-3 text-xs text-rose-600">{errs.detalle}</p>}
      </div>
    </div>
  );
}
