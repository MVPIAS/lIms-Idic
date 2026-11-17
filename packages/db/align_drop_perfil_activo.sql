-- =============================================================================
-- LIMS IDIC · Retira la tabla usuario_perfil_activo (obsoleta desde F028) · Aiuken
-- =============================================================================
-- Desde align_f028_saec.sql el perfil activo viaja en el token de cada sesión
-- (claim `pu`) y la tabla ya no se lee ni se escribe. Se elimina para que el
-- esquema no conserve estructuras sin uso. Idempotente.
-- Ojo: volver a una imagen anterior a F028 (63132a4 o previa) requiere recrearla
-- con el bloque correspondiente de align_sesiones_s2.sql.
-- =============================================================================
DROP TABLE IF EXISTS usuario_perfil_activo;
