-- Crea la base de datos de test junto a la principal.
-- Corre una sola vez, al inicializar el volumen de Postgres.
-- (No usa IF NOT EXISTS porque CREATE DATABASE no lo soporta; en init siempre está limpio.)
CREATE DATABASE laceleste_movimientos_test;
