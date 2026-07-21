-- =============================================================================
-- align_seguridad.sql · Hallazgos del pentest que requieren columna en BD
-- -----------------------------------------------------------------------------
-- Aditivo e idempotente.
-- A-04 (pentest AUTH): invalidación de tokens en logout. Se añade token_version;
-- el logout lo incrementa y el /auth/refresh exige que el `tv` del refresh token
-- coincida con el actual -> tras logout, los refresh tokens previos dejan de
-- renovar (sin blacklist en Redis).
-- =============================================================================

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN usuario.token_version IS
  'Se incrementa en cada logout; /auth/refresh solo renueva si el tv del token coincide. Invalida sesiones tras logout.';
