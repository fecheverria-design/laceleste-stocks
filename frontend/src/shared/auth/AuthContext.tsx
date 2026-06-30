import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '../api/types';
import { clearSession, getStoredUser, saveSession, setUnauthorizedHandler } from './session';

interface AuthContextValue {
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());

  // Un 401 desde el cliente HTTP limpia la sesión y vacía el estado → la guarda
  // de rutas redirige al login sin recargar.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login: (token, u) => {
        saveSession(token, u);
        setUser(u);
      },
      logout: () => {
        clearSession();
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
