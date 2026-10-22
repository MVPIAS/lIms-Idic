/**
 * Reglas PURAS (sin BD) de la emisión y del circuito de firma de informes y
 * certificados. Las usa `FirmaDocumentoService` / `PlantillaRenderService` y
 * se prueban en `reglas-emision.spec.ts`. Contrato: docs/FLUJO_FIRMA_CIERRE.md.
 *
 * Estados del documento (tabla `certificado`):
 *   en_firma ──(firma el último paso)──► oficial
 *   en_firma ──(devolver con motivo)───► devuelto
 *   en_firma | devuelto | oficial ──(anular con motivo)──► anulado
 *   'emitido' = documento emitido antes de existir el circuito: vale como oficial.
 * Un documento devuelto o anulado se corrige REEMITIENDO una nueva versión.
 */
import type { ResolucionFirmas } from "../rbac/firmas-resolver";

/* ========================================================================== */
/* Tipo de documento de la matriz según la plantilla                          */
/* ========================================================================== */

/**
 * La plantilla (`plantilla_informe.tipo`) usa un vocabulario propio; la matriz
 * de firmas (`flujo_firma.tipo_documento`) otro. Correspondencia por defecto;
 * quien emite puede indicar otro tipo de la matriz (p. ej. un certificado de
 * calibración de Metrología).
 */
const TIPO_POR_PLANTILLA: Record<string, string> = {
  "I.ENSAYO": "INFORME_ENSAYO",
  CERTIFICADO: "INFORME_ENSAYO",
  IVC: "IVC",
  "I.TECNICO": "INFORME_TECNICO",
  PLANILLA: "INFORME_ENSAYO",
  BOLETIN: "INFORME_ENSAYO",
  OTRO: "INFORME_ENSAYO",
};

export function tipoDocumentoDePlantilla(tipoPlantilla: string | null | undefined): string {
  return TIPO_POR_PLANTILLA[(tipoPlantilla ?? "").toUpperCase()] ?? "INFORME_ENSAYO";
}

/** Plantillas cuyo tipo de documento es propio y no depende de la unidad. */
const PLANTILLAS_TIPO_PROPIO = new Set(["IVC", "I.TECNICO"]);

/** Nombre legible de cada tipo de documento de la matriz. */
export const NOMBRE_TIPO_DOCUMENTO: Record<string, string> = {
  INFORME_ENSAYO: "Informe de ensayo",
  IVC: "Informe de verificación (IVC)",
  INFORME_TECNICO: "Informe técnico",
  CERTIFICADO_CALIBRACION: "Certificado de calibración",
  INFORME_INSPECCION: "Informe de inspección",
  CERTIFICADO_CONFORMIDAD: "Certificado de conformidad",
  INFORME_INCUMPLIMIENTO: "Informe de incumplimiento",
  CERTIFICADO_ARMA: "Certificado por arma",
  INFORME_INCUMPLIMIENTO_ARMA: "Informe de incumplimiento de armas",
  CERTIFICADO_EVIDENCIA: "Certificado de evidencia",
  INFORME_PERICIAL: "Informe técnico pericial",
  NOTA_NO_CONFORMIDAD: "Nota de no conformidad",
};
const nombreTipo = (t: string) => NOMBRE_TIPO_DOCUMENTO[t] ?? t;

export type OrigenTipoDocumento = "indicado" | "plantilla" | "unidad";

/**
 * Tipo de documento con el que se emite (y que decide quién firma):
 *   1. el que indica quien emite;
 *   2. el propio de la plantilla si es de un tipo específico (IVC, informe técnico);
 *   3. el de la unidad de la OT (`unidad.tipo_documento_defecto`, heredado por la
 *      rama: el Banco de Pruebas de Chile, sus sucursales y la Delegación Nº 11
 *      emiten «Informe de inspección»);
 *   4. el que corresponde a la plantilla (informe de ensayo).
 */
