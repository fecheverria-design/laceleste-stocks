-- ─────────────────────────────────────────────────────────────────────────────
-- Tipo de movimiento INVENTARIO: recuento / carga de la foto de stock físico.
-- Separa el RECUENTO (import:inventario y el módulo Inventarios) de los AJUSTE
-- operativos del día a día, para que no se mezclen en reportes ni kardex.
-- signo_stock 0 (el efecto en stock lo da la DIRECCIÓN contra el balde 101, igual
-- que AJUSTE; la vista stock_actual no mira el código de tipo). Decisión de J, 2026-07-01.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO tipos_movimiento (codigo, nombre, signo_stock)
VALUES ('INVENTARIO', 'Recuento de inventario', 0)
ON CONFLICT (codigo) DO NOTHING;
--> statement-breakpoint

-- Secuencia de correlativos 2026 para el nuevo tipo (INV-2026-00001).
CREATE SEQUENCE IF NOT EXISTS seq_inv_2026;
--> statement-breakpoint

-- generar_nro: agregar el prefijo INV para INVENTARIO (correlativo corto y prolijo,
-- como RINT/REC/AJU). El resto de la función queda igual que en 0001.
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
    WHEN 'RINT'       THEN 'RINT'
    WHEN 'RECEPCION'  THEN 'REC'
    WHEN 'AJUSTE'     THEN 'AJU'
    WHEN 'INVENTARIO' THEN 'INV'
    ELSE upper(p_tipo)
  END;

  v_seq := 'seq_' || lower(v_prefix) || '_' || p_anio::text;

  EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq);
  EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_n;

  RETURN v_prefix || '-' || p_anio::text || '-' || lpad(v_n::text, 5, '0');
END;
$$;
