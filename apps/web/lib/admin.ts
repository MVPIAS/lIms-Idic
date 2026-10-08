/**
 * Cliente tipado del área de ADMINISTRACIÓN (estructura, usuarios, roles,
 * permisos y matriz de firmas) + catálogos de etiquetas y helpers de texto.
 *
 * - Misma base y token que lib/api.ts (NEXT_PUBLIC_API_URL, `lims_token`, 401 → /login).
 * - Tolera listas envueltas en `{ data: [...] }` (convención de otras rutas del API).
 * - Un 404 de "ruta inexistente" (backend aún no desplegado) se marca como
 *   `noDisponible` para que las pantallas muestren «Servicio no disponible aún».
 * - Modo ejemplo (solo para revisión sin backend): NEXT_PUBLIC_ADMIN_MOCK=1, o en
 *   desarrollo `localStorage.lims_admin_mock = "1"`. Usa datos ficticios en memoria.
 */
import { errorMensajeDe } from "./apiError";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
export const MOCK_ENV = process.env.NEXT_PUBLIC_ADMIN_MOCK === "1";
export const ES_DEV = process.env.NODE_ENV !== "production";
const MOCK_KEY = "lims_admin_mock";

// ───────────────────────────── Tipos del contrato ─────────────────────────────

export type TipoUnidad = "DIRECCION" | "DEPARTAMENTO" | "SECCION" | "LABORATORIO" | "SUCURSAL" | "DELEGACION" | "APOYO";
export type NivelRol = "OPERATIVO" | "JEFATURA" | "DIRECCION" | "SOPORTE" | "SISTEMA";
export type AlcanceRol = "UNIDAD" | "DESCENDENCIA" | "GLOBAL";
export type TipoDocumento =
  | "INFORME_ENSAYO" | "IVC" | "INFORME_TECNICO" | "CERTIFICADO_CALIBRACION" | "INFORME_INSPECCION"
  | "CERTIFICADO_CONFORMIDAD" | "INFORME_INCUMPLIMIENTO" | "COTIZACION" | "OT_DISPOSICION"
  | "SOLICITUD_ADQUISICION" | "OFICIO";
export type AccionFirma = "REVISA" | "APRUEBA" | "FIRMA" | "OFICIALIZA" | "VB";
export type NivelUnidad = "MISMA" | "SECCION" | "DEPARTAMENTO" | "DIRECCION" | "CALIDAD" | "COMERCIAL";

export interface Unidad {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoUnidad;
  padreId: string | null;
  sigla?: string | null;
  icono?: string | null;
  color?: string | null;
  codsucdel?: string | null;
  centroCosto?: string | null;
  activo: boolean;
}
export interface JefeUnidad { usuarioId: string; nombre: string; rol: "titular" | "subrogante" }
export interface NodoUnidad extends Unidad { jefes: JefeUnidad[]; hijos: NodoUnidad[]; nUsuarios?: number }

export interface RolRef { id: string; codigo: string; nombre: string; nivel: NivelRol }
export interface UnidadRef { id: string; codigo: string; nombre: string; tipo: TipoUnidad }
export interface Asignacion {
  id: string;
  rol: RolRef;
  unidad: UnidadRef | null;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}
export interface Usuario {
  id: string;
  username: string;
  nombre: string;
  email?: string | null;
  cargo?: string | null;
  activo: boolean;
  asignaciones: Asignacion[];
}
export interface Rol {
  id: string;
  codigo: string;
  nombre: string;
  nivel: NivelRol;
  alcance: AlcanceRol;
  descripcion?: string | null;
  esSistema?: boolean;
  nPermisos?: number;
  nUsuarios?: number;
}
export interface PermisoItem { id: string; codigo: string; accion: string; descripcion?: string | null }
export interface MatrizPermisos {
  modulos: { modulo: string; permisos: PermisoItem[] }[];
  roles: RolRef[];
  asignaciones: Record<string, string[]>;
}
export interface ReglaFirma {
  id: string;
  tipoDocumento: TipoDocumento;
  unidadId: string | null;
  unidad?: UnidadRef | null;
  orden: number;
  accion: AccionFirma;
  rolId: string;
  rol: { codigo: string; nombre: string };
  nivelUnidad: NivelUnidad;
  obligatorio: boolean;
  activo: boolean;
}
export interface PasoResuelto {
  orden: number;
  accion: AccionFirma;
  rol: { codigo: string; nombre: string };
  nivelUnidad: NivelUnidad;
  unidad: { codigo: string; nombre: string } | null;
  personas: { usuarioId: string; nombre: string; rol?: "titular" | "subrogante" }[];
  origen: "defecto" | "override";
}
export interface MiAlcance {
  usuario: any;
  roles: any[];
  perfil?: any;
  esGlobal: boolean;
  unidadesVisibles: string[];
}

