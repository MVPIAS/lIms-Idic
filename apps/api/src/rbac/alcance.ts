/**
 * Lógica PURA del alcance por unidad (sin Prisma): árbol organizacional,
 * descendencia, vigencia de asignaciones, unidades visibles y perfil.
 * La usan AlcanceService (con datos de BD) y el resolver de firmas; se prueba
 * en alcance.spec.ts sin base de datos.
 */
import {
  ALCANCE_POR_DEFECTO,
  Alcance,
  NIVEL_A_PERFIL,
  PERFILES,
  Perfil,
  ROLES_SIEMPRE_GLOBALES,
  ROL_A_PERFIL,
  TIPO_JEFATURA_A_PERFIL,
  TipoUnidad,
  codigoCanonico,
} from "./rbac.constants";

export interface NodoUnidad {
  id: string;
  padreId: string | null;
  codigo: string;
  nombre: string;
  tipo: string | null;
  activa?: boolean;
}

export interface Arbol {
  porId: Map<string, NodoUnidad>;
  porCodigo: Map<string, NodoUnidad>;
  hijos: Map<string, string[]>;
}

export interface AsignacionAlcance {
  rolCodigo: string;
  aliasDe?: string | null;
  /** rol.alcance de la BD; si falta se usa ALCANCE_POR_DEFECTO. */
  alcance?: string | null;
  nivel?: string | null;
  unidadId: string | null;
  vigenteDesde?: Date | string | null;
  vigenteHasta?: Date | string | null;
}

export interface JefaturaAlcance {
  unidadId: string;
  rol?: string; // titular | subrogante
}

export interface ResultadoAlcance {
  esGlobal: boolean;
  /** Unidades visibles (vacío si esGlobal: significa «todas»). */
  unidadIds: string[];
}

export function construirArbol(nodos: NodoUnidad[]): Arbol {
  const porId = new Map<string, NodoUnidad>();
  const porCodigo = new Map<string, NodoUnidad>();
  const hijos = new Map<string, string[]>();
  for (const n of nodos) {
    porId.set(n.id, n);
    porCodigo.set(n.codigo, n);
  }
  for (const n of nodos) {
    if (n.padreId && porId.has(n.padreId)) {
      const l = hijos.get(n.padreId) ?? [];
      l.push(n.id);
      hijos.set(n.padreId, l);
    }
  }
  return { porId, porCodigo, hijos };
}

/** La unidad y toda su descendencia (BFS; tolera ciclos). */
export function descendientes(arbol: Arbol, unidadId: string, incluirPropia = true): string[] {
  if (!arbol.porId.has(unidadId)) return [];
  const vistos = new Set<string>([unidadId]);
  const cola = [unidadId];
  while (cola.length) {
    const actual = cola.shift()!;
    for (const h of arbol.hijos.get(actual) ?? []) {
      if (!vistos.has(h)) {
        vistos.add(h);
        cola.push(h);
      }
    }
  }
  if (!incluirPropia) vistos.delete(unidadId);
  return [...vistos];
}

/** Cadena [unidad, padre, abuelo, ...] hasta la raíz (tolera ciclos). */
export function cadenaAncestros(arbol: Arbol, unidadId: string): NodoUnidad[] {
  const out: NodoUnidad[] = [];
  const vistos = new Set<string>();
  let actual = arbol.porId.get(unidadId);
  while (actual && !vistos.has(actual.id)) {
    out.push(actual);
    vistos.add(actual.id);
    actual = actual.padreId ? arbol.porId.get(actual.padreId) : undefined;
  }
  return out;
}

/** ¿`posibleDescendiente` está en el subárbol de `unidadId` (incluida)? */
export function esDescendiente(arbol: Arbol, unidadId: string, posibleDescendiente: string): boolean {
  return cadenaAncestros(arbol, posibleDescendiente).some((n) => n.id === unidadId);
}

