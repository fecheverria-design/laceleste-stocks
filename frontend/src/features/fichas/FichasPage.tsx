import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { PasosFicha } from '../../shared/components/ficha';
import type { GrupoFichas } from '../../shared/api/types';

// ─────────────────────────────────────────────────────────────────────────────
// "Cómo se calcula": el fundamento de cada número de la app, hoja por hoja.
//
// La idea (pedido de J) es poder auditar la lógica sin abrir el código, y sobre todo tener
// el acta de cómo se calculaba cada cosa el día que dejemos de leer 3c.
//
// El texto NO vive acá: lo arma el backend desde las mismas constantes que usan las queries
// (backend domain/fichas-catalogo.ts). Si mañana cambia una regla, esta pantalla lo refleja
// sola. Escribirlo en el frontend sería garantizar que dentro de seis meses mienta.
// ─────────────────────────────────────────────────────────────────────────────

export default function FichasPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['fichas'],
    queryFn: () => apiGet<GrupoFichas[]>('/api/fichas'),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-xl font-semibold text-slate-900">Cómo se calcula</h1>
      <p className="mt-1 text-sm text-slate-600">
        De dónde sale cada número de la app: qué datos usa, hasta cuándo llegan, qué se incluye, qué se deja
        afuera y por qué. Se genera desde el propio código, así que si cambia una regla, cambia acá.
      </p>

      {isLoading && <p className="mt-6 text-sm text-slate-500">Cargando…</p>}
      {isError && <p className="mt-6 text-sm text-red-600">No se pudo cargar el detalle de los cálculos.</p>}

      <div className="mt-6 space-y-8">
        {data?.map((grupo) => (
          <section key={grupo.hoja}>
            <h2 className="text-base font-semibold text-slate-900">{grupo.hoja}</h2>
            <p className="text-xs text-slate-500">{grupo.resumen}</p>

            <div className="mt-3 space-y-3">
              {grupo.fichas.map((ficha) => (
                <article key={ficha.titulo} className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-800">{ficha.titulo}</h3>
                  <div className="mt-2">
                    <PasosFicha ficha={ficha} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
