import { ping } from '../repositories/health.repository.js';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

// Lógica de negocio: el estado depende de si la DB responde.
export async function getHealth(): Promise<HealthStatus> {
  let dbState: 'up' | 'down' = 'up';
  try {
    await ping();
  } catch {
    dbState = 'down';
  }

  return {
    status: dbState === 'up' ? 'ok' : 'degraded',
    db: dbState,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
