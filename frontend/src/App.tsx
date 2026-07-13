import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './shared/components/Layout';
import { RequireAuth } from './shared/auth/RequireAuth';
import { LoginPage } from './features/auth/LoginPage';
import { MovimientosPage } from './features/movimientos/MovimientosPage';
import { NuevoMovimientoPage } from './features/movimientos/NuevoMovimientoPage';
import { MovimientoDetallePage } from './features/movimientos/MovimientoDetallePage';
import { StockPage } from './features/stock/StockPage';
import { ArticulosPage } from './features/articulos/ArticulosPage';
import { InventariosPage } from './features/inventarios/InventariosPage';
import { InventarioDetallePage } from './features/inventarios/InventarioDetallePage';
import { HealthPage } from './features/health/HealthPage';

// Lazy: arrastran Recharts, que solo se baja al entrar a estas páginas.
const PreciosPage = lazy(() => import('./features/precios/PreciosPage').then((m) => ({ default: m.PreciosPage })));
const PanelPage = lazy(() => import('./features/panel/PanelPage').then((m) => ({ default: m.PanelPage })));
const ConsumosPage = lazy(() => import('./features/consumos/ConsumosPage').then((m) => ({ default: m.ConsumosPage })));
const ProveedoresPage = lazy(() =>
  import('./features/proveedores/ProveedoresPage').then((m) => ({ default: m.ProveedoresPage })),
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/panel" replace />} />
          <Route
            path="/panel"
            element={
              <Suspense fallback={<p className="text-slate-500">Cargando panel…</p>}>
                <PanelPage />
              </Suspense>
            }
          />
          <Route path="/movimientos" element={<MovimientosPage />} />
          <Route path="/movimientos/nuevo" element={<NuevoMovimientoPage />} />
          <Route path="/movimientos/:id" element={<MovimientoDetallePage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/articulos" element={<ArticulosPage />} />
          <Route path="/inventarios" element={<InventariosPage />} />
          <Route path="/inventarios/:id" element={<InventarioDetallePage />} />
          <Route
            path="/consumos"
            element={
              <Suspense fallback={<p className="text-slate-500">Cargando consumos…</p>}>
                <ConsumosPage />
              </Suspense>
            }
          />
          <Route
            path="/precios"
            element={
              <Suspense fallback={<p className="text-slate-500">Cargando precios…</p>}>
                <PreciosPage />
              </Suspense>
            }
          />
          <Route
            path="/proveedores"
            element={
              <Suspense fallback={<p className="text-slate-500">Cargando proveedores…</p>}>
                <ProveedoresPage />
              </Suspense>
            }
          />
          <Route path="/health" element={<HealthPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/panel" replace />} />
    </Routes>
  );
}
