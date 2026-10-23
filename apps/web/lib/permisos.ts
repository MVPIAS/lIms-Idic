/**
 * permisos.ts · acceso del usuario en el FRONT (leído del JWT guardado).
 *
 * La seguridad real la impone el backend (PermisoGuard → 403). Esto sirve para
 * no mostrar en la UI lo que el rol no puede usar (mínimo privilegio visual):
 * ítems del menú, botones Nuevo/Editar/Eliminar, páginas de administración.
 *
 *   const { puede, listo } = usePermisos();
 *   if (puede("factura.emitir")) …           // un permiso
 *   if (puede(["admin.roles", "admin.usuarios"])) …  // cualquiera de la lista
 *
 * SUPERADMIN y ADMIN ven todo (igual que el menú histórico).
 */

import { useEffect, useState } from "react";

/** Perfiles funcionales (los define el backend en GET /me/alcance). */
export type Perfil =
  | "DIRECTOR" | "JEFE_DEPTO" | "JEFE_SECCION" | "JEFE_LAB" | "REVISOR" | "ANALISTA"
  | "COMERCIAL" | "PLANIFICACION" | "FINANZAS" | "ABASTECIMIENTO" | "CALIDAD" | "ADMIN" | "LECTOR";

export const PERFILES: Perfil[] = [
  "DIRECTOR", "JEFE_DEPTO", "JEFE_SECCION", "JEFE_LAB", "REVISOR", "ANALISTA",
  "COMERCIAL", "PLANIFICACION", "FINANZAS", "ABASTECIMIENTO", "CALIDAD", "ADMIN", "LECTOR",
];

/** Texto legible de cada perfil, para la insignia del menú y la bandeja. */
export const PERFIL_INFO: Record<Perfil, { etiqueta: string; descripcion: string }> = {
  DIRECTOR: { etiqueta: "Dirección", descripcion: "Supervisa todo el instituto y firma lo que corresponde a la Dirección." },
  JEFE_DEPTO: { etiqueta: "Jefatura de departamento", descripcion: "Supervisa los laboratorios de su departamento y firma informes." },
  JEFE_SECCION: { etiqueta: "Jefatura de sección", descripcion: "Coordina y revisa el trabajo de los laboratorios de su sección." },
  JEFE_LAB: { etiqueta: "Jefatura de laboratorio", descripcion: "Asigna el trabajo, revisa y aprueba los resultados de su laboratorio." },
  REVISOR: { etiqueta: "Revisor/a", descripcion: "Revisa los resultados capturados antes de su aprobación." },
  ANALISTA: { etiqueta: "Analista", descripcion: "Realiza los ensayos y registra los resultados de sus órdenes de trabajo." },
  COMERCIAL: { etiqueta: "Comercial", descripcion: "Atiende clientes, prepara cotizaciones y da seguimiento a las solicitudes." },
  PLANIFICACION: { etiqueta: "Planificación", descripcion: "Registra y distribuye las órdenes de trabajo entre laboratorios." },
  FINANZAS: { etiqueta: "Finanzas", descripcion: "Factura los servicios terminados y controla pagos y cobranza." },
  ABASTECIMIENTO: { etiqueta: "Abastecimiento", descripcion: "Gestiona proveedores, órdenes de compra y stock de consumibles." },
  CALIDAD: { etiqueta: "Calidad", descripcion: "Vigila el control de calidad, equipos, calibraciones y custodia." },
  ADMIN: { etiqueta: "Administración del sistema", descripcion: "Gestiona usuarios, roles, estructura y parámetros del sistema." },
  LECTOR: { etiqueta: "Consulta", descripcion: "Consulta información y reportes, sin modificar datos." },
};

/**
 * Roles que comparten el perfil «Analista» de la bandeja pero hacen otro trabajo
 * (recorrido MP-02, D02-11: Recepción se presentaba como «Realiza los ensayos…»).
 */
const PERFIL_POR_ROL: Record<string, { etiqueta: string; descripcion: string }> = {
  RECEPCION: { etiqueta: "Recepción de muestras", descripcion: "Recibe las muestras de sus laboratorios, registra su condición y asigna el Nº interno." },
  INSPECTOR: { etiqueta: "Inspección", descripcion: "Programa la inspección, registra los lotes y captura los resultados de la inspección." },
  METROLOGO: { etiqueta: "Metrología", descripcion: "Calibra los instrumentos y registra las mediciones de sus órdenes de trabajo." },
};

const INFO_MUESTREO = {
  etiqueta: "Sección Muestreo",
  descripcion: "Toma las muestras en terreno, completa el formulario de muestreo (NCh 43/44) y las entrega al laboratorio.",
};

/** Rol de la Sección Muestreo sin el de Comercial (B-070). */
export function esSoloMuestreo(roles: string[] = []): boolean {
  const rs = roles.map((r) => String(r).toUpperCase());
  return rs.includes("MUESTREO") && !rs.includes("COMERCIAL");
}

