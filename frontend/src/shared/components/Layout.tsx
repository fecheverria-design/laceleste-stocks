import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/stock', label: 'Stock' },
  { to: '/health', label: 'Estado' },
];

export function Layout() {
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
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
