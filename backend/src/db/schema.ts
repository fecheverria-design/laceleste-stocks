import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Schema de referencia: §8 de docs/ARCHITECTURE.md.
// Se mantienen nombres y tipos EXACTOS del DDL. Tipos de movimiento como catálogo
// (no enum). La matview stock_actual, las secuencias de correlativos y la función
// generar_nro viven en una migración SQL custom (no se modelan en Drizzle).
// ─────────────────────────────────────────────────────────────────────────────

// Concepto genérico: DEPOSITO | AREA | SUCURSAL. Multi-depósito sale gratis.
export const ubicaciones = pgTable('ubicaciones', {
  id: serial('id').primaryKey(),
  nombre: varchar('nombre', { length: 100 }).notNull(),
  tipo: varchar('tipo', { length: 16 }).notNull(), // 'DEPOSITO' | 'AREA' | 'SUCURSAL'
  depId3c: integer('dep_id_3c').notNull().unique(), // EL PUENTE CON 3C (una ubicación por dep de 3c)
  // Solo las ubicaciones con lleva_stock=true acumulan stock. El resto (áreas de
  // producción, proveedores, ajustes, devolución) son tránsito/virtuales. El stock
  // se calcula por doble entrada: +cantidad al destino y −cantidad al origen, pero
  // solo si ese lado lleva_stock. Define quién lleva stock con `npm run db:stock-en`.
  llevaStock: boolean('lleva_stock').notNull().default(false),
  activo: boolean('activo').notNull().default(true),
});

// Catálogo extensible. Sumar DEVOLUCION/TRANSFERENCIA = insertar fila, cero migración.
export const tiposMovimiento = pgTable('tipos_movimiento', {
  id: serial('id').primaryKey(),
  codigo: varchar('codigo', { length: 16 }).notNull().unique(), // 'RECEPCION' | 'RINT' | 'AJUSTE' | (futuros)
  nombre: varchar('nombre', { length: 100 }).notNull(),
  signoStock: smallint('signo_stock').notNull(), // +1 suma, -1 resta, 0 según renglón
});

// codigo_3c es la PK: viene del maestro de 3c, NO se inventa.
export const productos = pgTable('productos', {
  codigo3c: varchar('codigo_3c', { length: 32 }).primaryKey(),
  nombre: varchar('nombre', { length: 200 }).notNull(),
  unidadBase: varchar('unidad_base', { length: 16 }).notNull(), // 'KG' | 'UN' | 'LT'
  familia: varchar('familia', { length: 64 }), // nullable; viene de 3c (PACKAGING, MATERIAS PRIMAS…)
  presentacion: jsonb('presentacion'), // {"bulto":"bolsa","equivale":25,"unidad":"KG"} — puerta abierta
  activo: boolean('activo').notNull().default(true),
});

export const usuarios = pgTable('usuarios', {
  id: serial('id').primaryKey(),
  nombre: varchar('nombre', { length: 100 }).notNull(),
  email: varchar('email', { length: 150 }).notNull().unique(),
  passHash: varchar('pass_hash', { length: 255 }).notNull(),
  rol: varchar('rol', { length: 16 }).notNull(), // 'ADMIN' | 'DEPOSITO' (v1)
  activo: boolean('activo').notNull().default(true),
});

// Puerta abierta — lógica de proveedor sin implementar en v1, pero el maestro se
// puede poblar (import desde 3c). numero_3c = ID del proveedor en 3c (regla #1),
// clave para deduplicar al importar y mapear a futuro.
export const proveedores = pgTable('proveedores', {
  id: serial('id').primaryKey(),
  numero3c: integer('numero_3c').unique(),
  nombre: varchar('nombre', { length: 150 }).notNull(),
  cuit: varchar('cuit', { length: 20 }),
});

export const lotes = pgTable('lotes', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  producto3c: varchar('producto_3c', { length: 32 })
    .notNull()
    .references(() => productos.codigo3c),
  codigoLote: varchar('codigo_lote', { length: 64 }),
  vencimiento: date('vencimiento'),
});

// Cabecera del movimiento.
export const movimientos = pgTable(
  'movimientos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    nro: varchar('nro', { length: 32 }).notNull().unique(), // 'RINT-2026-00452' (propio)
    tipoId: integer('tipo_id')
      .notNull()
      .references(() => tiposMovimiento.id),
    fecha: date('fecha').notNull(),
    hora: time('hora').notNull(),
    turno: varchar('turno', { length: 16 }), // 'MAÑANA' | 'TARDE' | NULL
    origenId: integer('origen_id')
      .notNull()
      .references(() => ubicaciones.id),
    destinoId: integer('destino_id')
      .notNull()
      .references(() => ubicaciones.id),
    estado: varchar('estado', { length: 16 }).notNull().default('BORRADOR'), // 'BORRADOR'|'CONFIRMADO'|'ANULADO'
    proyeccion: varchar('proyeccion', { length: 16 }), // 'MIN'|'MED'|'MAX'|'ESP' (solo Rint)
    proveedorId: integer('proveedor_id').references(() => proveedores.id), // nullable, puerta abierta
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    nro3c: varchar('nro_3c', { length: 64 }), // nullable, sync con 3c
    observaciones: text('observaciones'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    confirmadoEn: timestamp('confirmado_en', { withTimezone: true }),
    anuladoEn: timestamp('anulado_en', { withTimezone: true }),
    anuladoPor: integer('anulado_por').references(() => usuarios.id),
  },
  (t) => [
    index('idx_mov_fecha').on(t.fecha.desc()),
    index('idx_mov_estado').on(t.estado),
    index('idx_mov_destino_fecha').on(t.destinoId, t.fecha.desc()),
  ],
);

