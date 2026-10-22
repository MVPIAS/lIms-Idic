/**
 * Presentación del certificado de calibración: lo que el metrólogo decide sobre el
 * documento y no sobre el cálculo (respuesta del LMT del 21-10-2026):
 *
 *   1-2 · logo de acreditado y línea «Laboratorio de Calibración [Acreditado] en la
 *         magnitud …»: por defecto según la acreditación del PROCESO; se puede quitar
 *         (o volver a poner si el proceso está acreditado) con motivo y registro.
 *   3   · «Este certificado reemplaza al certificado N° …» a mano (certificado del
 *         sistema anterior o en papel), con motivo; la reemisión del LIMS prevalece.
 *   5   · OBSERVACIONES editables: valor inicial = textos automáticos.
 *   4   · condiciones propias de la IT (formato-it.ts).
 *   10  · esquema o imagen: el del proceso (por defecto), uno propio o ninguno.
 *
 * Funciones PURAS: presentacion.spec.ts.
 */
import { clavesCampos } from "./formato-it";

export type ModoEsquema = "defecto" | "propio" | "ninguno";
export const MODOS_ESQUEMA: ModoEsquema[] = ["defecto", "propio", "ninguno"];

/**
 * Formatos de certificado de un proceso, además del estándar (hojas «Certificado» de sus
 * libros). Solo los que tienen un libro real con datos: ITT01 «Certificado ASTM» (T-2887).
 */
export const FORMATOS_CERTIFICADO: Record<string, { valor: string; etiqueta: string }[]> = {
  ITT01: [
    { valor: "estandar", etiqueta: "Estándar (hoja «Certificado» del libro)" },
    { valor: "astm", etiqueta: "Termómetro de fabricación ASTM (hoja «Certificado ASTM»)" },
  ],
};
export const formatosDe = (proceso: string) => FORMATOS_CERTIFICADO[proceso] ?? [];

export interface Presentacion {
  /** null = según el proceso; true = con logo y «Acreditado»; false = sin logo. */
  acreditado: boolean | null;
  acreditadoMotivo: string | null;
  /** Número del certificado que este reemplaza, indicado a mano. */
  reemplaza: string | null;
  reemplazaMotivo: string | null;
  /** null = textos automáticos; si no, una línea por observación. */
  observaciones: string | null;
  /** Condiciones propias de la IT (clave → texto). */
  campos: Record<string, string>;
  esquemaModo: ModoEsquema;
  esquemaPie: string | null;
  /** Formato del certificado del proceso («estandar» o uno de FORMATOS_CERTIFICADO). */
  formato: string;
}

export const PRESENTACION_VACIA: Presentacion = {
  acreditado: null, acreditadoMotivo: null, reemplaza: null, reemplazaMotivo: null, observaciones: null, campos: {}, esquemaModo: "defecto", esquemaPie: null,
  formato: "estandar",
};

/** Lee la columna JSONB `presentacion` (tolera nulos y claves viejas). */
export function leerPresentacion(x: any): Presentacion {
  const o = x && typeof x === "object" ? x : {};
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.campos ?? {})) if (v != null && String(v).trim() !== "") campos[k] = String(v);
  return {
    acreditado: typeof o.acreditado === "boolean" ? o.acreditado : null,
    acreditadoMotivo: o.acreditadoMotivo ?? null,
    reemplaza: o.reemplaza ?? null,
    reemplazaMotivo: o.reemplazaMotivo ?? null,
    observaciones: typeof o.observaciones === "string" ? o.observaciones : null,
    campos,
    esquemaModo: MODOS_ESQUEMA.includes(o.esquemaModo) ? o.esquemaModo : "defecto",
    esquemaPie: o.esquemaPie ?? null,
    formato: typeof o.formato === "string" && o.formato ? o.formato : "estandar",
  };
}

/**
 * Acreditación con la que sale el certificado. Por defecto la del proceso; el
 * certificado puede salir sin logo aunque el proceso esté acreditado (por ejemplo,
 * todos sus puntos fuera del alcance), pero nunca con logo si el proceso no lo está.
 */
