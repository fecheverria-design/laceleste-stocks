import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

// Buscador de producto por Código y por Nombre a la vez: se puede tipear/elegir en
// cualquiera de los dos y el otro se autocompleta. Al fijar un producto, avisa también su
// unidad_base para que el renglón la tome solo. `producto_3c` (el código) es la fuente de
// verdad del form; el texto de cada input es estado local para poder tipear libre.
function RenglonProducto({
  codigo,
  porCodigo,
  porNombre,
  datalistCodigos,
  datalistNombres,
  error,
  onPick,
}: {
  codigo: string;
  porCodigo: Map<string, Producto>;
  porNombre: Map<string, Producto>;
  datalistCodigos: string;
  datalistNombres: string;
  error?: string;
  onPick: (codigo: string, unidad: string | null) => void;
}) {
  const [codigoText, setCodigoText] = useState(codigo);
  const [nombreText, setNombreText] = useState(porCodigo.get(codigo)?.nombre ?? '');

  // Resync si el código cambia desde afuera (prefill al editar, agregar/quitar renglones).
  useEffect(() => {
    setCodigoText(codigo);
    setNombreText(porCodigo.get(codigo)?.nombre ?? '');
  }, [codigo, porCodigo]);

  const elegirCodigo = (v: string) => {
    setCodigoText(v);
    const p = porCodigo.get(v.trim());
    if (p) {
      setNombreText(p.nombre);
      onPick(p.codigo_3c, p.unidad_base);
    } else {
      // Código parcial/desconocido: se refleja en el form, la unidad no se toca.
      onPick(v.trim(), null);
    }
  };

  const elegirNombre = (v: string) => {
    setNombreText(v);
    const p = porNombre.get(v.trim().toLowerCase());
    if (p) {
      setCodigoText(p.codigo_3c);
      onPick(p.codigo_3c, p.unidad_base);
    }
    // Sin match exacto no se cambia el producto: es un autocomplete, se elige de la lista.
  };

  // inputCls trae w-full: hay que sacarlo o pisa los anchos del flex (el código se estira).
  const sinAncho = inputCls.replace('w-full', '');
  const prod = porCodigo.get(codigo.trim());
  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          list={datalistCodigos}
          placeholder="Código"
          aria-label="Código de producto"
          className={conError(`${sinAncho} w-24 shrink-0`, error)}
          value={codigoText}
          onChange={(e) => elegirCodigo(e.target.value)}
        />
        <input
          type="text"
          list={datalistNombres}
          placeholder="Nombre"
          aria-label="Nombre de producto"
          className={conError(`${sinAncho} min-w-0 flex-1`, error)}
          value={nombreText}
          onChange={(e) => elegirNombre(e.target.value)}
        />
      </div>
      {prod && <InfoProducto prod={prod} />}
    </div>
  );
}

// Línea de referencia read-only bajo el renglón: familia, subfamilia, presentación y bulto.
// Solo muestra los campos que el producto tenga cargados (todos son nullable en el maestro).
function InfoProducto({ prod }: { prod: Producto }) {
  // unidades_por_bulto = 1 significa "se cuenta suelto": no es un bulto real, no se muestra.
  const bulto =
    prod.unidades_por_bulto && Number(prod.unidades_por_bulto) > 1
      ? `Bulto: ${Number(prod.unidades_por_bulto)} ${prod.unidad_base}`
      : null;
  const partes = [
    prod.familia ? `Familia: ${prod.familia}` : null,
    prod.subfamilia ? `Subfam: ${prod.subfamilia}` : null,
    prod.presentacion_compra ? `Present.: ${prod.presentacion_compra}` : null,
    bulto,
  ].filter(Boolean);
  if (partes.length === 0) return null;
  return <p className="mt-1 text-xs text-slate-500">{partes.join(' · ')}</p>;
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

  // Índices para resolver producto por código o por nombre (autocompletar el otro campo
  // + traer la unidad). Se calculan una vez por lista de productos, no por renglón.
  const porCodigo = useMemo(() => new Map(productos.map((p) => [p.codigo_3c, p])), [productos]);
  const porNombre = useMemo(
    () => new Map(productos.map((p) => [p.nombre.trim().toLowerCase(), p])),
    [productos],
  );

  // Al fijar un producto en un renglón: setea el código y, si se resolvió, la unidad.
  // Ambos onRenglon usan setState funcional en el padre → se componen sin pisarse.
  const pickProducto = (i: number, cod: string, unidad: string | null) => {
    onRenglon(i, 'producto_3c', cod);
    if (unidad !== null) onRenglon(i, 'unidad', unidad);
  };

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
        {/* Opciones de autocompletado compartidas por todos los renglones (una sola vez). */}
        <datalist id="dl-prod-codigos">
          {productos.map((p) => (
            <option key={p.codigo_3c} value={p.codigo_3c}>
              {p.nombre}
            </option>
          ))}
        </datalist>
        <datalist id="dl-prod-nombres">
          {productos.map((p) => (
            <option key={p.codigo_3c} value={p.nombre}>
              {p.codigo_3c}
            </option>
          ))}
        </datalist>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2 font-medium">Producto (código / nombre)</th>
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
                    <RenglonProducto
                      codigo={r.producto_3c}
                      porCodigo={porCodigo}
                      porNombre={porNombre}
                      datalistCodigos="dl-prod-codigos"
                      datalistNombres="dl-prod-nombres"
                      error={re.producto_3c}
                      onPick={(cod, unidad) => pickProducto(i, cod, unidad)}
                    />
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
