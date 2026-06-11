// Cliente HTTP mínimo. Por defecto usa rutas relativas (/api...) que el proxy de
// Vite redirige al backend en dev. VITE_API_URL permite apuntar a otro host.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} en ${path}`);
  }
  return (await res.json()) as T;
}
