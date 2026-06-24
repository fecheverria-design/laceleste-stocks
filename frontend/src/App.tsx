import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './shared/components/Layout';
import { RequireAuth } from './shared/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { MovimientosPage } from './features/movimientos/MovimientosPage';
import { NuevoMovimientoPage } from './features/movimientos/NuevoMovimientoPage';
import { MovimientoDetallePage } from './features/movimientos/MovimientoDetallePage';
import { StockPage } from './features/stock/StockPage';
import { HealthPage } from './features/health/HealthPage';

// Lazy: arrastra Recharts, que solo se baja al entrar a Precios.
const PreciosPage = lazy(() => import('./features/precios/PreciosPage').then((m) => ({ default: m.PreciosPage })));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/movimientos" replace />} />
          <Route path="/movimientos" element={<MovimientosPage />} />
          <Route path="/movimientos/nuevo" element={<NuevoMovimientoPage />} />
          <Route path="/movimientos/:id" element={<MovimientoDetallePage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route
            path="/precios"
            element={
              <Suspense fallback={<p className="text-slate-500">Cargando precios…</p>}>
                <PreciosPage />
              </Suspense>
            }
          />
          <Route path="/health" element={<HealthPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/movimientos" replace />} />
    </Routes>
  );
}
