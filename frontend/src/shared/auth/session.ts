import type { AuthUser } from '../api/types';

// Persistencia de la sesión en localStorage (CLAUDE.md: JWT Bearer + localStorage).
const TOKEN_KEY = 'laceleste.token';
const USER_KEY = 'laceleste.user';

// Handler que el AuthProvider registra para reaccionar a un 401 (token expirado/inválido):
// limpia el estado de React y manda al login sin recargar la página.
let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}
export function notifyUnauthorized(): void {
  onUnauthorized();
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
