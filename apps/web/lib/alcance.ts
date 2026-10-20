/**
 * alcance.ts · «quién soy y qué veo» + «qué tengo pendiente».
 *
 *   GET /me/alcance → perfil funcional, roles y unidades visibles.
 *   GET /me/bandeja → tarjetas de trabajo pendiente con su cantidad y severidad.
 *
 * Si el backend aún no expone esos endpoints (404) o fallan, se degrada SIN
 * romper: el perfil se deduce de los roles del JWT y la bandeja queda vacía con
 * `fuente: "jwt"`, para que la pantalla muestre accesos rápidos genéricos.
 *
 * El resultado se cachea en memoria durante la sesión de la pestaña (se pide
 * una sola vez aunque lo usen el menú lateral y la bandeja a la vez).
 */

import { useEffect, useState } from "react";
import { leerAcceso, perfilDesdeRoles, type Perfil } from "./permisos";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export interface UnidadVisible { id: string; codigo: string; nombre: string; tipo: string }
export interface RolAlcance { codigo: string; nombre: string; nivel?: string; unidad?: any }

export interface Alcance {
  usuario: { id?: string; nombre?: string; username?: string };
  roles: RolAlcance[];
  perfil: Perfil;
  esGlobal: boolean;
  unidadesVisibles: UnidadVisible[];
  /** Ramas del organigrama en las que el usuario puede entrar (módulos por ámbito). */
  ambitos?: Record<string, boolean>;
  /** Permisos que valen dentro de cada rama (alcance por asignación). */
  permisosPorAmbito?: Record<string, string[]>;
}

export type Severidad = "info" | "warn" | "alta";
export interface ItemBandeja {
  clave: string;
  titulo: string;
  descripcion?: string;
  cantidad: number;
  ruta?: string;
  severidad: Severidad;
}

export interface EstadoAlcance {
  cargando: boolean;
  alcance: Alcance | null;
  bandeja: ItemBandeja[];
  /** "api" si vino de /me/*; "jwt" si se dedujo del token (backend no disponible). */
  fuente: "api" | "jwt";
  /** la bandeja (no el alcance) no está disponible. */
  bandejaDisponible: boolean;
}

