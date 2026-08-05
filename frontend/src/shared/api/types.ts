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

// Usuario con campos públicos (GET /api/usuarios) — para selects, ej. filtro "quién cargó".
export interface UsuarioPublico {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
}

// Maestro de artículos (productos).
export interface Articulo {
  codigo_3c: string;
  nombre: string;
  unidad_base: string;
  familia: string | null;
  subfamilia: string | null;
  presentacion_compra: string | null;
  unidades_por_bulto: string | null; // numeric → string
  clasificacion_abc: string | null;
  informacion: string | null;
  activo: boolean;
  creado_local: boolean;
}

export interface ListaArticulos {
  items: Articulo[];
  page: number;
  limit: number;
  total: number;
}

// Inventarios (conteo físico → AJUSTE).
export interface InventarioResumen {
  id: number;
  ubicacion_id: number;
  ubicacion_nombre: string;
  fecha: string;
  estado: string;
  lineas: number;
  contadas: number;
  creado_en: string | null;
  confirmado_en: string | null;
}

export interface LineaInventario {
  producto_3c: string;
  nombre: string;
  familia: string | null;
  subfamilia: string | null;
  unidad: string;
  presentacion_compra: string | null;
  unidades_por_bulto: number | null;
  stock_sistema: number;
  cantidad_contada: number | null;
  diferencia: number | null;
  porcentaje: number | null;
}

export interface InventarioDetalle {
  id: number;
  ubicacion_id: number;
  ubicacion_nombre: string;
  ubicacion_dep_id_3c: number;
  fecha: string;
  estado: string;
  familias: string[] | null;
  observaciones: string | null;
  confirmado_en: string | null;
  movimiento_entrada_id: number | null;
  movimiento_salida_id: number | null;
  lineas: LineaInventario[];
}

export interface ResultadoConfirmacion {
  inventario: InventarioDetalle;
  resumen: {
    entrada_nro: string | null;
    salida_nro: string | null;
    renglones_entrada: number;
    renglones_salida: number;
    sin_cambio: number;
    sin_contar: number;
  };
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
  proveedor_nombre: string | null; // solo RECEPCION; null en el resto
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
  producto_familia: string | null;
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
  // Info de referencia (nullable; se muestra al elegir el producto en un renglón).
  familia?: string | null;
  subfamilia?: string | null;
  presentacion_compra?: string | null;
  unidades_por_bulto?: string | null; // numeric → string por el driver
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
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
  confirmado_en: string | null;
  anulado_en: string | null;
  anulado_por: number | null;
  anulado_por_nombre: string | null; // quién lo anuló (null si sigue vivo)
  creado_por: number;
  creado_por_nombre: string; // quién lo cargó
  detalle: RenglonDetalle[];
}

// ── Precios ──────────────────────────────────────────────────────────────────
// Precio vigente por producto (incluye productos sin precio: precio = null).
export type TipoPrecio = 'COMPRA' | 'ACTUALIZACION';

export interface PrecioVigente {
  producto_3c: string;
  producto_nombre: string;
  producto_familia: string | null;
  unidad_base: string;
  precio: string | null; // numeric(14,4) serializado; null = sin precio cargado
  vigente_desde: string | null; // YYYY-MM-DD
  tipo: TipoPrecio | null; // tipo del precio vigente (COMPRA manda; ACTUALIZACION = fallback)
  controlado: boolean | null; // el vigente es el marcado a mano en Control de precios
  precio_id: number | null;
  proveedor_nombre: string | null;
  proveedor_numero_3c: number | null;
}

