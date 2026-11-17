import { SetMetadata } from "@nestjs/common";

export const PERMISOS_KEY = "permisos_requeridos";
export const PERMISOS_CRUD_KEY = "permisos_requeridos_crud";
export const PERMISOS_ALGUNO_KEY = "permisos_requeridos_alguno";

/**
 * Marca una ruta/controlador con los permisos requeridos (RBAC).
 * Uso: @RequierePermiso("cliente.crear")  ·  se evalúa con PermisoGuard.
 * SUPERADMIN siempre pasa.
 *
 * Puesto en un método, tiene prioridad sobre el @RequierePermiso o el
 * @RequierePermisoCrud declarados en la clase.
 */
export const RequierePermiso = (...codigos: string[]) => SetMetadata(PERMISOS_KEY, codigos);

/**
 * Basta UNO de los permisos (en orden de preferencia). Solo en métodos; gana a
 * @RequierePermiso de la clase. El alcance por asignación se calcula con el
 * PRIMERO de la lista que el usuario tiene (queda en `req.__permisosRuta`), así
 * quien ya tenía el primero conserva exactamente el alcance de antes.
 * Uso: @RequiereAlgunPermiso("cotizacion.ver", "cotizacion.costear").
 */
export const RequiereAlgunPermiso = (...codigos: string[]) => SetMetadata(PERMISOS_ALGUNO_KEY, codigos);

/** Permisos por verbo HTTP para los controladores que heredan de BaseCrudController. */
export interface PermisosCrud {
  /** GET (listar/detalle) */
  ver?: string;
  /** POST */
  crear?: string;
  /** PATCH / PUT */
  editar?: string;
  /** DELETE */
  eliminar?: string;
}

/**
 * Declara el mapa permiso→verbo de un controlador CRUD.
 *
 * Las subclases de BaseCrudController HEREDAN las rutas (@Get/@Post/…) de la
 * clase base, así que no hay un método propio donde colgar @RequierePermiso por
 * verbo: un @RequierePermiso a nivel de clase aplicaría el mismo código a los
 * cuatro verbos. Este decorador guarda el mapa en la clase y PermisoGuard
 * resuelve el permiso según `req.method`.
 *
 *   @RequierePermisoCrud({ ver: "cliente.ver", crear: "cliente.crear", ... })
 *
 * Un verbo sin permiso declarado exige solo autenticación (no se bloquea).
 */
export const RequierePermisoCrud = (permisos: PermisosCrud) =>
  SetMetadata(PERMISOS_CRUD_KEY, permisos);
