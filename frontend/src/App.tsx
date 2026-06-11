import { Navigate, Route, Routes } from 'react-router-dom';
import { HealthPage } from './features/health/HealthPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
