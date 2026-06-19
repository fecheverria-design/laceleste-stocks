// Tipos de respuesta de la API. Espejo de los DTOs del backend (regla #8: el ideal
// es compartir el schema Zod; mientras no haya paquete compartido, se replican acá).

export type EstadoMovimiento = 'BORRADOR' | 'CONFIRMADO' | 'ANULADO';

export interface MovimientoResumen {
  id: number;
  nro: string;
  tipo: string; // codigo del catálogo: RECEPCION | RINT | AJUSTE | …
  estado: EstadoMovimiento;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  origen_id: number;
  origen_nombre: string;
  destino_id: number;
  destino_nombre: string;
  usuario_id: number;
  creado_en: string | null;
  confirmado_en: string | null;
  anulado_en: string | null;
}

export interface ListaMovimientos {
  items: MovimientoResumen[];
  page: number;
  limit: number;
  total: number;
}

export interface FilaStock {
  producto_3c: string;
  producto_nombre: string;
  ubicacion_id: number;
  ubicacion_nombre: string;
  cantidad: number;
  actualizado_en: string | null;
}
