import { Fragment, useState } from 'react';
import type { CambioAuditoria, FilaHistorial, Producto, TipoMovimiento, Ubicacion } from '../../shared/api/types';

const CAMPO_LABEL: Record<string, string> = {
  tipo: 'Tipo',
  origen_dep_id_3c: 'Origen',
  destino_dep_id_3c: 'Destino',
  fecha: 'Fecha',
  turno: 'Turno',
  proyeccion: 'Proyección',
  observaciones: 'Observaciones',
  detalle: 'Renglones',
};

interface RenglonCambio {
  producto_3c: string;
  cantidad_real: number | string;
  unidad: string;
}

interface Props {
  nro: string; // nro del movimiento, para identificar cada edición
  historial: FilaHistorial[];
  ubicaciones: Ubicacion[];
  productos: Producto[];
  tipos: TipoMovimiento[];
}

export function HistorialEdiciones({ nro, historial, ubicaciones, productos, tipos }: Props) {
  const [abierto, setAbierto] = useState<number | null>(historial[0]?.id ?? null);

  const depNombre = new Map(ubicaciones.map((u) => [u.dep_id_3c, `${u.dep_id_3c} — ${u.nombre}`]));
  const tipoNombre = new Map(tipos.map((t) => [t.codigo, t.nombre]));
  const prodNombre = new Map(productos.map((p) => [p.codigo_3c, p.nombre]));

  // Formatea un valor escalar según el campo (nombres en vez de códigos pelados).
  const escalar = (campo: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (campo === 'origen_dep_id_3c' || campo === 'destino_dep_id_3c') return depNombre.get(Number(v)) ?? String(v);
    if (campo === 'tipo') return tipoNombre.get(String(v)) ?? String(v);
    return String(v);
  };

  const renglon = (r: RenglonCambio): string => {
    const nombre = prodNombre.get(r.producto_3c);
    return `${r.producto_3c}${nombre ? ` ${nombre}` : ''} · ${r.cantidad_real} ${r.unidad}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold">Historial de ediciones</h3>
      </div>

      {historial.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">Sin ediciones registradas.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {historial.map((h) => {
            const open = abierto === h.id;
            return (
              <Fragment key={h.id}>
                <li>
                  <button
                    type="button"
                    onClick={() => setAbierto(open ? null : h.id)}
                    className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">{open ? '▾' : '▸'}</span>
                      <span className="font-medium text-slate-700">
                        {nro} · edición {h.secuencia}
                      </span>
                      <span className="text-slate-500">
                        {new Date(h.creado_en).toLocaleString('es-AR')} · usuario #{h.usuario_id}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">
                      {h.cambios.length} {h.cambios.length === 1 ? 'cambio' : 'cambios'}
                    </span>
                  </button>

                  {open && (
                    <div className="space-y-2 px-5 pb-4 pl-12">
                      {h.cambios.map((c: CambioAuditoria, j) => (
                        <div key={j} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {CAMPO_LABEL[c.campo] ?? c.campo}
                          </p>
                          {c.campo === 'detalle' ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div>
                                <p className="text-xs text-slate-400">Antes</p>
                                <ul className="text-slate-600">
                                  {((c.antes as RenglonCambio[] | null) ?? []).map((r, k) => (
                                    <li key={k}>{renglon(r)}</li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Después</p>
                                <ul className="text-slate-700">
                                  {((c.despues as RenglonCambio[] | null) ?? []).map((r, k) => (
                                    <li key={k}>{renglon(r)}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ) : (
                            <p className="text-slate-700">
                              <span className="text-slate-500 line-through">{escalar(c.campo, c.antes)}</span>
                              <span className="mx-2 text-slate-400">→</span>
                              <span className="font-medium">{escalar(c.campo, c.despues)}</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