// Renglones del movimiento. cantidad_real es LA VERDAD: mueve el stock, obligatoria.
export const movimientosDetalle = pgTable(
  'movimientos_detalle',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    movimientoId: bigint('movimiento_id', { mode: 'number' })
      .notNull()
      .references(() => movimientos.id, { onDelete: 'restrict' }),
    producto3c: varchar('producto_3c', { length: 32 })
      .notNull()
      .references(() => productos.codigo3c),
    cantidadReal: numeric('cantidad_real', { precision: 12, scale: 3 }).notNull(),
    cantidadSugerida: numeric('cantidad_sugerida', { precision: 12, scale: 3 }), // referencia, nullable (solo Rint)
    stockContado: numeric('stock_contado', { precision: 12, scale: 3 }), // nullable (solo Rint)
    unidad: varchar('unidad', { length: 16 }).notNull(),
    loteId: bigint('lote_id', { mode: 'number' }).references(() => lotes.id), // nullable, puerta abierta
    observaciones: text('observaciones'),
  },
  (t) => [
    index('idx_det_mov').on(t.movimientoId),
    index('idx_det_producto').on(t.producto3c),
    check('chk_real_positiva', sql`${t.cantidadReal} >= 0`),
  ],
);

// Historial de ediciones (regla #4 relajada 2026-06-19: el confirmado es editable,
// pero queda rastro). Una fila por edición; `cambios` lista qué campos cambiaron con
// su valor antes/después, para poder conciliar correcciones con 3c (regla #7).
export const movimientosAuditoria = pgTable(
  'movimientos_auditoria',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    movimientoId: bigint('movimiento_id', { mode: 'number' })
      .notNull()
      .references(() => movimientos.id),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    accion: varchar('accion', { length: 16 }).notNull(), // 'EDICION' (futuro: otras)
    cambios: jsonb('cambios').notNull(), // [{ campo, antes, despues }]
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_mov').on(t.movimientoId)],
);

// Historial de precios por producto. Una fila = un precio de un proveedor en una fecha,
// con un TIPO: COMPRA (lo que efectivamente se pagó) o ACTUALIZACION (precio de lista
// del proveedor). El "precio vigente" es la última COMPRA (decisión de J: la compra es
// el costo real); si nunca hubo compra, cae a la última actualización como referencia.
// El gráfico de evolución usa solo las COMPRA. proveedor_id nullable (carga manual).
// Cargar un precio = fila nueva; corregir = editar/borrar. Audita quién lo cargó (regla #7).
export const precios = pgTable(
  'precios',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    producto3c: varchar('producto_3c', { length: 32 })
      .notNull()
      .references(() => productos.codigo3c),
    proveedorId: integer('proveedor_id').references(() => proveedores.id), // nullable
    precio: numeric('precio', { precision: 14, scale: 4 }).notNull(), // ARS, hasta 4 decimales
    tipo: varchar('tipo', { length: 16 }).notNull().default('COMPRA'), // 'COMPRA' | 'ACTUALIZACION'
    vigenteDesde: date('vigente_desde').notNull(), // fecha del precio (compra o actualización)
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_precios_producto_fecha').on(t.producto3c, t.vigenteDesde.desc()),
    // Un registro por (producto, proveedor, fecha, tipo): permite compra y actualización
    // el mismo día y varios proveedores; hace idempotente la importación (upsert por esta clave).
    uniqueIndex('uq_precio_prod_prov_fecha_tipo').on(t.producto3c, t.proveedorId, t.vigenteDesde, t.tipo),
    check('chk_precio_positivo', sql`${t.precio} >= 0`),
  ],
);

// Compras reales a proveedores (una fila = un renglón de una factura/orden de 3c). Base
// del "gasto por proveedor". precio_total es el neto (sin IVA); total_con_iva es lo
// efectivamente pagado. Idempotente por (numero, producto_3c).
export const compras = pgTable(
  'compras',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    numero: varchar('numero', { length: 64 }).notNull(), // NUMERO del documento de 3c
    fecha: date('fecha').notNull(),
    producto3c: varchar('producto_3c', { length: 32 })
      .notNull()
      .references(() => productos.codigo3c),
    proveedorId: integer('proveedor_id').references(() => proveedores.id), // nullable si no resuelve
    cantidad: numeric('cantidad', { precision: 14, scale: 4 }).notNull(),
    precioUnitario: numeric('precio_unitario', { precision: 14, scale: 4 }).notNull(),
    precioTotal: numeric('precio_total', { precision: 16, scale: 2 }).notNull(), // neto (sin IVA)
    iva: numeric('iva', { precision: 6, scale: 4 }), // alícuota (0.21, 0.105, 0)
    totalConIva: numeric('total_con_iva', { precision: 16, scale: 2 }), // VALOR TOTAL (con IVA)
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_compras_proveedor').on(t.proveedorId),
    index('idx_compras_fecha').on(t.fecha.desc()),
    uniqueIndex('uq_compras_numero_producto').on(t.numero, t.producto3c),
  ],
);
