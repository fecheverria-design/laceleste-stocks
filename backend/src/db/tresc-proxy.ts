// Cliente del proxy SQL de solo lectura de 3c (el mismo que usa n8n). 3c corre sobre Oracle
// (Application Server 10g + Forms); NO tiene API REST. Este proxy expone las vistas
// LACELESTE.* como consultas SELECT y devuelve el resultado en un CSV temporal.
//
// Contrato:
//   POST {TRESC_PROXY_URL}/query  {"query":"SELECT ... FROM LACELESTE.xxx"}
//     → { "download_url": "/download/<hash>.csv" }
//   GET  {TRESC_PROXY_URL}<download_url>  → el CSV
//
// SOLO LECTURA. Escribir en la base de 3c está prohibido (es contabilidad Oracle). El proxy
// solo ve un puñado de vistas LACELESTE.* + la tabla FAMILIAS.

import { parseDelimited } from './csv.js';

function baseUrl(): string {
  const raw = process.env.TRESC_PROXY_URL?.trim();
  if (!raw) throw new Error('Falta la variable de entorno TRESC_PROXY_URL (ver .env.example)');
  return raw.replace(/\/+$/, '');
}

// Corre una consulta SELECT contra 3c vía el proxy y devuelve el CSV ya parseado
// (filas[0] = encabezados). Lanza si el proxy no responde bien: abortar es lo correcto,
// un resultado vacío por error de red haría estragos aguas abajo.
export async function consultarProxy(query: string): Promise<string[][]> {
  const base = baseUrl();
  const res = await fetch(`${base}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json().catch(() => ({}))) as { download_url?: string; detail?: string };
  if (!res.ok || !json.download_url) {
    throw new Error(`Proxy 3c /query falló (${res.status}): ${json.detail ?? 'sin download_url'}`);
  }

  const csvRes = await fetch(`${base}${json.download_url}`);
  if (!csvRes.ok) {
    throw new Error(`Proxy 3c descarga falló (${csvRes.status}) para ${json.download_url}`);
  }
  const csv = await csvRes.text();
  return parseDelimited(csv);
}
