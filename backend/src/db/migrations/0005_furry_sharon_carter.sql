ALTER TABLE "ubicaciones" ADD COLUMN "lleva_stock" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Redefinición de stock_actual: DOBLE ENTRADA restringida a ubicaciones con stock.
-- El stock vive solo donde lleva_stock=true. Cada renglón suma al destino y resta
-- del origen, pero solo cuenta el lado que lleva stock. Así un mismo tipo (ej. Rint)
-- funciona como entrada o salida según la dirección, y los baldes virtuales
-- (ajustes 101, proveedores 102, devolución…) no acumulan. signo_stock ya no se usa.
DROP MATERIALIZED VIEW stock_actual;
--> statement-breakpoint
CREATE MATERIALIZED VIEW stock_actual AS
SELECT
  producto_3c,
  ubicacion_id,
  SUM(delta) AS cantidad,
  MAX(actualizado_en) AS actualizado_en
FROM (
  SELECT d.producto_3c, m.destino_id AS ubicacion_id, d.cantidad_real AS delta, m.confirmado_en AS actualizado_en
  FROM movimientos m
  JOIN movimientos_detalle d ON d.movimiento_id = m.id
  JOIN ubicaciones u ON u.id = m.destino_id
  WHERE m.estado = 'CONFIRMADO' AND u.lleva_stock
  UNION ALL
  SELECT d.producto_3c, m.origen_id AS ubicacion_id, -d.cantidad_real AS delta, m.confirmado_en AS actualizado_en
  FROM movimientos m
  JOIN movimientos_detalle d ON d.movimiento_id = m.id
  JOIN ubicaciones u ON u.id = m.origen_id
  WHERE m.estado = 'CONFIRMADO' AND u.lleva_stock
) t
GROUP BY producto_3c, ubicacion_id;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_stock_prod_ubic ON stock_actual (producto_3c, ubicacion_id);