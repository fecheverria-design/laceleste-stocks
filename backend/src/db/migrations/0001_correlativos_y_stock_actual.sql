-- ─────────────────────────────────────────────────────────────────────────────
-- Correlativos + stock_actual. Lo que Drizzle no modela (secuencias con nombre
-- propio, función plpgsql, vista materializada) se define a mano acá.
-- Ref: §8 de docs/ARCHITECTURE.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- Secuencias de correlativos por tipo y año (2026 explícitas).
-- Para años futuros, generar_nro() crea la secuencia on-demand → cero migración.
CREATE SEQUENCE IF NOT EXISTS seq_rint_2026;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS seq_rec_2026;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS seq_aju_2026;
--> statement-breakpoint

-- generar_nro('RINT', 2026) -> 'RINT-2026-00452'
--   RECEPCION -> REC, RINT -> RINT, AJUSTE -> AJU.
-- Crea la secuencia del año si no existe, así un año nuevo no necesita migración.
CREATE OR REPLACE FUNCTION generar_nro(p_tipo text, p_anio int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text;
  v_seq    text;
  v_n      bigint;
BEGIN
  v_prefix := CASE upper(p_tipo)
    WHEN 'RINT'      THEN 'RINT'
    WHEN 'RECEPCION' THEN 'REC'
    WHEN 'AJUSTE'    THEN 'AJU'
    ELSE upper(p_tipo)
  END;

  v_seq := 'seq_' || lower(v_prefix) || '_' || p_anio::text;

  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq);
  EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_n;

  RETURN v_prefix || '-' || p_anio::text || '-' || lpad(v_n::text, 5, '0');
END;
$$;
--> statement-breakpoint

-- Stock actual: vista materializada. Stock = SUM(cantidad_real * signo_stock).
-- Para RINT el stock se descuenta del ORIGEN (depósito); el resto suma al destino.
-- Solo cuenta movimientos CONFIRMADOS. La cantidad_real es la verdad.
CREATE MATERIALIZED VIEW stock_actual AS
SELECT
  d.producto_3c,
  CASE WHEN tm.codigo = 'RINT' THEN m.origen_id ELSE m.destino_id END AS ubicacion_id,
  SUM(d.cantidad_real * tm.signo_stock) AS cantidad,
  MAX(m.confirmado_en) AS actualizado_en
FROM movimientos m
JOIN tipos_movimiento tm ON tm.id = m.tipo_id
JOIN movimientos_detalle d ON d.movimiento_id = m.id
WHERE m.estado = 'CONFIRMADO'
GROUP BY d.producto_3c, ubicacion_id;
--> statement-breakpoint

-- UNIQUE index: requisito para REFRESH MATERIALIZED VIEW CONCURRENTLY
-- (que corre dentro de la transacción de confirmación en Fase 1).
CREATE UNIQUE INDEX idx_stock_prod_ubic ON stock_actual (producto_3c, ubicacion_id);