export function acreditacionEfectiva(codigoProceso: string | null | undefined, eleccion: boolean | null): { acreditado: boolean; codigo: string | null; cambiada: boolean } {
  const delProceso = !!(codigoProceso && String(codigoProceso).trim());
  const acreditado = eleccion == null ? delProceso : eleccion && delProceso;
  return { acreditado, codigo: acreditado ? String(codigoProceso).trim() : null, cambiada: eleccion != null && eleccion !== delProceso };
}

/** Línea bajo el título: «Laboratorio de Calibración [Acreditado] en la magnitud …». */
export function lineaAcreditacion(acreditado: boolean, magnitud: string): string {
  return `Laboratorio de Calibración${acreditado ? " Acreditado" : ""} en la magnitud ${magnitud}`;
}

/** Observaciones automáticas (las de sus libros), valor inicial del campo editable. */
export function observacionesAutomaticas(o: { intervaloMeses?: number | null; k: string; fueraAlcance: boolean; acreditado: boolean }): string[] {
  return [
    `Intervalo de calibración: ${o.intervaloMeses ? `${o.intervaloMeses} meses` : "según requerimiento del cliente"}.`,
    `La incertidumbre expandida ha sido estimada multiplicando la incertidumbre estándar por el factor de cobertura k = ${o.k}.`,
    "El valor del mensurando se encuentra dentro del intervalo indicado de valores con una probabilidad del 95 %.",
    "\"--\" = No aplica.",
    ...(o.fueraAlcance && o.acreditado ? ["* Las calibraciones marcadas no están incluidas en el alcance de acreditación."] : []),
  ];
}