async function getJson(path: string): Promise<any | null> {
  let tok: string | null = null;
  try { tok = localStorage.getItem("lims_token"); } catch { tok = null; }
  try {
    const r = await fetch(`${API}${path}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Alcance deducido del JWT (respaldo). */
function alcanceDesdeJwt(): Alcance {
  const a = leerAcceso();
  return {
    usuario: { id: a.usuario.id, nombre: a.usuario.nombre, username: a.usuario.username },
    roles: a.roles.map((codigo) => ({ codigo, nombre: codigo })),
    perfil: perfilDesdeRoles(a.roles),
    esGlobal: a.unidadGlobal,
    unidadesVisibles: [],
  };
}

function normalizarAlcance(raw: any): Alcance | null {
  if (!raw || typeof raw !== "object") return null;
  const base = alcanceDesdeJwt();
  return {
    usuario: {
      id: raw.usuario?.id ?? base.usuario.id,
      nombre: raw.usuario?.nombre ?? raw.usuario?.nombreCompleto ?? base.usuario.nombre,
      username: raw.usuario?.username ?? base.usuario.username,
    },
    roles: Array.isArray(raw.roles) ? raw.roles : base.roles,
    perfil: (typeof raw.perfil === "string" ? raw.perfil : base.perfil) as Perfil,
    esGlobal: typeof raw.esGlobal === "boolean" ? raw.esGlobal : base.esGlobal,
    unidadesVisibles: Array.isArray(raw.unidadesVisibles) ? raw.unidadesVisibles : [],
    ambitos: raw.ambitos && typeof raw.ambitos === "object" ? raw.ambitos : undefined,
    permisosPorAmbito:
      raw.permisosPorAmbito && typeof raw.permisosPorAmbito === "object" ? raw.permisosPorAmbito : undefined,
  };
}

function normalizarBandeja(raw: any): ItemBandeja[] | null {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : null;
  if (!arr) return null;
  return arr
    .filter((x: any) => x && typeof x === "object")
    .map((x: any) => ({
      clave: String(x.clave ?? x.titulo ?? Math.random()),
      titulo: String(x.titulo ?? "Pendiente"),
      descripcion: x.descripcion ?? undefined,
      cantidad: Number(x.cantidad ?? 0) || 0,
      ruta: typeof x.ruta === "string" ? x.ruta : undefined,
      severidad: (["info", "warn", "alta"].includes(x.severidad) ? x.severidad : "info") as Severidad,
    }));
}

let cache: { token: string | null; promesa: Promise<Omit<EstadoAlcance, "cargando">> } | null = null;

function tokenActual(): string | null {
  try { return localStorage.getItem("lims_token"); } catch { return null; }
}

/** Pide alcance + bandeja (una vez por token) con respaldo al JWT. */
export function cargarAlcance(forzar = false): Promise<Omit<EstadoAlcance, "cargando">> {
  const tok = tokenActual();
  if (!forzar && cache && cache.token === tok) return cache.promesa;
  const promesa = (async () => {
    const [rawA, rawB] = await Promise.all([getJson("/me/alcance"), getJson("/me/bandeja")]);
    const alcance = normalizarAlcance(rawA);
    const bandeja = normalizarBandeja(rawB);
    return {
      alcance: alcance ?? alcanceDesdeJwt(),
      bandeja: bandeja ?? [],
      fuente: alcance ? ("api" as const) : ("jwt" as const),
      bandejaDisponible: bandeja !== null,
    };
  })();
  cache = { token: tok, promesa };
  return promesa;
}

export function useAlcance(): EstadoAlcance & { recargar: () => void } {
  const [estado, setEstado] = useState<EstadoAlcance>({
    cargando: true, alcance: null, bandeja: [], fuente: "jwt", bandejaDisponible: false,
  });
  const [n, setN] = useState(0);

  useEffect(() => {
    let vivo = true;
    cargarAlcance(n > 0).then((r) => { if (vivo) setEstado({ ...r, cargando: false }); });
    return () => { vivo = false; };
  }, [n]);

  return { ...estado, recargar: () => setN((x) => x + 1) };
}

/** Une una lista en español: «A», «A y B», «A, B y C». */
export function unirY(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** Describe el alcance en palabras: «Ves todo el instituto», «Ves LCC y LTX», «Ves todo el Depto. Químico». */
export function describirAlcance(a: Alcance | null): string {
  if (!a) return "";
  if (a.esGlobal) return "Ves la información de todo el instituto.";
  const u = a.unidadesVisibles ?? [];
  if (u.length === 0) return "Ves la información de tu unidad.";
  const esTipo = (x: UnidadVisible, ...tipos: string[]) => tipos.some((t) => (x.tipo ?? "").toUpperCase().startsWith(t));
  const deptos = u.filter((x) => esTipo(x, "DEPART", "DEPTO", "SUBDIREC"));
  const secciones = u.filter((x) => esTipo(x, "SECC"));
  const labs = u.filter((x) => !deptos.includes(x) && !secciones.includes(x));
  const partes: string[] = [];
  for (const d of deptos) partes.push(`todo el ${abreviarDepto(d.nombre)}`);
  for (const s of secciones) partes.push(`toda la ${s.nombre}`);
  if (labs.length) {
    // Si hay departamentos, los laboratorios suelen ser sus hijos: no repetir la lista larga.
    if (deptos.length === 0 || labs.length <= 4) partes.push(unirY(labs.map((l) => l.codigo || l.nombre)));
  }
  return `Ves ${unirY(partes)}.`;
}

function abreviarDepto(nombre: string): string {
  return nombre.replace(/^Departamento\s+(de\s+)?/i, "Depto. ").trim();
}