/** Etiqueta y descripción del perfil, afinada por el rol cuando el perfil es genérico. */
export function infoPerfil(perfil: Perfil | string, roles: string[] = []): { etiqueta: string; descripcion: string } {
  const base = PERFIL_INFO[perfil as Perfil] ?? { etiqueta: String(perfil), descripcion: "" };
  // B-070: la Sección Muestreo cae en el perfil COMERCIAL (alcance global) pero no es Comercial.
  if (perfil === "COMERCIAL" && esSoloMuestreo(roles)) return INFO_MUESTREO;
  if (perfil !== "ANALISTA") return base;
  const rs = roles.map((r) => String(r).toUpperCase());
  if (rs.includes("ANALISTA")) return base;
  const propio = Object.keys(PERFIL_POR_ROL).find((r) => rs.includes(r));
  return propio ? PERFIL_POR_ROL[propio] : base;
}

export interface Acceso {
  /** true cuando ya se leyó el token (en el cliente, tras montar). */
  listo: boolean;
  usuario: { id?: string; username?: string; nombre?: string };
  roles: string[];
  permisos: Set<string>;
  /** SUPERADMIN o ADMIN: ve todo en la UI. */
  admin: boolean;
  /** ids de unidad (laboratorio) a los que está acotado; vacío + unidadGlobal = todo. */
  unidades: string[];
  unidadGlobal: boolean;
}

const VACIO: Acceso = {
  listo: false,
  usuario: {},
  roles: [],
  permisos: new Set(),
  admin: false,
  unidades: [],
  unidadGlobal: false,
};

/** Decodifica el payload de un JWT (base64url) sin validar firma (eso lo hace el backend). */
function payloadJwt(tok: string): any | null {
  try {
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    // atob devuelve bytes latin1: se re-decodifica como UTF-8 para tildes/ñ.
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Lee el acceso del JWT guardado en localStorage (claims roles/permisos/unidades). */
export function leerAcceso(): Acceso {
  if (typeof window === "undefined") return VACIO;
  let tok: string | null = null;
  try { tok = localStorage.getItem("lims_token"); } catch { tok = null; }
  if (!tok) return { ...VACIO, listo: true };
  const p = payloadJwt(tok);
  if (!p) return { ...VACIO, listo: true };
  let user: any = null;
  try { user = JSON.parse(localStorage.getItem("lims_user") ?? "null"); } catch { user = null; }
  const roles: string[] = Array.isArray(p.roles) ? p.roles : [];
  return {
    listo: true,
    usuario: {
      id: p.sub,
      username: p.username,
      nombre: user?.nombreCompleto ?? user?.nombre ?? p.username,
    },
    roles,
    permisos: new Set<string>(Array.isArray(p.permisos) ? p.permisos : []),
    admin: roles.includes("SUPERADMIN") || roles.includes("ADMIN"),
    unidades: Array.isArray(p.unidades) ? p.unidades : [],
    unidadGlobal: p.unidadGlobal !== false,
  };
}

/** ¿El acceso cubre el permiso? Con array, basta con UNO (cualquiera de la lista). Sin permiso → true. */
export function tienePermiso(acceso: Acceso, perm?: string | string[] | null): boolean {
  if (!perm || (Array.isArray(perm) && perm.length === 0)) return true;
  if (acceso.admin) return true;
  const lista = Array.isArray(perm) ? perm : [perm];
  return lista.some((p) => acceso.permisos.has(p));
}

/**
 * Perfil funcional deducido de los códigos de rol del JWT. Se usa como
 * respaldo mientras GET /me/alcance no esté disponible (o si falla).
 */
export function perfilDesdeRoles(roles: string[]): Perfil {
  const r = new Set(roles.map((x) => x.toUpperCase()));
  // Si el backend ya usa los códigos de perfil como códigos de rol, se respetan.
  for (const p of PERFILES) if (r.has(p) && p !== "ADMIN") return p;
  if (r.has("SUPERADMIN") || r.has("ADMIN")) return "ADMIN";
  if (r.has("DIRECTOR")) return "DIRECTOR";
  if (r.has("JEFE_LAB")) return "JEFE_LAB";
  if (r.has("ANALISTA_SR") || r.has("TECNICO")) return "ANALISTA";
  if (r.has("CALIDAD")) return "CALIDAD";
  if (r.has("COBRANZA")) return "FINANZAS";
  if (r.has("RECEPCION")) return "COMERCIAL";
  return "LECTOR";
}

/** Hook: acceso del usuario + helper `puede`. Se refresca si cambia el token en otra pestaña. */
export function usePermisos() {
  const [acceso, setAcceso] = useState<Acceso>(VACIO);

  useEffect(() => {
    setAcceso(leerAcceso());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "lims_token" || e.key === "lims_user") setAcceso(leerAcceso());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    ...acceso,
    puede: (perm?: string | string[] | null) => tienePermiso(acceso, perm),
    perfilJwt: perfilDesdeRoles(acceso.roles),
  };
}
