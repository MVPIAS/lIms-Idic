/**
 * Inteligencia de negocio (Metabase, contrato §4.7.5 / §4.5.7 / §4.6.5) · regla
 * PURA de la dirección que abre el menú «Análisis e inteligencia de negocio».
 * La fija la variable de entorno URL_BI (docker-compose.prod.yml:
 * https://bi.<dominio>). Probada en respaldos.reglas.spec.ts.
 */

/** Dirección http(s) válida sin barra final, o null si falta o no es una URL. */
export function urlBi(valor: string | null | undefined): string | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Sin credenciales embebidas: la URL se muestra en pantalla.
    if (u.username || u.password) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Acceso TEMPORAL a Metabase mostrado en la pantalla «Análisis e inteligencia de
 * negocio», igual que los accesos de prueba del ingreso. Los valores viven en el
 * servidor (BI_ACCESO_USUARIO / BI_ACCESO_CLAVE, nunca en el repositorio) y solo
 * se entregan al administrador del LIMS. Retirar cuando el IDIC tenga sus propios
 * usuarios de Metabase: basta con vaciar las variables.
 */
export interface AccesoBi {
  usuario: string;
  clave: string;
}

export const ROLES_ADMIN_BI = ["SUPERADMIN", "ADMIN"];

export function esAdministradorLims(user: { roles?: string[]; permisos?: string[] } | null | undefined): boolean {
  const roles = user?.roles ?? [];
  const permisos = user?.permisos ?? [];
  return roles.some((r) => ROLES_ADMIN_BI.includes(r)) || permisos.includes("admin.usuarios");
}

export function accesoBi(
  usuario: string | null | undefined,
  clave: string | null | undefined,
  user: { roles?: string[]; permisos?: string[] } | null | undefined,
): AccesoBi | null {
  const u = String(usuario ?? "").trim();
  const c = String(clave ?? "");
  if (!u || !c || !esAdministradorLims(user)) return null;
  return { usuario: u, clave: c };
}