export function tipoDocumentoPorDefecto(p: {
  indicado?: string | null;
  tipoPlantilla?: string | null;
  tipoUnidad?: string | null;
}): { tipo: string; origen: OrigenTipoDocumento } {
  if (p.indicado) return { tipo: p.indicado, origen: "indicado" };
  const pl = (p.tipoPlantilla ?? "").toUpperCase();
  if (PLANTILLAS_TIPO_PROPIO.has(pl)) return { tipo: tipoDocumentoDePlantilla(pl), origen: "plantilla" };
  if (p.tipoUnidad) return { tipo: p.tipoUnidad, origen: "unidad" };
  return { tipo: tipoDocumentoDePlantilla(pl), origen: "plantilla" };
}

/* ========================================================================== */
/* Condición de emisión: resultados aprobados                                 */
/* ========================================================================== */

export interface ResultadoEmision {
  estado: string | null;
  /** Veredicto del ensayo: uno «pendiente» (sin decidir) no deja emitir (D02-03). */
  veredicto?: string | null;
  muestra?: string | null;
  analito?: string | null;
}

const NOMBRE_ESTADO: Record<string, string> = {
  capturado: "capturado (sin revisar)",
  revisado_n1: "revisado, sin aprobar",
  devuelto: "devuelto al analista",
  rechazado: "rechazado",
};

/** Las plantillas descriptivas pueden emitirse sin resultados registrados. */
const PLANTILLAS_SIN_RESULTADOS = new Set(["I.TECNICO"]);

/**
 * Qué falta para poder emitir. Lista vacía = se puede emitir.
 * Regla: todos los resultados (no borrados) de la OT deben estar `aprobado`;
 * y debe haber al menos uno, salvo en plantillas descriptivas (informe técnico).
 */
export function faltantesParaEmitir(resultados: ResultadoEmision[], tipoPlantilla?: string | null): string[] {
  if (resultados.length === 0) {
    return PLANTILLAS_SIN_RESULTADOS.has((tipoPlantilla ?? "").toUpperCase())
      ? []
      : ["La OT no tiene resultados registrados. Capture y apruebe los resultados antes de emitir."];
  }
  const pendientes = resultados.filter((r) => r.estado !== "aprobado");
  if (!pendientes.length) {
    // Aprobados pero sin veredicto (datos anteriores a la regla de revisión): no
    // sale un informe con la condición «Pendiente» (recorrido MP-02, D02-03).
    const sinVeredicto = resultados.filter((r) => r.veredicto !== undefined && (r.veredicto == null || String(r.veredicto).toLowerCase() === "pendiente"));
    if (!sinVeredicto.length) return [];
    return [
      `Hay ${sinVeredicto.length} resultado(s) sin veredicto (Pendiente): ` +
        sinVeredicto.slice(0, 8).map((r) => `${r.muestra ?? "muestra"} · ${r.analito ?? "ensayo"}`).join("; ") +
        ". Reabra el resultado y decida su veredicto (Cumple, No cumple o Informativo) antes de emitir.",
    ];
  }

  const porEstado = new Map<string, number>();
  for (const r of pendientes) {
    const e = r.estado ?? "capturado";
    porEstado.set(e, (porEstado.get(e) ?? 0) + 1);
  }
  const resumen = [...porEstado.entries()]
    .map(([e, n]) => `${n} ${NOMBRE_ESTADO[e] ?? e}`)
    .join(", ");
  const detalle = pendientes
    .slice(0, 8)
    .map((r) => `${r.muestra ?? "muestra"} · ${r.analito ?? "ensayo"}: ${NOMBRE_ESTADO[r.estado ?? "capturado"] ?? r.estado}`);
  const resto = pendientes.length > 8 ? ` (y ${pendientes.length - 8} más)` : "";
  return [
    `Faltan resultados por aprobar: ${pendientes.length} de ${resultados.length} (${resumen}).`,
    `Pendientes: ${detalle.join("; ")}${resto}.`,
  ];
}

/* ========================================================================== */
/* Pasos de firma desde la matriz                                             */
/* ========================================================================== */

