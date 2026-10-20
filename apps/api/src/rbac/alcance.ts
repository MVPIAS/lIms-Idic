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
  /**
   * Permisos que concede el rol de esta asignación. Si falta (undefined), la
   * asignación se trata como si concediera cualquier permiso: es el
   * comportamiento por usuario anterior, y solo se usa en llamadas que no
   * conocen los permisos (p. ej. el cálculo del perfil o de la bandeja).
   */
  permisos?: readonly string[] | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Alcance POR ASIGNACIÓN
//
// Cada permiso vale con el alcance del rol que lo concede. Un usuario con
// ANALISTA@LPN y COMERCIAL (global) captura resultados solo en LPN y ve las
// cotizaciones de todo el IDIC. El alcance efectivo de un permiso es la UNIÓN
// de los alcances de las asignaciones vigentes cuyo rol lo concede; el de una
// ruta que exige varios permisos, la INTERSECCIÓN de los de cada uno.
// Ver docs/ADMIN_ROLES.md › «Alcance por asignación».
// ─────────────────────────────────────────────────────────────────────────────

/** Alcance de un permiso (o de un conjunto de permisos) para un usuario. */
export interface AlcancePermiso extends ResultadoAlcance {
  /** Roles (código canónico) que dan alcance GLOBAL a este permiso. */
  rolesGlobales: string[];
  /**
   * Unidades que dan las asignaciones ACOTADAS que conceden el permiso, aunque
   * otra asignación lo vuelva global. Sirve a los ámbitos estrictos (SAEC),
   * donde el «global» de un rol transversal no basta.
   */
  unidadesPropias: string[];
}

/** Niveles de rol cuyas asignaciones se amplían con las jefaturas (unidad_jefe). */
const NIVELES_CON_JEFATURA = ["JEFATURA", "DIRECCION"];

/** Alcance de UNA asignación (se supone vigente). */
export function alcanceAsignacion(a: AsignacionAlcance, arbol: Arbol): ResultadoAlcance {
  const alcance = alcanceDe(a);
  // Asignación legada de un rol acotado SIN unidad: global, como el JWT antiguo.
  if (alcance === "GLOBAL" || !a.unidadId) return { esGlobal: true, unidadIds: [] };
  if (!arbol.porId.has(a.unidadId)) return { esGlobal: false, unidadIds: [] };
  if (alcance === "DESCENDENCIA") return { esGlobal: false, unidadIds: descendientes(arbol, a.unidadId) };
  return { esGlobal: false, unidadIds: [a.unidadId] };
}

/** ¿El rol de la asignación concede el permiso? Sin lista de permisos: sí (compatibilidad). */
export function concede(a: AsignacionAlcance, permiso: string): boolean {
  return !a.permisos || a.permisos.includes(permiso);
}

/**
 * Alcance de UN permiso: unión de los alcances de las asignaciones vigentes
 * cuyo rol lo concede. Las jefaturas (titular o subrogante) amplían el permiso
 * cuando lo concede un rol acotado de jefatura o dirección; si el usuario no
 * tiene ningún rol de ese nivel, amplían los permisos de todos sus roles
 * acotados (así se comportaba el alcance por usuario con un solo rol).
 * `superadmin` (rol SUPERADMIN en el token) vuelve global cualquier permiso.
 */
export function alcanceDePermiso(
  asignaciones: AsignacionAlcance[],
  jefaturas: JefaturaAlcance[],
  arbol: Arbol,
  permiso: string,
  ahora: Date = new Date(),
  superadmin = false,
): AlcancePermiso {
  const vigentes = asignaciones.filter((a) => esVigente(a, ahora));
  const rolesGlobales = new Set<string>();
  const propias = new Set<string>();
  if (superadmin) rolesGlobales.add("SUPERADMIN");
  const esNivelJefatura = (a: AsignacionAlcance) => NIVELES_CON_JEFATURA.includes((a.nivel ?? "").toUpperCase());
  const tieneRolJefatura = vigentes.some(esNivelJefatura);
  let ampliaConJefatura = false;
  for (const a of vigentes) {
    if (!concede(a, permiso)) continue;
    const r = alcanceAsignacion(a, arbol);
    if (r.esGlobal) {
      rolesGlobales.add(codigoCanonico(a.rolCodigo, a.aliasDe));
      continue;
    }
    r.unidadIds.forEach((i) => propias.add(i));
    if (!tieneRolJefatura || esNivelJefatura(a)) ampliaConJefatura = true;
  }
  if (ampliaConJefatura) {
    for (const j of jefaturas) descendientes(arbol, j.unidadId).forEach((i) => propias.add(i));
  }
  const esGlobal = rolesGlobales.size > 0;
  return {
    esGlobal,
    unidadIds: esGlobal ? [] : [...propias],
    rolesGlobales: [...rolesGlobales],
    unidadesPropias: [...propias],
  };
}

