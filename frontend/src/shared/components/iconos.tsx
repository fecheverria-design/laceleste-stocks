// Iconos inline (SVG de 16px, heredan el color del texto con currentColor). Van acá y no
// como librería para no sumar una dependencia por cuatro dibujos: la app usa cuatro.

type Props = { className?: string };

export function IconoLupa({ className = 'h-4 w-4' }: Props) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2 17 17" strokeLinecap="round" />
    </svg>
  );
}

export function IconoFiltro({ className = 'h-4 w-4' }: Props) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3 5h14M6 10h8M8.5 15h3" strokeLinecap="round" />
    </svg>
  );
}

export function IconoDescarga({ className = 'h-4 w-4' }: Props) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 14v1.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V14" strokeLinecap="round" />
    </svg>
  );
}

export function IconoCruz({ className = 'h-3 w-3' }: Props) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
    </svg>
  );
}

export function IconoChevron({ className = 'h-4 w-4' }: Props) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
