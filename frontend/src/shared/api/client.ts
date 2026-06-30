import { clearSession, getToken, notifyUnauthorized } from '../auth/session';

// Cliente HTTP. Por defecto usa rutas relativas (/api…) que el proxy de Vite
// redirige al backend en dev. VITE_API_URL permite apuntar a otro host.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (init.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // Token vencido/ inválido: cerrar sesión y avisar para redirigir al login.
  if (res.status === 401) {
    clearSession();
    notifyUnauthorized();
    throw new ApiError(401, 'Sesión expirada, ingresá de nuevo.');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status} en ${path}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // respuesta sin JSON; queda el mensaje genérico
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' });

// Descarga autenticada (CSV/binario): trae el blob con el Bearer y dispara la bajada.
export async function descargarArchivo(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearSession();
    notifyUnauthorized();
    throw new ApiError(401, 'Sesión expirada, ingresá de nuevo.');
  }
  if (!res.ok) throw new ApiError(res.status, `No se pudo descargar (HTTP ${res.status}).`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });

// DELETE: el backend responde 204 sin cuerpo, así que no parseamos JSON.
export async function apiDelete(path: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearSession();
    notifyUnauthorized();
    throw new ApiError(401, 'Sesión expirada, ingresá de nuevo.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status} en ${path}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError(res.status, message);
  }
}
