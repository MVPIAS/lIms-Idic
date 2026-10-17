/**
 * Resolver PURO de la matriz de firmas (sin Prisma). Dado un tipo de documento
 * y la unidad que lo emite:
 *   1. Elige el juego de reglas: el override de la unidad más cercana subiendo
 *      por padre_id (la propia unidad, su sección, su depto, ...); si ninguna
 *      unidad de la cadena tiene reglas propias, las reglas por defecto
 *      (unidad_id NULL).
 *   2. Para cada paso resuelve la unidad concreta según nivel_unidad
 *      (MISMA, SECCION/DEPARTAMENTO = ancestro de ese tipo, DIRECCION = DIR,
 *      CALIDAD = DGC, COMERCIAL = DCO, FIJA = unidad_destino_id).
 *   3. Busca a las personas que tienen ese rol allí: unidad_jefe
 *      (titular/subrogante) para roles de jefatura/dirección y usuario_rol
 *      vigente en esa unidad (o sin unidad si el rol es GLOBAL).
 */
import { Arbol, NodoUnidad, ancestroDeTipo, cadenaAncestros, esVigente } from "./alcance";
import { UNIDADES_REFERENCIA, codigoCanonico } from "./rbac.constants";

export interface RolFirma {
  id: string;
  codigo: string;
  nombre: string;
  nivel?: string | null;
  alcance?: string | null;
  aliasDe?: string | null;
}

export interface ReglaFirma {
  id: string;
  tipoDocumento: string;
  unidadId: string | null;
  orden: number;
  accion: string;
  rolId: string;
  nivelUnidad: string;
  unidadDestinoId: string | null;
  obligatorio: boolean;
  activo: boolean;
  descripcion?: string | null;
  rol: RolFirma;
}

export interface JefeUnidad {
  unidadId: string;
  usuarioId: string;
  nombre: string;
  rol: string; // titular | subrogante
}

export interface TenenciaRol {
  usuarioId: string;
  nombre: string;
  rolCodigo: string;
  aliasDe?: string | null;
  unidadId: string | null;
  vigenteDesde?: Date | string | null;
  vigenteHasta?: Date | string | null;
}

export interface Responsable {
  usuarioId: string;
  nombre: string;
  via: "titular" | "subrogante" | "asignacion";
}

export interface UnidadRef {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string | null;
}

export interface PasoResuelto {
  id: string;
  orden: number;
  accion: string;
  obligatorio: boolean;
  descripcion: string | null;
  nivelUnidad: string;
  rol: { id: string; codigo: string; nombre: string };
  unidad: UnidadRef | null;
  responsables: Responsable[];
  advertencia: string | null;
}

export interface ResolucionFirmas {
  tipoDocumento: string;
  unidad: UnidadRef | null;
  /** UNIDAD = override de una unidad de la cadena; DEFECTO = reglas generales; SIN_REGLAS = nada configurado. */
  origen: "UNIDAD" | "DEFECTO" | "SIN_REGLAS";
  unidadRegla: UnidadRef | null;
  pasos: PasoResuelto[];
  /** Pasos de la matriz que no aplican a este documento (p. ej. oficialización en una OT interna). */
  omitidos?: (PasoResuelto & { motivo: string })[];
}

/* ========================================================================== */
/* OT interna: sin oficialización                                             */
/* ========================================================================== */

/**
 * ¿La OT es interna? (`orden_trabajo.origen_trabajo` = OT_INTERNA; se aceptan
 * también los textos heredados «OT interna».) La interlaboratorio NO cuenta:
 * es otro origen y conserva su circuito completo.
 */
