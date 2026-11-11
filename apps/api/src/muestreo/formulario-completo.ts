/**
 * Sesión R6 (Muestreo e inspección, 30-10-2026) · formulario de «Selección y
 * extracción de muestras» completo y perfiles. Reglas PURAS (formulario-completo.spec.ts).
 *
 *  · Horas de inicio y término de la toma (la de término no antes que la de inicio).
 *  · Norma del muestreo: NCh 44 (plan por atributos) o NCh 43 (selección al azar).
 *  · Perfil: el muestreador de Comercial (rol MUESTREO, sin captura de
 *    resultados) trabaja sin el plan NCh 44 y sin costo; el inspector del BPCH
 *    sí ve el plan. A quien solo muestrea se le ocultan los pasos que no usa
 *    (asignación y preparación).
 *  · Adjunto del formulario firmado en terreno: PDF, PNG o JPEG.
 */

export const NORMAS_MUESTREO = ["NCh 44", "NCh 43", "Otra"] as const;

/** «HH:MM» válida. */
export const horaValida = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/** Errores de las horas de la toma (lista vacía = válidas). */
export function erroresHoras(inicio: string | null | undefined, termino: string | null | undefined): string[] {
  const e: string[] = [];
  if (inicio && !horaValida(inicio)) e.push("La hora de inicio no es válida (HH:MM).");
  if (termino && !horaValida(termino)) e.push("La hora de término no es válida (HH:MM).");
  if (inicio && termino && horaValida(inicio) && horaValida(termino) && termino < inicio)
    e.push("La hora de término no puede ser anterior a la de inicio.");
  return e;
}

export interface PerfilMuestreo {
  /** Solo muestrea: no captura resultados ni asigna. */
  soloMuestrea: boolean;
  /** Muestra el plan NCh 44 (inspectores del BPCH y laboratorios; no el muestreador de Comercial). */
  verPlan: boolean;
  /** Muestra el costo del muestreo (no el muestreador de Comercial). */
  verCosto: boolean;
  /** Nombre del perfil para la pantalla. */
  nombre: string | null;
}

/** Perfil del usuario en el muestreo según sus roles y permisos. */
export function perfilMuestreo(roles: string[], permisos: string[]): PerfilMuestreo {
  if (roles.includes("SUPERADMIN")) return { soloMuestrea: false, verPlan: true, verCosto: true, nombre: null };
  const p = new Set(permisos);
  const soloMuestrea = p.has("muestreo.registrar") && !p.has("resultado.crear") && !p.has("ot.asignar") && !p.has("resultado.aprobar");
  const comercial = roles.includes("MUESTREO") && soloMuestrea;
  const inspector = roles.includes("INSPECTOR");
  return {
    soloMuestrea,
    verPlan: !comercial,
    verCosto: !comercial,
    nombre: comercial ? "Muestreador de Comercial" : inspector ? "Inspector" : soloMuestrea ? "Muestreador" : null,
  };
}

/** Tipo de archivo del formulario adjunto por su firma (no por la extensión). */
export function tipoAdjunto(b: Buffer): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}
