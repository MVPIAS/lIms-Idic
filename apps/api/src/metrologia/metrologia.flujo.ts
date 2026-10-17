/**
 * Reglas del circuito del Certificado de Calibración (puras, sin base de datos).
 *
 *   borrador ─enviar─▶ en_revision ─firmar (jefe de laboratorio)─▶ en_firma ─emitir (jefe de departamento)─▶ emitida
 *      ▲                   │                                         │                                       │
 *      └─────devolver──────┴──────────────devolver───────────────────┘                    reemitir: borrador nuevo que,
 *                                                                                          al emitirse, deja esta «reemplazada»
 *
 * Los pasos y sus responsables salen de la matriz de firmas CERTIFICADO_CALIBRACION
 * (Administración › Matriz de firmas; para la Sección Metrología: ELABORA metrólogo →
 * FIRMA jefe del laboratorio, titular o subrogante → FIRMA jefe del departamento),
 * como en el registro de firmas autorizadas del LMT (LMT-PG01 Anexo 11).
 *
 *  - Solo quien elaboró la calibración la edita y la envía (mientras es borrador); para
 *    enviarla debe figurar en el registro de firmas autorizadas para la magnitud.
 *  - Firma cada paso un responsable de ESE paso según la matriz (nadie se adelanta).
 *    Quien elaboró puede firmar el paso del jefe si es su responsable (decisión del
 *    14-10-2026: laboratorios de dos personas).
 *  - Devuelve (con motivo) un responsable del paso pendiente.
 *  - Sin reglas en la matriz (instalación sin sembrar), basta `metrologia.emitir` y la
 *    emisión es directa (comportamiento anterior).
 *  - Una calibración emitida no cambia: se reemite (nuevo certificado que la reemplaza).
 */
export type EstadoCal = "borrador" | "en_revision" | "en_firma" | "emitida" | "reemplazada";
export type AccionCal = "EDITAR" | "ENVIAR" | "DEVOLVER" | "FIRMAR" | "EMITIR" | "REEMITIR";

export interface ContextoCal {
  estado: string;
  esAutor: boolean;
  puedeCrear: boolean;
  puedeEmitir: boolean;
  /** Calibración con resultado completo (sin él no se envía ni se emite). */
  calculada: boolean;
  /** El usuario puede firmar el paso pendiente según la matriz (sin matriz: tiene metrologia.emitir). */
  responsablePaso?: boolean;
  /** El paso pendiente es el último: firmarlo emite el certificado. */
  ultimoPaso?: boolean;
  /** Motivo por el que el usuario no está habilitado para la magnitud (registro de firmas), o null. */
  habilitacion?: string | null;
  /** Ya hay una reemisión en curso de esta calibración. */
  reemisionEnCurso?: boolean;
}

/** Normaliza estados antiguos («calculada» = borrador guardado). */
export const estadoDe = (e: string | null | undefined): EstadoCal =>
  e === "emitida" || e === "en_revision" || e === "en_firma" || e === "reemplazada" ? e : "borrador";

const enCircuito = (e: EstadoCal) => e === "en_revision" || e === "en_firma";

/** Motivo por el que la acción no procede, o null si procede. */
export function motivoRechazo(accion: AccionCal, c: ContextoCal): string | null {
  const e = estadoDe(c.estado);
  if (e === "reemplazada") return "El certificado fue reemplazado por otro y no admite cambios";
  if (accion === "REEMITIR") {
    if (e !== "emitida") return "Solo se reemite un certificado emitido";
    if (!c.puedeEmitir || !c.puedeCrear) return "No tiene permiso para reemitir certificados de calibración";
    if (c.reemisionEnCurso) return "Ya hay una reemisión en curso de este certificado";
    return null;
  }
  if (e === "emitida") return "La calibración ya fue emitida y no admite cambios (si hay un error, reemita el certificado)";
  switch (accion) {
    case "EDITAR":
      if (e !== "borrador") return "Solo se edita una calibración en borrador (si está en revisión, el revisor debe devolverla)";
      if (!c.puedeCrear) return "No tiene permiso para registrar calibraciones";
      if (!c.esAutor) return "Solo quien elaboró la calibración puede editarla";
      return null;
    case "ENVIAR":
      if (e !== "borrador") return "Solo se envía a revisión una calibración en borrador";
      if (!c.puedeCrear) return "No tiene permiso para registrar calibraciones";
      if (!c.esAutor) return "Solo quien elaboró la calibración puede enviarla a revisión";
      if (!c.calculada) return "La calibración no tiene resultado calculado";
      if (c.habilitacion) return c.habilitacion;
      return null;
    case "DEVOLVER":
    case "FIRMAR":
    case "EMITIR":
      if (!enCircuito(e)) return "La calibración debe estar enviada a revisión";
      if (!(c.responsablePaso ?? c.puedeEmitir)) return "No le corresponde firmar el paso pendiente según la matriz de firmas";
      if (accion !== "DEVOLVER" && !c.calculada) return "La calibración no tiene resultado calculado";
      if (accion === "FIRMAR" && (c.ultimoPaso ?? true)) return "El paso pendiente emite el certificado: use «Emitir»";
      if (accion === "EMITIR" && !(c.ultimoPaso ?? true)) return "Faltan firmas anteriores a la emisión";
      return null;
  }
  return "Acción desconocida";
}