export function esOtInterna(origenTrabajo: string | null | undefined): boolean {
  const s = String(origenTrabajo ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return s === "OT_INTERNA";
}

/** Acciones de la matriz que no aplican en una OT interna. */
export const ACCIONES_SIN_OT_INTERNA = ["OFICIALIZA"] as const;

export const MOTIVO_OT_INTERNA =
  "OT interna: la oficialización (aprobación administrativa y liberación del Jefe de Departamento) no aplica.";

/**
 * Regla del IDIC (circuito de aprobación del informe, paso 4 «Jefe DQO ·
 * Aprobación administrativa y liberación · No aplica si es OT interna»): en una
 * OT interna se quitan los pasos OFICIALIZA de la resolución y se devuelven en
 * `omitidos` con el motivo. El resto del circuito no cambia.
 */
export function aplicarOtInterna(res: ResolucionFirmas): ResolucionFirmas {
  const quitar = (p: PasoResuelto) => (ACCIONES_SIN_OT_INTERNA as readonly string[]).includes(p.accion);
  return {
    ...res,
    pasos: res.pasos.filter((p) => !quitar(p)),
    omitidos: [...(res.omitidos ?? []), ...res.pasos.filter(quitar).map((p) => ({ ...p, motivo: MOTIVO_OT_INTERNA }))],
  };
}

const ref = (n: NodoUnidad | null | undefined): UnidadRef | null =>
  n ? { id: n.id, codigo: n.codigo, nombre: n.nombre, tipo: n.tipo ?? null } : null;

export function elegirReglas(
  reglas: ReglaFirma[],
  arbol: Arbol,
  tipoDocumento: string,
  unidadId: string | null,
): { origen: ResolucionFirmas["origen"]; unidadRegla: NodoUnidad | null; reglas: ReglaFirma[] } {
  const delTipo = reglas.filter((r) => r.tipoDocumento === tipoDocumento && r.activo);
  const ordenar = (l: ReglaFirma[]) => [...l].sort((a, b) => a.orden - b.orden);
  if (unidadId) {
    for (const n of cadenaAncestros(arbol, unidadId)) {
      const propias = delTipo.filter((r) => r.unidadId === n.id);
      if (propias.length) return { origen: "UNIDAD", unidadRegla: n, reglas: ordenar(propias) };
    }
  }
  const def = delTipo.filter((r) => !r.unidadId);
  if (def.length) return { origen: "DEFECTO", unidadRegla: null, reglas: ordenar(def) };
  return { origen: "SIN_REGLAS", unidadRegla: null, reglas: [] };
}

export function unidadParaNivel(
  arbol: Arbol,
  unidadId: string | null,
  nivelUnidad: string,
  unidadDestinoId: string | null,
): NodoUnidad | null {
  switch (nivelUnidad) {
    case "FIJA":
      return unidadDestinoId ? arbol.porId.get(unidadDestinoId) ?? null : null;
    case "MISMA":
      return unidadId ? arbol.porId.get(unidadId) ?? null : null;
    case "SECCION":
    case "DEPARTAMENTO":
      return unidadId ? ancestroDeTipo(arbol, unidadId, nivelUnidad) : null;
    case "DIRECCION":
      return (
        (unidadId ? ancestroDeTipo(arbol, unidadId, "DIRECCION") : null) ??
        arbol.porCodigo.get(UNIDADES_REFERENCIA.direccion) ??
        null
      );
    case "CALIDAD":
      return arbol.porCodigo.get(UNIDADES_REFERENCIA.calidad) ?? null;
    case "COMERCIAL":
      return arbol.porCodigo.get(UNIDADES_REFERENCIA.comercial) ?? null;
    default:
      return null;
  }
}

export function responsablesDe(
  rol: RolFirma,
  unidad: NodoUnidad,
  jefes: JefeUnidad[],
  tenencias: TenenciaRol[],
  ahora: Date = new Date(),
): Responsable[] {
  const out: Responsable[] = [];
  const vistos = new Set<string>();
  const add = (r: Responsable) => {
    if (vistos.has(r.usuarioId)) return;
    vistos.add(r.usuarioId);
    out.push(r);
  };
  const canon = codigoCanonico(rol.codigo, rol.aliasDe);
  const esJefatura = rol.nivel === "JEFATURA" || rol.nivel === "DIRECCION" || canon.startsWith("JEFE_");
  if (esJefatura) {
    const delaUnidad = jefes.filter((j) => j.unidadId === unidad.id);
    // titular primero, luego subrogante
    for (const j of delaUnidad.filter((x) => x.rol === "titular"))
      add({ usuarioId: j.usuarioId, nombre: j.nombre, via: "titular" });
    for (const j of delaUnidad.filter((x) => x.rol !== "titular"))
      add({ usuarioId: j.usuarioId, nombre: j.nombre, via: "subrogante" });
  }
  const esGlobal = (rol.alcance ?? "").toUpperCase() === "GLOBAL";
  for (const t of tenencias) {
    if (codigoCanonico(t.rolCodigo, t.aliasDe) !== canon) continue;
    if (!esVigente(t, ahora)) continue;
    if (t.unidadId === unidad.id || (esGlobal && !t.unidadId)) {
      add({ usuarioId: t.usuarioId, nombre: t.nombre, via: "asignacion" });
    }
  }
  return out;
}

export function resolverFirmas(p: {
  tipoDocumento: string;
  unidadId: string | null;
  reglas: ReglaFirma[];
  arbol: Arbol;
  jefes: JefeUnidad[];
  tenencias: TenenciaRol[];
  ahora?: Date;
  /** OT interna: sin pasos de oficialización (aplicarOtInterna). */
  otInterna?: boolean;
}): ResolucionFirmas {
  const ahora = p.ahora ?? new Date();
  const unidad = p.unidadId ? p.arbol.porId.get(p.unidadId) ?? null : null;
  const elegidas = elegirReglas(p.reglas, p.arbol, p.tipoDocumento, unidad?.id ?? null);
  const pasos: PasoResuelto[] = elegidas.reglas.map((r) => {
    const destino = unidadParaNivel(p.arbol, unidad?.id ?? null, r.nivelUnidad, r.unidadDestinoId);
    let advertencia: string | null = null;
    let responsables: Responsable[] = [];
    if (!destino) {
      advertencia = `No se encontró una unidad de nivel ${r.nivelUnidad} para ${unidad?.codigo ?? "(sin unidad)"}`;
    } else {
      responsables = responsablesDe(r.rol, destino, p.jefes, p.tenencias, ahora);
      if (!responsables.length) {
        advertencia = `Nadie tiene el rol ${r.rol.codigo} en ${destino.codigo}`;
      }
    }
    return {
      id: r.id,
      orden: r.orden,
      accion: r.accion,
      obligatorio: r.obligatorio,
      descripcion: r.descripcion ?? null,
      nivelUnidad: r.nivelUnidad,
      rol: { id: r.rol.id, codigo: r.rol.codigo, nombre: r.rol.nombre },
      unidad: ref(destino),
      responsables,
      advertencia,
    };
  });
  const res: ResolucionFirmas = {
    tipoDocumento: p.tipoDocumento,
    unidad: ref(unidad),
    origen: elegidas.origen,
    unidadRegla: ref(elegidas.unidadRegla),
    pasos,
  };
  return p.otInterna ? aplicarOtInterna(res) : res;
}
