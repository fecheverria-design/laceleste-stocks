import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Guarda de rutas: si no hay sesión, manda al login. Envuelve las rutas privadas.
export function RequireAuth() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