/** Estado al que lleva cada acción (FIRMAR deja la calibración esperando el paso siguiente). */
export const ESTADO_TRAS: Record<Exclude<AccionCal, "REEMITIR">, EstadoCal> = {
  EDITAR: "borrador", ENVIAR: "en_revision", DEVOLVER: "borrador", FIRMAR: "en_firma", EMITIR: "emitida",
};

/** Acciones disponibles para mostrar en la lista. */
export function accionesDisponibles(c: ContextoCal): AccionCal[] {
  return (["EDITAR", "ENVIAR", "DEVOLVER", "FIRMAR", "EMITIR", "REEMITIR"] as AccionCal[]).filter((a) => motivoRechazo(a, c) === null);
}

/** Paso de la matriz resuelto para la calibración (subconjunto de firmas-resolver). */
export interface PasoFirmaCal {
  orden: number; accion: string; obligatorio: boolean; descripcion?: string | null;
  rol: { codigo: string; nombre: string }; unidad: { codigo: string } | null;
  responsables: { usuarioId: string; nombre: string; via: string }[];
}
export interface FirmaHecha { orden: number; usuarioId: string | null; accion: string }

/**
 * Pasos de firma de los jefes (los posteriores al ELABORA, que es el envío del metrólogo),
 * sin los opcionales que nadie puede firmar, y el paso pendiente según las firmas hechas.
 */
export function pasoPendiente(pasos: PasoFirmaCal[], firmas: FirmaHecha[]) {
  const elabora = pasos.find((p) => p.accion === "ELABORA") ?? null;
  const jefes = pasos
    .filter((p) => p.accion !== "ELABORA" && (p.obligatorio || p.responsables.length))
    .sort((a, b) => a.orden - b.orden);
  const hechas = new Set(firmas.map((f) => f.orden));
  const pendientes = jefes.filter((p) => !hechas.has(p.orden));
  return { elabora, jefes, actual: pendientes[0] ?? null, ultimo: pendientes.length === 1 };
}

/**
 * ¿Puede el usuario firmar el paso? Debe ser responsable; si ya firmó otro paso de jefe en
 * esta calibración, solo si es el único responsable posible (si no, quedaría bloqueada).
 */
export function puedeFirmarPaso(paso: PasoFirmaCal | null, usuarioId: string, firmas: FirmaHecha[]): boolean {
  if (!paso) return false;
  if (!paso.responsables.some((r) => r.usuarioId === usuarioId)) return false;
  const yaFirmoJefe = firmas.some((f) => f.usuarioId === usuarioId && f.accion !== "ELABORA");
  return !yaFirmoJefe || paso.responsables.length === 1;
}

/** Pasos obligatorios sin nadie que pueda firmarlos (bloquearían el circuito). */
export function pasosSinResponsable(pasos: PasoFirmaCal[]): string[] {
  return pasos
    .filter((p) => p.accion !== "ELABORA" && p.obligatorio && !p.responsables.length)
    .map((p) => `Paso ${p.orden} de la matriz de firmas (${p.descripcion ?? p.rol.nombre}): nadie tiene el rol «${p.rol.nombre}» en ${p.unidad?.codigo ?? "la unidad"}. Asígnelo en Administración › Usuarios o ajuste la matriz de firmas.`);
}

/** Fecha de calibración válida (AAAA-MM-DD) o la de hoy en Chile. */
export function fechaCalibracion(fecha?: string | null, hoy: Date = new Date()): string {
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha + "T12:00:00Z"))) return fecha;
  return hoy.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
}

/** Código interno de la calibración (correlativo por año): no es el número del certificado. */
export const codigoCalibracion = (fecha: string, n: number) => `CAL-${fecha.slice(0, 4)}-${String(n).padStart(4, "0")}`;

/**
 * Formulario vacío a partir de la estructura de un caso: números → null,
 * textos → "", conserva la forma (filas, series, columnas) para poder escribir.
 */
export function plantillaVacia(v: any): any {
  if (Array.isArray(v)) return v.map(plantillaVacia);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plantillaVacia(x)]));
  if (typeof v === "number") return null;
  if (typeof v === "string") return "";
  return v ?? null;
}
