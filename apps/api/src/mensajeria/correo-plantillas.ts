/**
 * Plantillas de correo predefinidas del módulo de mensajería.
 *
 * El contrato (§4.5.4 / §4.5.5 / §4.5.6) pide "email transaccional con plantilla
 * SELECCIONABLE". No hace falta un editor de plantillas de correo completo: basta
 * un catálogo cerrado de plantillas predefinidas (asunto + cuerpo con
 * placeholders) que el usuario elige al enviar. Vive en código a propósito —igual
 * criterio que los cuerpos de `plantilla-defecto.ts`—: son textos institucionales
 * estables, no datos de usuario, y así no dependemos de una tabla editable para
 * poder enviar.
 *
 * Placeholders disponibles: {{cliente}}, {{codigo}}, {{veredicto}}, {{validez}},
 * {{total}}, {{fecha}}. Los que una plantilla no use simplemente se ignoran.
 */

export type TipoCorreo = "cotizacion" | "resultado" | "otro";

export interface PlantillaCorreo {
  clave: string;
  tipo: TipoCorreo;
  nombre: string;
  /** Asunto con placeholders {{...}}. */
  asunto: string;
  /** Cuerpo HTML con placeholders {{...}}. */
  cuerpo: string;
}

const FIRMA_HTML =
  '<p style="margin-top:18px;color:#5b6b7c;font-size:13px">Atentamente,<br>' +
  "<b>Instituto de Investigaciones y Control &middot; Ejército de Chile</b></p>";

export const PLANTILLAS_CORREO: PlantillaCorreo[] = [
  {
    clave: "cotizacion_estandar",
    tipo: "cotizacion",
    nombre: "Cotización · estándar",
    asunto: "Cotización {{codigo}} · IDIC",
    cuerpo:
      "<p>Estimado(a) <b>{{cliente}}</b>:</p>" +
      "<p>Adjunto encontrará en formato PDF la cotización <b>{{codigo}}</b> emitida por el " +
      "Instituto de Investigaciones y Control (IDIC), por un total de <b>{{total}}</b>.</p>" +
      "<p>La cotización tiene una validez de <b>{{validez}}</b> días. Ante cualquier consulta " +
      "puede responder directamente a este correo.</p>" +
      FIRMA_HTML,
  },
  {
    clave: "cotizacion_seguimiento",
    tipo: "cotizacion",
    nombre: "Cotización · recordatorio de seguimiento",
    asunto: "Recordatorio · Cotización {{codigo}}",
    cuerpo:
      "<p>Estimado(a) <b>{{cliente}}</b>:</p>" +
      "<p>Le reenviamos, adjunta en PDF, la cotización <b>{{codigo}}</b> (total <b>{{total}}</b>) " +
      "por si fuera de su interés retomarla. Su validez es de <b>{{validez}}</b> días.</p>" +
      FIRMA_HTML,
  },
  {
    clave: "resultado_estandar",
    tipo: "resultado",
    nombre: "Resultado · notificación al cliente",
    asunto: "Resultado de su orden de trabajo {{codigo}}",
    cuerpo:
      "<p>Estimado(a) <b>{{cliente}}</b>:</p>" +
      "<p>Le informamos que la orden de trabajo <b>{{codigo}}</b> registra el siguiente " +
      "estado/veredicto: <b>{{veredicto}}</b>.</p>" +
      "<p>Puede solicitar el informe o certificado correspondiente respondiendo a este correo.</p>" +
      FIRMA_HTML,
  },
  {
    clave: "resultado_validado",
    tipo: "resultado",
    nombre: "Resultado · validado por responsable",
    asunto: "Informe validado · Orden de trabajo {{codigo}}",
    cuerpo:
      "<p>Estimado(a) <b>{{cliente}}</b>:</p>" +
      "<p>El resultado de la orden de trabajo <b>{{codigo}}</b> ha sido <b>validado</b> por el " +
      "responsable del laboratorio. Veredicto: <b>{{veredicto}}</b>.</p>" +
      FIRMA_HTML,
  },
];

const PLANTILLA_POR_CLAVE = new Map(PLANTILLAS_CORREO.map((p) => [p.clave, p]));

/** Devuelve la plantilla por su clave, o `undefined` si no existe. */
export function plantillaPorClave(clave: string | undefined | null): PlantillaCorreo | undefined {
  if (!clave) return undefined;
  return PLANTILLA_POR_CLAVE.get(clave);
}

/** Plantilla por defecto para un tipo de correo (la primera de ese tipo). */
export function plantillaPorDefecto(tipo: TipoCorreo): PlantillaCorreo {
  return PLANTILLAS_CORREO.find((p) => p.tipo === tipo) ?? PLANTILLAS_CORREO[0];
}

/** Sustituye los placeholders {{clave}} por su valor (ausente => cadena vacía). */
export function aplicarPlaceholders(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, clave: string) => vars[clave] ?? "");
}