// Una fila del historial de precios de un producto (alimenta el gráfico).
export interface PrecioHistorial {
  id: number;
  precio: string;
  tipo: TipoPrecio;
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

// ── Consumos por área ────────────────────────────────────────────────────────
export interface ConsumoArea {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  area_id: number;
  area_dep_id_3c: number;
  area_nombre: string;
  total: number;
  promedio_semanal: number;
  renglones: number;
  precio_vigente: number | null;
  costo: number | null;
}
export interface Consumos {
  desde: string;
  hasta: string;
  semanas: number;
  costo_total: number;
  items: ConsumoArea[];
}

// ── Proveedores + gasto (compras reales) ─────────────────────────────────────
export interface Proveedor {
  id: number;
  numero_3c: number | null;
  nombre: string;
  cuit: string | null;
  compras: number;
  gasto_neto: string; // numeric serializado
  familias: string[] | null;
}
export interface GastoProveedor {
  proveedor_id: number;
  nombre: string;
  familia: string | null;
  compras: number;
  gasto_neto: string;
}
// Detalle de un proveedor: productos que le compramos (de qué es su gasto).
export interface ProductoDeProveedor {
  producto_3c: string;
  producto_nombre: string;
  familia: string | null;
  compras: number;
  gasto_neto: string;
}
export interface GastoMes {
  mes: string; // YYYY-MM
  gasto_neto: string;
  compras: number;
}

// ── Informe de Compras ───────────────────────────────────────────────────────
// El gasto va CON IVA (como el informe de la planilla) y la variación de precio sobre el
// neto (un cambio de alícuota no es un aumento). Ver backend/src/services/informe.service.ts.
export type Comprador = 'Lautaro' | 'Fausto';

export interface FilaProveedorInforme {
  proveedor_id: number | null;
  nombre: string;
  gasto: number;
  gasto_anterior: number;
  var_gasto: number | null;
  var_precio: number | null; // ponderada por gasto
  productos: number;
}

export interface FilaProductoInforme {
  producto_3c: string;
  nombre: string;
  familia: string | null;
  comprador: Comprador;
  clasificacion_abc: string | null;
  gasto: number;
  gasto_anterior: number;
  cantidad: number;
  precio: number | null; // vigente al cierre del mes: el que manda la variación
  precio_anterior: number | null;
  var_precio: number | null;
  precio_pagado: number | null; // promedio de lo pagado ese mes, solo referencia
}

export interface InformeCompradores {
  mes: string;
  mes_anterior: string;
  resumen: {
    gasto: number;
    gasto_anterior: number;
    var_gasto: number | null;
    renglones: number;
    proveedores: number;
    productos: number;
  };
  por_comprador: Array<{ comprador: Comprador; gasto: number; gasto_anterior: number; var_gasto: number | null }>;
  proveedores: FilaProveedorInforme[];
  productos: FilaProductoInforme[];
}

export interface SerieProveedor {
  nombre: string;
  serie: Array<number | null>; // null = ese mes no se le compró (la línea se corta)
  total: number;
}
export interface EvolucionGasto {
  meses: string[];
  total: number[];
  proveedores: SerieProveedor[];
}

// ── Informe de Compras · solapas de precios ──────────────────────────────────
// Espejo de backend/src/services/informe-precios.service.ts. Todas las variaciones
// vienen como FRACCIÓN (0.12 = +12%); el % se arma en pantalla.

export interface CotizacionProducto {
  precio_id: number; // fila de `precios`: la hoja de Control la edita o la marca
  proveedor: string;
  proveedor_id: number | null;
  tipo: TipoPrecio;
  precio: number;
  fecha: string;
  dias: number;
  reciente: boolean; // ≤60 días
  vigente: boolean; // ≤180 días: recién ahí cuenta para el objetivo de 3 cotizaciones
  es_usado: boolean; // es el precio con el que se compra
  controlado: boolean; // marcado a mano por compras: le gana a la regla automática
  controlado_en: string | null;
  controlado_por: string | null; // nombre del usuario que lo marcó
}

export interface FilaMatriz {
  producto_3c: string;
  producto: string;
  familia: string | null;
  comprador: Comprador | null;
  n_prov: number;
  n_prov_hist: number;
  precio: number | null;
  proveedor: string | null;
  fecha: string | null;
  dias: number | null;
  sin_compra: boolean; // no tiene ningún precio tipo COMPRA (usa fallback)
  controlado: boolean; // el precio que se usa es el marcado a mano
  controlado_en: string | null;
  controlado_por: string | null;
  cotizaciones: CotizacionProducto[];
}

export interface Cobertura {
  c1: number;
  c2: number;
  c3: number;
  riesgo: Array<{ producto: string; familia: string | null; n_prov: number }>;
}

export interface ControlDatos {
  saltos: Array<{ producto: string; familia: string | null; mes: string; de: number; a: number; var: number }>;
  vencidos: Array<{ producto: string; familia: string | null; proveedor: string | null; dias: number }>;
  sin_compra: Array<{ producto: string; familia: string | null }>;
  umbral: number;
  dias_vencido: number;
}

export interface FilaAhorro {
  producto: string;
  familia: string | null;
  comprador: Comprador | null;
  compra: number;
  mejor: number;
  mejor_proveedor: string;
  gap: number;
  gasto: number;
  monto: number;
}

export interface Ahorro {
  favor: FilaAhorro[];
  contra: FilaAhorro[];
  total_favor: number;
  total_contra: number;
  neto: number;
  gasto_a: number;
  pct_favor: number | null;
  pct_contra: number | null;
  por_comprador: Record<string, { favor: { monto: number; pct: number | null }; contra: { monto: number; pct: number | null } }>;
}

export interface FilaVariacionVentana {
  producto: string;
  familia: string | null;
  precio: number;
  mes_precio: string; // puede ser anterior al mes del informe si no hubo carga nueva
  var_1: number | null;
  var_3: number | null;
  var_6: number | null;
}

export interface Contribucion {
  mes: string;
  var_indice: number;
  items: Array<{ producto: string; familia: string | null; gasto: number; peso: number; var: number; aporte: number }>;
}

export interface Canasta {
  meses: string[];
  ancla: string;
  outlier_max: number;
  scopes: Record<string, Array<number | null>>;
  contrib: Record<string, Contribucion>;
  anomalias: Array<{ producto: string; familia: string | null; mes: string; de: number; a: number; var: number; gasto: number }>;
}

// ── Indicadores mensuales de carga manual ────────────────────────────────────
// `inflacion` viaja como FRACCIÓN (0.021 = 2,1%), igual que el resto de las variaciones.
export type InflacionModo = 'MENSUAL' | 'ACUMULADA';

export interface IndicadorMensual {
  periodo: string; // YYYY-MM
  ventas: number | null;
  /** Lo que se cargó, tal cual. Su significado lo da `inflacion_modo`. */
  inflacion: number | null;
  inflacion_modo: InflacionModo;
  /** Variación del mes. Derivada si se cargó acumulada. Es la que consume el informe. */
  inflacion_mensual: number | null;
  /** Acumulada del año calendario. Derivada si se cargó mensual. */
  inflacion_acumulada: number | null;
  actualizado_en: string;
}

// ── Control de precios (hoja de trabajo del área de compras) ─────────────────
export type AlertaPrecio =
  | 'SIN_COMPRA'
  | 'VENCIDO'
  | 'POCAS_COTIZACIONES'
  | 'SALTO'
  | 'SIN_PROVEEDOR';

export interface FilaControlPrecio extends FilaMatriz {
  alertas: AlertaPrecio[];
  alternativas_frescas: number;
  salto: { mes: string; de: number; a: number; var: number } | null;
}

export interface ControlPrecios {
  filtro: { abc: string; familia?: string };
  objetivo_cotizaciones: number;
  dias_vencido: number;
  resumen: {
    productos: number;
    a_revisar: number;
    sin_compra: number;
    vencidos: number;
    pocas_cotizaciones: number;
    saltos: number;
    sin_proveedor: number;
  };
  items: FilaControlPrecio[];
}

export interface InformePrecios {
  mes: string;
  meses: string[];
  matriz: FilaMatriz[];
  cobertura: Cobertura;
  control: ControlDatos;
  ahorro: Ahorro;
  variacion_ventanas: FilaVariacionVentana[];
  canasta: Canasta;
}

// ── Historial de ediciones ───────────────────────────────────────────────────
export interface CambioAuditoria {
  campo: string;
  antes: unknown;
  despues: unknown;
}
export interface FilaHistorial {
  id: number;
  secuencia: number; // nro de evento dentro del movimiento (1 = el más viejo)
  usuario_id: number;
  usuario_nombre: string;
  accion: 'EDICION' | 'ANULACION' | 'REACTIVACION' | string;
  cambios: CambioAuditoria[];
  creado_en: string;
}