// ───────────────────────────── Transporte ─────────────────────────────

export class AdminApiError extends Error {
  status: number;
  noDisponible: boolean;
  constructor(message: string, status: number, noDisponible = false) {
    super(message);
    this.status = status;
    this.noDisponible = noDisponible;
  }
}

export function esNoDisponible(e: unknown): boolean {
  return e instanceof AdminApiError && e.noDisponible;
}
export function mensajeError(e: unknown): string {
  if (e instanceof AdminApiError && e.noDisponible) {
    return "Servicio no disponible aún: el backend de Administración todavía no está desplegado.";
  }
  return e instanceof Error ? e.message : String(e);
}

/** ¿Está activo el modo de datos de ejemplo? */
export function mockActivo(): boolean {
  if (MOCK_ENV) return true;
  if (!ES_DEV || typeof window === "undefined") return false;
  try { return localStorage.getItem(MOCK_KEY) === "1"; } catch { return false; }
}
/** Activa/desactiva el modo ejemplo local (solo desarrollo) y recarga. */
export function setMockLocal(on: boolean) {
  if (typeof window === "undefined") return;
  try { on ? localStorage.setItem(MOCK_KEY, "1") : localStorage.removeItem(MOCK_KEY); } catch { /* sin storage */ }
  window.location.reload();
}

function token(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem("lims_token"); } catch { return null; }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (mockActivo()) {
    // carga diferida: los datos de ejemplo no entran al bundle principal
    const { mockRequest } = await import("./adminMock");
    try {
      return (await mockRequest(method, path, body)) as T;
    } catch (e: any) {
      throw new AdminApiError(e?.message ?? "Error", e?.status ?? 500, false);
    }
  }
  let res: Response;
  try {
    const t = token();
    res = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError("No se pudo conectar con el servidor. Revisa tu conexión.", 0);
  }
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const raw = typeof data?.message === "string" ? data.message : "";
    // 404 de ruta inexistente (Nest: "Cannot GET /…", o respuesta no-JSON del proxy)
    const noDisp = res.status === 404 && (!raw || /^Cannot (GET|POST|PUT|PATCH|DELETE)\b/i.test(raw));
    throw new AdminApiError(errorMensajeDe(data, res.status), res.status, noDisp);
  }
  if (res.status === 204) return undefined as T;
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : undefined) as T;
}

/** Acepta `[...]` o `{ data: [...] }`. */
/**
 * El backend responde el resolver como {tipoDocumento, unidad, origen, unidadRegla, pasos:[{…, responsables:[{usuarioId,nombre,via}]}]};
 * la pantalla trabaja con una lista plana de pasos con `personas`. Acepta también la forma plana (datos de ejemplo).
 */
function adaptarResolver(x: any): PasoResuelto[] {
  if (Array.isArray(x)) return x as PasoResuelto[];
  const origen: PasoResuelto["origen"] = String(x?.origen ?? "").toUpperCase() === "DEFECTO" ? "defecto" : "override";
  return (x?.pasos ?? []).map((p: any) => ({
    orden: p.orden,
    accion: p.accion,
    rol: { codigo: p.rol?.codigo ?? "", nombre: p.rol?.nombre ?? "" },
    nivelUnidad: p.nivelUnidad,
    unidad: p.unidad ? { codigo: p.unidad.codigo, nombre: p.unidad.nombre } : null,
    personas: (p.responsables ?? p.personas ?? []).map((r: any) => ({
      usuarioId: r.usuarioId,
      nombre: r.nombre,
      rol: r.via === "titular" || r.via === "subrogante" ? r.via : r.rol,
    })),
    origen,
  }));
}
function lista<T>(x: any): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && Array.isArray(x.data)) return x.data as T[];
  return [];
}
function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b: unknown) => request<T>("POST", p, b);
const patch = <T,>(p: string, b: unknown) => request<T>("PATCH", p, b);
const put = <T,>(p: string, b: unknown) => request<T>("PUT", p, b);
const del = <T,>(p: string) => request<T>("DELETE", p);