/** Intersección de dos alcances (ruta que exige los dos permisos). */
export function intersecarAlcances(a: AlcancePermiso, b: AlcancePermiso): AlcancePermiso {
  if (a.esGlobal && b.esGlobal) {
    return {
      esGlobal: true,
      unidadIds: [],
      rolesGlobales: a.rolesGlobales.filter((r) => b.rolesGlobales.includes(r)),
      unidadesPropias: a.unidadesPropias.filter((i) => b.unidadesPropias.includes(i)),
    };
  }
  if (a.esGlobal) return { esGlobal: false, unidadIds: b.unidadIds, rolesGlobales: [], unidadesPropias: b.unidadIds };
  if (b.esGlobal) return { esGlobal: false, unidadIds: a.unidadIds, rolesGlobales: [], unidadesPropias: a.unidadIds };
  const ids = a.unidadIds.filter((i) => b.unidadIds.includes(i));
  return { esGlobal: false, unidadIds: ids, rolesGlobales: [], unidadesPropias: ids };
}

/**
 * Alcance para una lista de permisos exigidos (todos). Lista vacía = la ruta
 * solo exige estar autenticado: vale la unión de TODAS las asignaciones (el
 * alcance por usuario de siempre).
 */
export function alcanceDePermisos(
  asignaciones: AsignacionAlcance[],
  jefaturas: JefaturaAlcance[],
  arbol: Arbol,
  permisos: readonly string[],
  ahora: Date = new Date(),
  superadmin = false,
): AlcancePermiso {
  if (permisos.length === 0) {
    const todas = asignaciones.map((a) => ({ ...a, permisos: undefined }));
    return alcanceDePermiso(todas, jefaturas, arbol, "*", ahora, superadmin);
  }
  return permisos
    .map((p) => alcanceDePermiso(asignaciones, jefaturas, arbol, p, ahora, superadmin))
    .reduce((acc, x) => intersecarAlcances(acc, x));
}

// ── Ámbitos de módulo (@AmbitoUnidad) ────────────────────────────────────────

/**
 * Rama del organigrama a la que pertenece un módulo.
 *   raiz       · código de la unidad raíz (con su descendencia).
 *   excluye    · ramas que NO forman parte del ámbito aunque cuelguen de la raíz.
 *   globalSolo · si se indica, el alcance global solo deja pasar a estos roles
 *                (ámbito estricto); el resto necesita una unidad dentro.
 */
export interface DefinicionAmbito {
  raiz: string;
  excluye?: readonly string[];
  globalSolo?: readonly string[];
}

export interface AmbitoResuelto {
  nombre: string;
  unidades: Set<string>;
  globalSolo?: readonly string[];
}

/**
 * Unidades del ámbito en este árbol; null si la raíz no existe (no se puede
 * evaluar). `extra` añade unidades sueltas (p. ej. las que tienen trabajo
 * asignado en un proceso del módulo).
 */
export function resolverAmbito(arbol: Arbol, def: DefinicionAmbito, extra: readonly string[] = []): AmbitoResuelto | null {
  const raiz = arbol.porCodigo.get(def.raiz);
  if (!raiz) return null;
  const unidades = new Set(descendientes(arbol, raiz.id, true));
  for (const ex of def.excluye ?? []) {
    const n = arbol.porCodigo.get(ex);
    if (n) descendientes(arbol, n.id, true).forEach((i) => unidades.delete(i));
  }
  for (const i of extra) if (arbol.porId.has(i)) unidades.add(i);
  return { nombre: raiz.nombre, unidades, globalSolo: def.globalSolo };
}

/** ¿Este alcance entra en el ámbito? */
export function entraEnAmbito(alc: AlcancePermiso, ambito: AmbitoResuelto): boolean {
  if (alc.esGlobal) {
    if (!ambito.globalSolo) return true;
    if (alc.rolesGlobales.some((r) => ambito.globalSolo!.includes(r))) return true;
  }
  const propias = alc.esGlobal ? alc.unidadesPropias : alc.unidadIds;
  return propias.some((i) => ambito.unidades.has(i));
}