/** Observaciones que se imprimen: las escritas por el metrólogo o, si no hay, las automáticas. */
export function observacionesImpresas(p: Pick<Presentacion, "observaciones">, automaticas: string[]): string[] {
  if (p.observaciones == null) return automaticas;
  return p.observaciones.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const NUMERO_CERT = /^[A-ZÑ]{1,6}\s?-\s?\d{1,6}(\.\d{2})?$|^\d{1,7}$/i;
const MAX_LINEAS = 25;
const MAX_OBS = 4000;

export interface ContextoPresentacion {
  proceso: string;
  /** Código de acreditación del proceso (null si no está acreditado). */
  acreditacionProceso: string | null;
  /** Número del certificado que reemplaza por reemisión del LIMS (si la hay). */
  reemisionDe: string | null;
  /** Número propio, si ya lo tiene. */
  numeroPropio: string | null;
}

/** Normaliza lo pedido y devuelve el motivo de rechazo, o la presentación lista para guardar. */
export function validarPresentacion(p: Presentacion, c: ContextoPresentacion): { error: string } | { ok: Presentacion } {
  const out: Presentacion = { ...p, campos: { ...p.campos } };
  const tieneProceso = !!(c.acreditacionProceso && c.acreditacionProceso.trim());
  // 1-2 · acreditación
  if (out.acreditado === true && !tieneProceso)
    return { error: `El proceso ${c.proceso} no tiene acreditación vigente en el LIMS: el certificado no puede llevar el logo ni decir «Acreditado».` };
  if (out.acreditado != null && out.acreditado === tieneProceso) out.acreditado = null; // igual que el proceso: vuelve a «según el proceso»
  if (out.acreditado == null) out.acreditadoMotivo = null;
  else if (!out.acreditadoMotivo || out.acreditadoMotivo.trim().length < 5)
    return { error: "Indique el motivo por el que el certificado sale sin el logo de acreditado (mínimo 5 caracteres)." };
  // 3 · reemplaza a mano
  const r = out.reemplaza?.trim() || null;
  out.reemplaza = r ? r.replace(/\s*-\s*/, "-").toUpperCase() : null;
  if (out.reemplaza) {
    if (c.reemisionDe) return { error: `Este certificado ya reemplaza al N° ${c.reemisionDe} por reemisión en el LIMS: no se indica otro a mano.` };
    if (!NUMERO_CERT.test(out.reemplaza)) return { error: `«${out.reemplaza}» no parece un número de certificado (por ejemplo, M-3901 o LCPNF-012.26).` };
    if (c.numeroPropio && out.reemplaza === c.numeroPropio.toUpperCase()) return { error: "Un certificado no puede reemplazarse a sí mismo." };
    if (!out.reemplazaMotivo || out.reemplazaMotivo.trim().length < 5) return { error: "Indique el motivo del reemplazo (mínimo 5 caracteres)." };
  } else out.reemplazaMotivo = null;
  // 5 · observaciones
  if (out.observaciones != null) {
    const lineas = out.observaciones.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (out.observaciones.length > MAX_OBS) return { error: `Las observaciones no pueden superar ${MAX_OBS} caracteres.` };
    if (lineas.length > MAX_LINEAS) return { error: `Las observaciones no pueden tener más de ${MAX_LINEAS} líneas.` };
    if (!lineas.length) return { error: "Las observaciones no pueden quedar vacías: use «Restaurar los textos automáticos»." };
    out.observaciones = lineas.join("\n");
  }
  // 4 · condiciones propias de la IT
  const validas = clavesCampos(c.proceso);
  for (const [k, v] of Object.entries(out.campos)) {
    if (!validas.includes(k)) return { error: `El dato «${k}» no corresponde al certificado de ${c.proceso}.` };
    const t = String(v ?? "").trim();
    if (t.length > 200) return { error: `El dato «${k}» no puede superar 200 caracteres.` };
    if (!t) delete out.campos[k];
    else out.campos[k] = t;
  }
  // Formato del certificado (ASTM en termómetros)
  out.formato = out.formato || "estandar";
  if (out.formato !== "estandar" && !formatosDe(c.proceso).some((f) => f.valor === out.formato))
    return { error: `El proceso ${c.proceso} no tiene el formato de certificado «${out.formato}».` };
  // 10 · esquema
  if (!MODOS_ESQUEMA.includes(out.esquemaModo)) return { error: "Modo de esquema no válido." };
  out.esquemaPie = out.esquemaPie?.trim().slice(0, 300) || null;
  for (const k of ["acreditadoMotivo", "reemplazaMotivo"] as const) out[k] = out[k]?.trim().slice(0, 500) || null;
  return { ok: out };
}

/** Avisos (no bloquean): por ejemplo, puntos «*» sin la leyenda en observaciones editadas. */
export function avisosPresentacion(p: Presentacion, o: { fueraAlcance: boolean; acreditado: boolean }): string[] {
  const a: string[] = [];
  if (p.observaciones != null && o.fueraAlcance && o.acreditado && !p.observaciones.includes("*"))
    a.push("Hay puntos marcados «*» (fuera del alcance acreditado) y las observaciones no explican el asterisco.");
  return a;
}

/** Texto para la bitácora con lo que cambió (y los motivos). */
export function resumenCambios(antes: Presentacion, despues: Presentacion): string {
  const c: string[] = [];
  if (antes.acreditado !== despues.acreditado)
    c.push(despues.acreditado == null ? "Acreditación: según el proceso" : `Acreditación: ${despues.acreditado ? "con logo de acreditado" : "sin logo de acreditado"} (motivo: ${despues.acreditadoMotivo})`);
  if (antes.reemplaza !== despues.reemplaza)
    c.push(despues.reemplaza ? `Reemplaza al certificado N° ${despues.reemplaza} (motivo: ${despues.reemplazaMotivo})` : "Sin «reemplaza al certificado»");
  if (antes.observaciones !== despues.observaciones) c.push(despues.observaciones == null ? "Observaciones: textos automáticos" : "Observaciones editadas");
  if (JSON.stringify(antes.campos) !== JSON.stringify(despues.campos)) c.push("Condiciones de la IT actualizadas");
  if ((antes.formato ?? "estandar") !== (despues.formato ?? "estandar"))
    c.push(`Formato del certificado: ${despues.formato === "astm" ? "termómetro de fabricación ASTM" : "estándar"}`);
  if (antes.esquemaModo !== despues.esquemaModo || antes.esquemaPie !== despues.esquemaPie)
    c.push(`Esquema: ${{ defecto: "el del proceso", propio: "propio de la calibración", ninguno: "sin esquema" }[despues.esquemaModo]}`);
  return c.join(" · ");
}
