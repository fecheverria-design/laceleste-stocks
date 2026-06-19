import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './shared/components/Layout';
import { MovimientosPage } from './features/movimientos/MovimientosPage';
import { StockPage } from './features/stock/StockPage';
import { HealthPage } from './features/health/HealthPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/movimientos" replace />} />
        <Route path="/movimientos" element={<MovimientosPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="*" element={<Navigate to="/movimientos" replace />} />
      </Route>
    </Routes>
  );
}