export type UnidadInput = Partial<Omit<Unidad, "id">>;
export type UsuarioInput = Partial<Pick<Usuario, "username" | "nombre" | "email" | "cargo" | "activo">>;
export type RolInput = Partial<Pick<Rol, "codigo" | "nombre" | "nivel" | "alcance" | "descripcion">>;
export type ReglaInput = Partial<Pick<ReglaFirma, "tipoDocumento" | "unidadId" | "orden" | "accion" | "rolId" | "nivelUnidad" | "obligatorio" | "activo">>;

export const adminApi = {
  // Estructura
  unidades: () => get<any>("/unidades").then((x) => lista<Unidad>(x)),
  arbol: () => get<any>("/unidades/arbol").then((x) => lista<NodoUnidad>(x)),
  crearUnidad: (d: UnidadInput) => post<Unidad>("/unidades", d),
  actualizarUnidad: (id: string, d: UnidadInput) => patch<Unidad>(`/unidades/${id}`, d),
  desactivarUnidad: (id: string) => del<void>(`/unidades/${id}`),
  setJefes: (id: string, d: { titularId?: string | null; subroganteId?: string | null }) => put<void>(`/unidades/${id}/jefes`, d),

  // Usuarios
  usuarios: (f: { q?: string; unidadId?: string; rolId?: string; activo?: boolean } = {}) =>
    get<any>(`/usuarios${qs(f)}`).then((x) => lista<Usuario>(x)),
  usuario: (id: string) => get<Usuario>(`/usuarios/${id}`),
  crearUsuario: (d: UsuarioInput) => post<Usuario & { passwordTemporal?: string }>("/usuarios", d),
  actualizarUsuario: (id: string, d: UsuarioInput) => patch<Usuario>(`/usuarios/${id}`, d),
  desactivarUsuario: (id: string) => del<void>(`/usuarios/${id}`),
  agregarAsignacion: (id: string, d: { rolId: string; unidadId: string | null; vigenteDesde?: string | null; vigenteHasta?: string | null }) =>
    post<Asignacion>(`/usuarios/${id}/asignaciones`, d),
  quitarAsignacion: (id: string, asignacionId: string) => del<void>(`/usuarios/${id}/asignaciones/${asignacionId}`),
  resetPassword: (id: string) => post<{ passwordTemporal: string }>(`/usuarios/${id}/reset-password`, {}),

  // Roles y permisos
  roles: () => get<any>("/roles").then((x) => lista<Rol>(x)),
  crearRol: (d: RolInput) => post<Rol>("/roles", d),
  actualizarRol: (id: string, d: RolInput) => patch<Rol>(`/roles/${id}`, d),
  permisosRol: (id: string) => get<any>(`/roles/${id}/permisos`).then((x) => lista<any>(x).map((p) => (typeof p === "string" ? p : p.codigo))),
  setPermisosRol: (id: string, codigos: string[]) => put<void>(`/roles/${id}/permisos`, { codigos }),
  matriz: () => get<MatrizPermisos>("/permisos/matriz"),

  // Matriz de firmas
  firmas: (f: { tipoDocumento?: string; unidadId?: string } = {}) => get<any>(`/firmas-matriz${qs(f)}`).then((x) => lista<ReglaFirma>(x)),
  crearFirma: (d: ReglaInput) => post<ReglaFirma>("/firmas-matriz", d),
  actualizarFirma: (id: string, d: ReglaInput) => patch<ReglaFirma>(`/firmas-matriz/${id}`, d),
  eliminarFirma: (id: string) => del<void>(`/firmas-matriz/${id}`),
  resolverFirmas: (tipoDocumento: string, unidadId: string) =>
    get<any>(`/firmas-matriz/resolver${qs({ tipoDocumento, unidadId })}`).then((x) => adaptarResolver(x)),

  // Alcance propio
  miAlcance: () => get<MiAlcance>("/me/alcance"),
};

// ───────────────────────────── Acceso (JWT) ─────────────────────────────

export interface Acceso { permisos: Set<string>; admin: boolean; roles: string[] }

