import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const tabs = [
  { to: '/panel', label: 'Panel' },
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/stock', label: 'Stock' },
  { to: '/articulos', label: 'Artículos' },
  { to: '/inventarios', label: 'Inventarios' },
  { to: '/consumos', label: 'Consumos' },
  { to: '/precios', label: 'Precios' },
  { to: '/control-precios', label: 'Control precios' },
  { to: '/proveedores', label: 'Proveedores' },
  { to: '/informe', label: 'Informe' },
  { to: '/health', label: 'Estado' },
];

// Iniciales de la persona logueada para el avatar ("Fausto Echeverria" → "FE").
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Filo celeste arriba de todo: la firma de color de la app, sin robarle
          protagonismo a los datos. */}
      <div className="h-1 bg-gradient-to-r from-sky-400 via-sky-500 to-cyan-400" />

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-sm font-bold text-white shadow-sm">
              LC
            </div>
            <div className="leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-sky-600">La Celeste</p>
              <h1 className="text-sm font-semibold text-slate-900">Movimientos Internos</h1>
            </div>
          </div>

          <nav className="flex flex-wrap gap-0.5">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>

          {user && (
            <div className="ml-auto flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-slate-200"
                title={user.nombre}
              >
                {iniciales(user.nombre)}
              </div>
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-medium text-slate-900">{user.nombre}</p>
                <p className="text-xs text-slate-500">{user.rol}</p>
              </div>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
              >
                Salir
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
