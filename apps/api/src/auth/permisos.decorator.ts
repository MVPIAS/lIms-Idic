import { SetMetadata } from "@nestjs/common";

export const PERMISOS_KEY = "permisos_requeridos";

/**
 * Marca una ruta/controlador con los permisos requeridos (RBAC).
 * Uso: @RequierePermiso("cliente.crear")  ·  se evalúa con PermisoGuard.
 * SUPERADMIN siempre pasa.
 */
export const RequierePermiso = (...codigos: string[]) => SetMetadata(PERMISOS_KEY, codigos);