export interface PasoNuevo {
  orden: number;
  accion: string;
  rolCodigo: string;
  rolNombre: string;
  unidadId: string | null;
  unidadCodigo: string | null;
  unidadNombre: string | null;
  obligatorio: boolean;
  descripcion: string | null;
  responsables: { usuarioId: string; nombre: string; via: string }[];
}

/**
 * Convierte la resolución de la matriz en los pasos que se guardan con el
 * documento. Un paso obligatorio sin responsables impide emitir (nadie podría
 * firmarlo y el documento quedaría bloqueado); uno opcional sin responsables
 * se omite.
 */
export function pasosDesdeMatriz(res: ResolucionFirmas): { pasos: PasoNuevo[]; errores: string[] } {
  const errores: string[] = [];
  if (res.origen === "SIN_REGLAS" || res.pasos.length === 0) {
    errores.push(
      `La matriz de firmas no tiene reglas para «${nombreTipo(res.tipoDocumento)}». ` +
        "Configúrelas en Administración › Matriz de firmas o elija otro tipo de documento.",
    );
    return { pasos: [], errores };
  }
  const pasos: PasoNuevo[] = [];
  for (const p of res.pasos) {
    if (!p.responsables.length) {
      if (p.obligatorio) errores.push(mensajePasoSinResponsables(p, res.tipoDocumento));
      continue;
    }
    pasos.push({
      orden: p.orden,
      accion: p.accion,
      rolCodigo: p.rol.codigo,
      rolNombre: p.rol.nombre,
      unidadId: p.unidad?.id ?? null,
      unidadCodigo: p.unidad?.codigo ?? null,
      unidadNombre: p.unidad?.nombre ?? null,
      obligatorio: p.obligatorio,
      descripcion: p.descripcion,
      responsables: p.responsables.map((r) => ({ usuarioId: r.usuarioId, nombre: r.nombre, via: r.via })),
    });
  }
  if (!pasos.length && !errores.length) errores.push("La matriz de firmas no resolvió ningún firmante.");
  return { pasos, errores };
}

/**
 * Mensaje para un paso obligatorio de la matriz sin nadie que lo firme: dice
 * cuál es el paso, en qué unidad falta la persona y las tres salidas posibles.
 */
export function mensajePasoSinResponsables(
  p: { orden: number; accion: string; rol: { nombre: string }; unidad: { codigo: string; nombre?: string } | null; advertencia: string | null },
  tipoDocumento: string,
): string {
  const paso = `Paso ${p.orden} de la matriz de «${nombreTipo(tipoDocumento)}» (${p.accion.toLowerCase()} · ${p.rol.nombre})`;
  if (!p.unidad)
    return (
      `${paso}: ${p.advertencia ?? "no se encontró la unidad que debe firmar"}. ` +
      "Revise la estructura en Administración › Estructura o ajuste la regla en Administración › Matriz de firmas."
    );
  const u = p.unidad.codigo;
  return (
    `${paso}: nadie tiene el rol «${p.rol.nombre}» en ${u}. Para resolverlo: asigne ese rol a una persona de ${u} ` +
    `(Administración › Usuarios), o cree una regla propia para ${u} en Administración › Matriz de firmas, ` +
    "o emita con otro tipo de documento."
  );
}

/* ========================================================================== */
/* Avance del circuito                                                        */
/* ========================================================================== */

export interface PasoFirma {
  id: string;
  orden: number;
  estado: string; // pendiente | firmado | devuelto | anulado
  responsables: unknown;
}

/** Pasos que se pueden firmar ahora: los pendientes del menor orden (mismo orden = en paralelo). */
export function pasosActuales<T extends PasoFirma>(pasos: T[]): T[] {
  const pendientes = pasos.filter((p) => p.estado === "pendiente");
  if (!pendientes.length) return [];
  const min = Math.min(...pendientes.map((p) => p.orden));
  return pendientes.filter((p) => p.orden === min);
}

export function idsResponsables(responsables: unknown): string[] {
  if (!Array.isArray(responsables)) return [];
  return responsables
    .map((r: any) => (r && typeof r.usuarioId === "string" ? r.usuarioId : null))
    .filter((x): x is string => !!x);
}