/** Lee permisos y roles del JWT (claims `permisos` y `roles`). Solo cliente. */
export function leerAcceso(): Acceso {
  try {
    const tok = token();
    if (!tok) return { permisos: new Set(), admin: false, roles: [] };
    const p = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const roles: string[] = (p.roles ?? []).map((r: any) => (typeof r === "string" ? r : r?.codigo)).filter(Boolean);
    return {
      permisos: new Set<string>(p.permisos ?? []),
      admin: roles.includes("SUPERADMIN") || roles.includes("ADMIN"),
      roles,
    };
  } catch {
    return { permisos: new Set(), admin: false, roles: [] };
  }
}
export function puede(acceso: Acceso, perm: string): boolean {
  return acceso.admin || acceso.permisos.has(perm) || mockActivo();
}

// ───────────────────────────── Catálogos de etiquetas ─────────────────────────────

export const TIPOS_UNIDAD: { value: TipoUnidad; label: string; plural: string; icono: string; color: string; articulo: "el" | "la" }[] = [
  { value: "DIRECCION", label: "Dirección", plural: "direcciones", icono: "🏛", color: "#12343f", articulo: "la" },
  { value: "DEPARTAMENTO", label: "Departamento", plural: "departamentos", icono: "🏢", color: "#2b65d9", articulo: "el" },
  { value: "SECCION", label: "Sección", plural: "secciones", icono: "📂", color: "#7057c8", articulo: "la" },
  { value: "LABORATORIO", label: "Laboratorio", plural: "laboratorios", icono: "🧪", color: "#008c9e", articulo: "el" },
  { value: "SUCURSAL", label: "Sucursal", plural: "sucursales", icono: "📍", color: "#b87300", articulo: "la" },
  { value: "DELEGACION", label: "Delegación", plural: "delegaciones", icono: "🚩", color: "#c43d3d", articulo: "la" },
  { value: "APOYO", label: "Unidad de apoyo", plural: "unidades de apoyo", icono: "🛠", color: "#516071", articulo: "la" },
];
export const TIPO_UNIDAD = Object.fromEntries(TIPOS_UNIDAD.map((t) => [t.value, t])) as Record<TipoUnidad, (typeof TIPOS_UNIDAD)[number]>;
export function metaTipo(tipo: string) {
  return TIPO_UNIDAD[tipo as TipoUnidad] ?? { value: tipo, label: tipo, plural: tipo, icono: "▫", color: "#516071", articulo: "la" as const };
}
/** Tipo sugerido para una unidad hija según el tipo del padre. */
export function tipoHijoSugerido(padre?: TipoUnidad | null): TipoUnidad {
  switch (padre) {
    case null: case undefined: return "DIRECCION";
    case "DIRECCION": return "DEPARTAMENTO";
    case "DEPARTAMENTO": return "SECCION";
    case "SECCION": return "LABORATORIO";
    default: return "LABORATORIO";
  }
}

export const NIVELES_ROL: { value: NivelRol; label: string; grupo: string; color: string }[] = [
  { value: "DIRECCION", label: "Dirección", grupo: "Dirección", color: "violet" },
  { value: "JEFATURA", label: "Jefatura", grupo: "Jefaturas", color: "blue" },
  { value: "OPERATIVO", label: "Operativo", grupo: "Operativos", color: "teal" },
  { value: "SOPORTE", label: "Soporte", grupo: "Soporte", color: "amber" },
  { value: "SISTEMA", label: "Sistema", grupo: "Sistema", color: "gray" },
];
export const NIVEL_ROL = Object.fromEntries(NIVELES_ROL.map((n) => [n.value, n])) as Record<NivelRol, (typeof NIVELES_ROL)[number]>;

export const ALCANCES: { value: AlcanceRol; label: string; ayuda: string }[] = [
  { value: "UNIDAD", label: "Solo su unidad", ayuda: "Ve y gestiona únicamente la unidad asignada (p. ej. un laboratorio)." },
  { value: "DESCENDENCIA", label: "Su unidad y dependientes", ayuda: "Ve la unidad asignada y todo lo que cuelga de ella (secciones, laboratorios…)." },
  { value: "GLOBAL", label: "Todo IDIC", ayuda: "Ve todo el instituto; no requiere unidad." },
];
export const ALCANCE = Object.fromEntries(ALCANCES.map((a) => [a.value, a])) as Record<AlcanceRol, (typeof ALCANCES)[number]>;

