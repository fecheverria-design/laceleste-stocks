// Tipos de respuesta de la API. Espejo de los DTOs del backend (regla #8: el ideal
// es compartir el schema Zod; mientras no haya paquete compartido, se replican acá).

export type Rol = 'ADMIN' | 'DEPOSITO' | 'SISTEMA';

export interface AuthUser {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
}

export interface SesionResult {
  token: string;
  user: AuthUser;
}

export type EstadoMovimiento = 'BORRADOR' | 'CONFIRMADO' | 'ANULADO';

export interface MovimientoResumen {
  id: number;
  nro: string;
  tipo: string; // codigo del catálogo: RECEPCION | RINT | AJUSTE | …
  estado: EstadoMovimiento;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  origen_id: number;
  origen_dep_id_3c: number;
  origen_nombre: string;
  destino_id: number;
  destino_dep_id_3c: number;
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
  ubicacion_dep_id_3c: number;
  ubicacion_nombre: string;
  cantidad: number;
  actualizado_en: string | null;
}

// Movimiento que toca un producto (desplegable de stock).
export interface MovimientoDeProducto {
  id: number;
  nro: string;
  tipo: string;
  estado: EstadoMovimiento;
  fecha: string;
  origen_id: number;
  origen_dep_id_3c: number;
  origen_nombre: string;
  destino_id: number;
  destino_dep_id_3c: number;
  destino_nombre: string;
  cantidad_real: string;
  unidad: string;
  saldo: number | null; // saldo en la ubicación después de este movimiento (kardex)
}

// ── Catálogos (selects del front) ────────────────────────────────────────────
export interface Ubicacion {
  id: number;
  nombre: string;
  tipo: string;
  dep_id_3c: number;
}
export interface Producto {
  codigo_3c: string;
  nombre: string;
  unidad_base: string;
}
export interface TipoMovimiento {
  codigo: string;
  nombre: string;
  signo_stock: number;
}

// ── Detalle completo (round-trip para editar) ────────────────────────────────
export interface RenglonDetalle {
  producto_3c: string;
  producto_nombre: string;
  cantidad_real: string;
  cantidad_sugerida: string | null;
  stock_contado: string | null;
  unidad: string;
  observaciones: string | null;
}
export interface MovimientoDetalle {
  id: number;
  nro: string;
  tipo: string;
  estado: EstadoMovimiento;
  fecha: string;
  turno: string | null;
  proyeccion: string | null;
  observaciones: string | null;
  origen_id: number;
  origen_dep_id_3c: number;
  origen_nombre: string;
  destino_id: number;
  destino_dep_id_3c: number;
  destino_nombre: string;
  confirmado_en: string | null;
  anulado_en: string | null;
  detalle: RenglonDetalle[];
}

// ── Precios ──────────────────────────────────────────────────────────────────
// Precio vigente por producto (incluye productos sin precio: precio = null).
export interface PrecioVigente {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  precio: string | null; // numeric(14,4) serializado; null = sin precio cargado
  vigente_desde: string | null; // YYYY-MM-DD
  precio_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
}

// Una fila del historial de precios de un producto (alimenta el gráfico).
export interface PrecioHistorial {
  id: number;
  precio: string;
  vigente_desde: string; // YYYY-MM-DD
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
  usuario_id: number;
  creado_en: string;
}

// ── Valorización del stock (panel) ───────────────────────────────────────────
export interface ValorPorDeposito {
  ubicacion_id: number;
  ubicacion_dep_id_3c: number;
  ubicacion_nombre: string;
  valor: string;
  valorizados: number;
  sin_precio: number;
}
export interface TopProducto {
  producto_3c: string;
  producto_nombre: string;
  cantidad: string;
  precio: string;
  valor: string;
}
export interface Valorizacion {
  total: { valor_total: string; items_valorizados: number; items_sin_precio: number; depositos: number };
  por_deposito: ValorPorDeposito[];
  top_productos: TopProducto[];
}

// ── Historial de ediciones ───────────────────────────────────────────────────
export interface CambioAuditoria {
  campo: string;
  antes: unknown;
  despues: unknown;
}
export interface FilaHistorial {
  id: number;
  secuencia: number; // nro de edición dentro del movimiento (1 = la más vieja)
  usuario_id: number;
  accion: string;
  cambios: CambioAuditoria[];
  creado_en: string;
}
