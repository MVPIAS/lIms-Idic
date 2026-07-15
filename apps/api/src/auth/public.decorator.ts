import { SetMetadata } from "@nestjs/common";

export const PUBLIC_KEY = "ruta_publica";

/**
 * Marca una ruta como pública (sin JWT). Solo la leen JwtAuthGuard (global).
 * Úsese con moderación: hoy solo login, refresh y health.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