export const TIPOS_DOCUMENTO: { value: TipoDocumento; label: string; corto: string }[] = [
  { value: "INFORME_ENSAYO", label: "Informe de ensayo", corto: "Inf. ensayo" },
  { value: "IVC", label: "IVC", corto: "IVC" },
  { value: "INFORME_TECNICO", label: "Informe técnico", corto: "Inf. técnico" },
  { value: "CERTIFICADO_CALIBRACION", label: "Certificado de calibración", corto: "Cert. calibración" },
  { value: "INFORME_INSPECCION", label: "Informe de inspección", corto: "Inf. inspección" },
  { value: "CERTIFICADO_CONFORMIDAD", label: "Certificado de conformidad", corto: "Cert. conformidad" },
  { value: "INFORME_INCUMPLIMIENTO", label: "Informe de incumplimiento", corto: "Inf. incumplimiento" },
  { value: "COTIZACION", label: "Cotización", corto: "Cotización" },
  { value: "OT_DISPOSICION", label: "OT · disposición", corto: "OT disposición" },
  { value: "SOLICITUD_ADQUISICION", label: "Solicitud de adquisición", corto: "Sol. adquisición" },
  { value: "OFICIO", label: "Oficio", corto: "Oficio" },
];
export const TIPO_DOCUMENTO = Object.fromEntries(TIPOS_DOCUMENTO.map((t) => [t.value, t])) as Record<TipoDocumento, (typeof TIPOS_DOCUMENTO)[number]>;

export const ACCIONES_FIRMA: { value: AccionFirma; label: string; verbo: string; icono: string; color: string }[] = [
  { value: "REVISA", label: "Revisa", verbo: "lo revisa", icono: "🔍", color: "#2b65d9" },
  { value: "APRUEBA", label: "Aprueba", verbo: "lo aprueba", icono: "✔", color: "#1f8a5b" },
  { value: "FIRMA", label: "Firma", verbo: "lo firma", icono: "✍", color: "#12343f" },
  { value: "OFICIALIZA", label: "Oficializa", verbo: "lo oficializa", icono: "🏛", color: "#7057c8" },
  { value: "VB", label: "V°B°", verbo: "da el V°B°", icono: "☑", color: "#b87300" },
];
export const ACCION_FIRMA = Object.fromEntries(ACCIONES_FIRMA.map((a) => [a.value, a])) as Record<AccionFirma, (typeof ACCIONES_FIRMA)[number]>;

export const NIVELES_UNIDAD: { value: NivelUnidad; label: string; frase: string }[] = [
  { value: "MISMA", label: "Misma unidad", frase: "de la propia unidad" },
  { value: "SECCION", label: "Sección", frase: "de la Sección" },
  { value: "DEPARTAMENTO", label: "Departamento", frase: "del Departamento" },
  { value: "DIRECCION", label: "Dirección", frase: "de la Dirección" },
  { value: "CALIDAD", label: "Gestión de Calidad", frase: "de Gestión de Calidad" },
  { value: "COMERCIAL", label: "Comercial", frase: "del Depto. Comercial" },
];
export const NIVEL_UNIDAD = Object.fromEntries(NIVELES_UNIDAD.map((n) => [n.value, n])) as Record<NivelUnidad, (typeof NIVELES_UNIDAD)[number]>;

// ───────────────────────────── Helpers de árbol ─────────────────────────────