/** Paso actual que puede firmar `usuarioId`, o null. */
export function pasoFirmablePor<T extends PasoFirma>(pasos: T[], usuarioId: string): T | null {
  return pasosActuales(pasos).find((p) => idsResponsables(p.responsables).includes(usuarioId)) ?? null;
}

export interface PasoConFirmante extends PasoFirma {
  firmadoPor?: string | null;
  accion?: string;
  rolNombre?: string | null;
  rolCodigo?: string;
}

/**
 * Decide si `usuarioId` puede firmar (o devolver) ahora. Reglas:
 *   1. Debe ser responsable de un paso ACTUAL (los pendientes del menor orden):
 *      no se firma un paso antes de que firmen los anteriores.
 *   2. Separación de funciones: quien ya firmó un paso del documento no firma
 *      otro, salvo que sea el ÚNICO responsable posible de ese paso (si no, el
 *      documento quedaría bloqueado).
 */
export function decidirFirma<T extends PasoConFirmante>(
  pasos: T[],
  usuarioId: string,
): { paso: T | null; motivo: string | null } {
  const actuales = pasosActuales(pasos);
  if (!actuales.length) return { paso: null, motivo: "El documento no tiene pasos de firma pendientes." };
  const mios = actuales.filter((p) => idsResponsables(p.responsables).includes(usuarioId));
  if (!mios.length) {
    const quienes = actuales
      .map((p) => {
        const nombres = Array.isArray(p.responsables)
          ? (p.responsables as any[]).map((r) => r?.nombre).filter(Boolean).join(" o ")
          : "";
        return `${p.accion ?? "firma"} · ${p.rolNombre ?? p.rolCodigo ?? ""}${nombres ? `: ${nombres}` : ""}`;
      })
      .join("; ");
    return { paso: null, motivo: `No le corresponde firmar este paso. Paso actual: ${quienes}.` };
  }
  const yaFirmo = pasos.some((p) => p.estado === "firmado" && p.firmadoPor === usuarioId);
  if (yaFirmo) {
    const unico = mios.find((p) => idsResponsables(p.responsables).length === 1);
    if (!unico)
      return {
        paso: null,
        motivo: "Usted ya firmó otro paso de este documento: este paso debe firmarlo otro de sus responsables.",
      };
    return { paso: unico, motivo: null };
  }
  return { paso: mios[0], motivo: null };
}

/** ¿Con esta firma quedan todos los pasos firmados? */
export function quedaOficial(pasos: PasoFirma[], pasoFirmadoId: string): boolean {
  return pasos.every((p) => p.id === pasoFirmadoId || p.estado === "firmado");
}

/* ========================================================================== */
/* Estados del documento                                                      */
/* ========================================================================== */

export const ESTADOS_DOCUMENTO = ["en_firma", "oficial", "devuelto", "anulado", "emitido"] as const;

/** Documento vigente con valor oficial (incluye los emitidos antes del circuito). */
export function esOficial(estado: string | null | undefined): boolean {
  return estado === "oficial" || estado === "emitido";
}

/** Documento que cuenta para la OT (no anulado ni devuelto). */
export function esVigente(estado: string | null | undefined): boolean {
  return estado === "en_firma" || esOficial(estado);
}

const TRANSICIONES_DOC: Record<string, readonly string[]> = {
  en_firma: ["oficial", "devuelto", "anulado"],
  devuelto: ["anulado"],
  oficial: ["anulado"],
  emitido: ["anulado"],
  anulado: [],
};

export function puedeTransitarDocumento(actual: string, nuevo: string): boolean {
  return (TRANSICIONES_DOC[actual] ?? []).includes(nuevo);
}

/** Número de una nueva versión: CERT-2026-0007 → CERT-2026-0007-V2 → …-V3. */
export function numeroVersion(numeroBase: string, version: number): string {
  const base = numeroBase.replace(/-V\d+$/i, "");
  return version <= 1 ? base : `${base}-V${version}`;
}
