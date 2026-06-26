-- Inicialización mínima de PostgreSQL para desarrollo
-- El schema completo se carga aparte con: psql -f ../../02_diseno/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Mensaje de confirmación
DO $$ BEGIN
  RAISE NOTICE 'PostgreSQL inicializado para LIMS IDIC. Cargar schema.sql ahora.';
END $$;
