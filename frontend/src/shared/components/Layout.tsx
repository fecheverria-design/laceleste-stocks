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
  { to: '/proveedores', label: 'Proveedores' },
  { to: '/health', label: 'Estado' },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-sky-600">La Celeste</p>
            <h1 className="text-lg font-semibold leading-tight">Movimientos Internos</h1>
          </div>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-sky-50 text-sky-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          {user && (
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-medium leading-tight text-slate-900">{user.nombre}</p>
                <p className="text-xs text-slate-500">{user.rol}</p>
              </div>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
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
