import type { Ficha } from '../api/types';

// ─────────────────────────────────────────────────────────────────────────────
// Cómo se dibuja una ficha ("de dónde sale este número"), en un solo lugar.
//
// El texto NO se escribe acá: lo manda el backend armado con las mismas constantes que usan
// las queries (backend domain/procedencia.ts). Acá va solo la presentación, compartida entre
// la hoja "Cómo se calcula" (todas las fichas juntas) y la ficha puntual que cuelga de una
// fila. El informe tiene su propia versión porque vive en otro sistema de estilos (CSS
// propio, no Tailwind).
// ─────────────────────────────────────────────────────────────────────────────

/** Los pasos de una ficha, sin título ni caja: para meterlos donde haga falta. */
export function PasosFicha({ ficha }: { ficha: Ficha }) {
  return (
    <dl className="space-y-3">
      {ficha.pasos.map((paso) => (
        <div key={paso.titulo}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{paso.titulo}</dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-slate-700">{paso.detalle}</dd>
          {paso.items && paso.items.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
              {paso.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </dl>
  );
}

/**
 * La ficha plegada, cerrada por defecto: es material de auditoría, no de lectura diaria.
 * `resumen` es el texto del renglón que se toca para abrirla.
 */
export function FichaPlegable({
  ficha,
  resumen = '¿De dónde sale este número?',
  cargando = false,
}: {
  ficha: Ficha | undefined;
  resumen?: string;
  cargando?: boolean;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/70">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600 hover:text-sky-700">
        {resumen}
      </summary>
      <div className="border-t border-slate-200 bg-white px-3 py-3">
        {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
        {!cargando && !ficha && <p className="text-sm text-slate-500">No se pudo cargar el fundamento.</p>}
        {ficha && (
          <>
            <p className="mb-2 text-sm font-semibold text-slate-800">{ficha.titulo}</p>
            <PasosFicha ficha={ficha} />
          </>
        )}
      </div>
    </details>
  );
}
