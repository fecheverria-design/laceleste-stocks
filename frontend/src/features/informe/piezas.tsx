import { claseVar, pctTxt } from './formato';

// Piezas visuales chicas del informe: las etiquetas y badges del HTML original.

/** Variación formateada con su color. */
export function Var({ v, dec = 1 }: { v: number | null | undefined; dec?: number }) {
  return <span className={claseVar(v)}>{pctTxt(v, dec)}</span>;
}

const FAMILIAS: Record<string, [string, string]> = {
  'MATERIAS PRIMAS': ['ft-mp', 'MP'],
  PACKAGING: ['ft-pack', 'PACK'],
  DESCARTABLES: ['ft-desc', 'DESC'],
  LIMPIEZA: ['ft-desc', 'LIMP'],
  MERCHANDISING: ['ft-pack', 'MERCH'],
};

/** Etiqueta corta de familia, con el color que le corresponde. */
export function FamTag({ familia }: { familia: string | null | undefined }) {
  if (!familia) return null;
  const [clase, texto] = FAMILIAS[familia.toUpperCase()] ?? ['ft-mp', familia];
  return <span className={`fam-tag ${clase}`}>{texto}</span>;
}

/** Cantidad de cotizaciones vigentes: verde con 3+, ámbar con 2, naranja con 1. */
export function ProvBadge({ n }: { n: number }) {
  const clase = n >= 3 ? 'pb-3' : n === 2 ? 'pb-2' : 'pb-1';
  return <span className={`prov-badge ${clase}`}>{n}</span>;
}
