import { SetMetadata } from "@nestjs/common";

export const PERMITE_CAMBIO_CLAVE_KEY = "permite_cambio_clave_pendiente";

/**
 * Rutas que puede usar un usuario con el cambio de contraseña PENDIENTE
 * (claim `cambioClave` del JWT: usuario recién creado o con la contraseña
 * restablecida). Todo lo demás responde 403 `CAMBIO_CLAVE_REQUERIDO` hasta que
 * la cambie (PermisoGuard). Hoy: /auth/me, /auth/logout y /auth/cambiar-password.
 */
export const PermiteCambioClavePendiente = () => SetMetadata(PERMITE_CAMBIO_CLAVE_KEY, true);

export const CODIGO_CAMBIO_CLAVE = "CAMBIO_CLAVE_REQUERIDO";