function aFecha(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Vigente si desde ≤ ahora y (sin hasta o hasta > ahora). */
export function esVigente(
  a: { vigenteDesde?: Date | string | null; vigenteHasta?: Date | string | null },
  ahora: Date = new Date(),
): boolean {
  const desde = aFecha(a.vigenteDesde);
  const hasta = aFecha(a.vigenteHasta);
  if (desde && desde.getTime() > ahora.getTime()) return false;
  if (hasta && hasta.getTime() <= ahora.getTime()) return false;
  return true;
}

export function alcanceDe(a: AsignacionAlcance): Alcance {
  const canon = codigoCanonico(a.rolCodigo, a.aliasDe);
  if (ROLES_SIEMPRE_GLOBALES.includes(canon)) return "GLOBAL";
  const v = (a.alcance ?? "").toUpperCase();
  if (v === "UNIDAD" || v === "DESCENDENCIA" || v === "GLOBAL") return v;
  return ALCANCE_POR_DEFECTO[canon] ?? "UNIDAD";
}

/**
 * Unidades visibles de un usuario = unión, sobre sus asignaciones VIGENTES, de:
 *   GLOBAL        → todas (esGlobal)
 *   DESCENDENCIA  → la unidad + toda su descendencia
 *   UNIDAD        → solo la unidad
 * Una asignación de rol acotado SIN unidad (dato legado, previo a esta regla)
 * se trata como global, igual que hacía el JWT antiguo (unidad NULL = global).
 * Las jefaturas (unidad_jefe titular/subrogante) dan visibilidad de la unidad
 * y su descendencia.
 */
export function calcularAlcance(
  asignaciones: AsignacionAlcance[],
  jefaturas: JefaturaAlcance[],
  arbol: Arbol,
  ahora: Date = new Date(),
): ResultadoAlcance {
  const ids = new Set<string>();
  for (const a of asignaciones) {
    if (!esVigente(a, ahora)) continue;
    const alcance = alcanceDe(a);
    if (alcance === "GLOBAL" || !a.unidadId) return { esGlobal: true, unidadIds: [] };
    if (!arbol.porId.has(a.unidadId)) continue;
    if (alcance === "DESCENDENCIA") descendientes(arbol, a.unidadId).forEach((i) => ids.add(i));
    else ids.add(a.unidadId);
  }
  for (const j of jefaturas) {
    descendientes(arbol, j.unidadId).forEach((i) => ids.add(i));
  }
  return { esGlobal: false, unidadIds: [...ids] };
}

/** Perfil (el de mayor prioridad en PERFILES) a partir de roles vigentes y jefaturas. */
export function perfilDe(
  asignaciones: AsignacionAlcance[],
  jefaturas: JefaturaAlcance[] = [],
  arbol?: Arbol,
  ahora: Date = new Date(),
): Perfil {
  const candidatos = new Set<Perfil>();
  for (const a of asignaciones) {
    if (!esVigente(a, ahora)) continue;
    const canon = codigoCanonico(a.rolCodigo, a.aliasDe);
    const p = ROL_A_PERFIL[canon] ?? (a.nivel ? NIVEL_A_PERFIL[a.nivel] : undefined) ?? "LECTOR";
    candidatos.add(p);
  }
  if (arbol) {
    for (const j of jefaturas) {
      const tipo = arbol.porId.get(j.unidadId)?.tipo as TipoUnidad | undefined;
      const p = tipo ? TIPO_JEFATURA_A_PERFIL[tipo] : undefined;
      if (p) candidatos.add(p);
    }
  }
  for (const p of PERFILES) if (candidatos.has(p)) return p;
  return "LECTOR";
}

/** Primer ancestro (incluida la propia unidad) de un tipo dado. */
export function ancestroDeTipo(arbol: Arbol, unidadId: string, tipo: string): NodoUnidad | null {
  return cadenaAncestros(arbol, unidadId).find((n) => n.tipo === tipo) ?? null;
}