export function construirArbol<T extends Unidad>(planas: T[]): (T & { hijos: any[] })[] {
  const nodos = new Map<string, T & { hijos: any[] }>();
  planas.forEach((u) => nodos.set(u.id, { ...u, hijos: [] }));
  const raices: (T & { hijos: any[] })[] = [];
  nodos.forEach((n) => {
    if (n.padreId && nodos.has(n.padreId)) nodos.get(n.padreId)!.hijos.push(n);
    else raices.push(n);
  });
  const ordenar = (arr: any[]) => {
    arr.sort((a, b) => ordenTipo(a.tipo) - ordenTipo(b.tipo) || a.codigo.localeCompare(b.codigo, "es"));
    arr.forEach((h) => ordenar(h.hijos));
  };
  ordenar(raices);
  return raices;
}
function ordenTipo(t: string) {
  const i = TIPOS_UNIDAD.findIndex((x) => x.value === t);
  return i < 0 ? 99 : i;
}
/** Aplana un árbol en preorden con profundidad. */
export function aplanar<T extends { hijos: T[] }>(arbol: T[], depth = 0, out: (T & { depth: number })[] = []): (T & { depth: number })[] {
  for (const n of arbol) {
    out.push({ ...n, depth });
    aplanar(n.hijos, depth + 1, out);
  }
  return out;
}
/** Ids de todos los descendientes (sin incluir el propio). */
export function descendientes(id: string, planas: Pick<Unidad, "id" | "padreId">[]): Set<string> {
  const hijosDe = new Map<string, string[]>();
  planas.forEach((u) => { if (u.padreId) hijosDe.set(u.padreId, [...(hijosDe.get(u.padreId) ?? []), u.id]); });
  const out = new Set<string>();
  const pila = [...(hijosDe.get(id) ?? [])];
  while (pila.length) {
    const x = pila.pop()!;
    if (out.has(x)) continue;
    out.add(x);
    pila.push(...(hijosDe.get(x) ?? []));
  }
  return out;
}
/** Ruta desde la raíz hasta la unidad (incluida). */
export function ruta(id: string, porId: Map<string, Unidad>): Unidad[] {
  const out: Unidad[] = [];
  let cur = porId.get(id);
  const vistos = new Set<string>();
  while (cur && !vistos.has(cur.id)) {
    vistos.add(cur.id);
    out.unshift(cur);
    cur = cur.padreId ? porId.get(cur.padreId) : undefined;
  }
  return out;
}

/** «el Depto. Químico», «la Sección Alimentos», «LCC». */
export function nombreConArticulo(u: Pick<Unidad, "nombre" | "tipo" | "codigo">): string {
  const m = metaTipo(u.tipo);
  const nombre = u.nombre.replace(/^Departamento\b/i, "Depto.");
  return `${m.articulo} ${nombre}`;
}

/** Explica en palabras simples qué ve una asignación rol+unidad. */
export function textoAlcance(alcance: AlcanceRol | undefined, unidad: UnidadRef | Unidad | null | undefined, planas: Unidad[]): string {
  if (alcance === "GLOBAL") return "Ve todo IDIC";
  if (!unidad) return alcance ? "Falta indicar la unidad: sin ella no verá registros de laboratorio" : "Ve todo IDIC";
  const sigla = (unidad as Unidad).sigla || unidad.codigo;
  if (alcance === "UNIDAD" || !alcance) return `Ve y gestiona solo ${sigla}`;
  // DESCENDENCIA
  const desc = descendientes(unidad.id, planas);
  const tipos = new Set(planas.filter((u) => desc.has(u.id)).map((u) => u.tipo));
  const plurales = TIPOS_UNIDAD.filter((t) => tipos.has(t.value)).map((t) => t.plural);
  const base = `Ve todo ${nombreConArticulo(unidad)}`;
  if (!plurales.length) return base;
  const lista = plurales.length === 1 ? plurales[0] : `${plurales.slice(0, -1).join(", ")} y ${plurales[plurales.length - 1]}`;
  return `${base} y sus ${lista}`;
}

/** Frase de una cadena de firmas: «lo revisa X, luego lo firma Y y finalmente lo oficializa Z». */
export function fraseCadena(pasos: { accion: AccionFirma; quien: string }[]): string {
  const partes = pasos.map((p) => `${ACCION_FIRMA[p.accion]?.verbo ?? p.accion} ${p.quien}`);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  if (partes.length === 2) return `${partes[0]} y finalmente ${partes[1]}`;
  return `${partes[0]}, luego ${partes.slice(1, -1).join(", luego ")} y finalmente ${partes[partes.length - 1]}`;
}

/** Fecha local: "AAAA-MM-DD" se interpreta como día local (no UTC, que en Chile resta un día). */
function parseFecha(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export function fechaCorta(iso?: string | null): string {
  if (!iso) return "";
  const d = parseFecha(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
/** ¿La asignación está vigente hoy? */
export function vigente(a: Pick<Asignacion, "vigenteDesde" | "vigenteHasta">, hoy = new Date()): "vigente" | "futura" | "vencida" {
  const d = a.vigenteDesde ? parseFecha(a.vigenteDesde) : null;
  const h = a.vigenteHasta ? parseFecha(a.vigenteHasta) : null;
  if (d && d > hoy) return "futura";
  if (h && h < new Date(hoy.toDateString())) return "vencida";
  return "vigente";
}
