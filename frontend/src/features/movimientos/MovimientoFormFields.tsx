import type { ReactNode } from 'react';
import type { Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';
import type { FormState, RenglonForm } from './movimientoForm';

export const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50';

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

interface Props {
  form: FormState;
  ubicaciones: Ubicacion[];
  productos: Producto[];
  tipos: TipoMovimiento[];
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
  onField,
  onRenglon,
  onAddRenglon,
  onRemoveRenglon,
}: Props) {
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
        <Campo label="Origen">
          <select
            className={inputCls}
            value={form.origen_dep_id_3c}
            onChange={(e) => onField('origen_dep_id_3c', Number(e.target.value))}
          >
            {ubicaciones.map((u) => (
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
            onChange={(e) => onField('destino_dep_id_3c', Number(e.target.value))}
          >
            {ubicaciones.map((u) => (
              <option key={u.id} value={u.dep_id_3c}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Fecha">
          <input type="date" className={inputCls} value={form.fecha} onChange={(e) => onField('fecha', e.target.value)} />
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
            {form.renglones.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-5 py-2">
                  <select className={inputCls} value={r.producto_3c} onChange={(e) => onRenglon(i, 'producto_3c', e.target.value)}>
                    <option value="">Elegir…</option>
                    {productos.map((p) => (
                      <option key={p.codigo_3c} value={p.codigo_3c}>
                        {p.nombre} ({p.codigo_3c})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.001" min="0" className={`${inputCls} w-28`} value={r.cantidad_real} onChange={(e) => onRenglon(i, 'cantidad_real', e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" step="0.001" min="0" className={`${inputCls} w-28`} value={r.cantidad_sugerida} onChange={(e) => onRenglon(i, 'cantidad_sugerida', e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input type="text" className={`${inputCls} w-20`} value={r.unidad} onChange={(e) => onRenglon(i, 'unidad', e.target.value)} />
                </td>
                <td className="px-3 py-2 text-right">
                  {form.renglones.length > 1 && (
                    <button type="button" onClick={() => onRemoveRenglon(i)} className="text-rose-500 hover:text-rose-700">
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
