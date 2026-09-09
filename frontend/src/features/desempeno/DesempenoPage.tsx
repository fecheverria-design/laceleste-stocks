import { useState } from 'react';
import { AbastecimientoPanel } from './AbastecimientoPanel';
import { ContraTresCPanel } from './ContraTresCPanel';

// Dos preguntas distintas sobre el depósito, y conviene no mezclarlas:
//
//   ABASTECIMIENTO → ¿se despachó lo que había que despachar? Pedido contra despacho, día por
//     día, sobre las áreas que usan la app. Es la comparación limpia: las dos cantidades
//     salen del mismo documento.
//   CONTRA 3C      → ¿lo que pasó por la app coincide con lo que se cargó en 3c? Habla de la
//     cobertura del circuito más que de las personas.
const SOLAPAS = [
  { id: 'abastecimiento', label: 'Abastecimiento' },
  { id: 'contra3c', label: 'Contra 3c' },
] as const;

type Solapa = (typeof SOLAPAS)[number]['id'];

export function DesempenoPage() {
  const [solapa, setSolapa] = useState<Solapa>('abastecimiento');

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {SOLAPAS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSolapa(s.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              solapa === s.id
                ? 'border-sky-500 text-sky-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {solapa === 'abastecimiento' ? <AbastecimientoPanel /> : <ContraTresCPanel />}
    </div>
  );
}

export default DesempenoPage;
