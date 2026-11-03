/**
 * Plantillas de correo del módulo de mensajería (contrato §4.5.4).
 *
 * Las plantillas viven en la tabla `correo_plantilla` (align_comunicacion.sql),
 * EDITABLES por etapa de la actividad desde Mensajería › Plantillas, con envío
 * automático configurable en las etapas que tienen disparador. Las de este
 * archivo son el respaldo si la tabla no tiene la clave (instalación a medias):
 * nunca se deja de poder enviar.
 *
 * Cada etapa declara sus marcadores {{variable}}; un marcador que la etapa no
 * conoce se rechaza al guardar (variablesNoAdmitidas). Funciones puras:
 * correo-plantillas.spec.ts.
 */

export type TipoCorreo = "cotizacion" | "resultado" | "etapa" | "mensaje" | "aviso" | "otro";

/** Etapas de la actividad con plantilla propia. */
export interface EtapaCorreo {
  etapa: string;
  nombre: string;
  /** Qué la dispara; null = se envía a mano (Mensajería o la ficha). */
  disparador: string | null;
  destino: "cliente" | "interno";
  variables: string[];
}

export const ETAPAS_CORREO: EtapaCorreo[] = [
  { etapa: "cotizacion_enviada", nombre: "Cotización enviada", disparador: null, destino: "cliente", variables: ["cliente", "codigo", "total", "validez", "fecha"] },
  { etapa: "ot_creada", nombre: "OT creada", disparador: "Al crear la OT (a mano o al aceptar la cotización)", destino: "cliente", variables: ["cliente", "codigo", "laboratorio", "fecha", "fecha_compromiso"] },
  { etapa: "muestras_recibidas", nombre: "Muestras recibidas", disparador: "Al registrar las muestras recibidas de la OT", destino: "cliente", variables: ["cliente", "codigo", "cantidad", "muestras", "fecha"] },
  { etapa: "documento_oficial", nombre: "Informe oficial", disparador: "Cuando el informe o certificado queda con todas sus firmas", destino: "cliente", variables: ["cliente", "codigo", "documento", "fecha"] },
  { etapa: "resultado", nombre: "Resultado de la OT", disparador: null, destino: "cliente", variables: ["cliente", "codigo", "veredicto", "fecha"] },
  { etapa: "aviso_interno", nombre: "Avisos internos (Mi bandeja)", disparador: "Con cada aviso: OT vencida o por vencer, No cumple, documento listo, despacho…", destino: "interno", variables: ["titulo", "mensaje", "tipo", "fecha"] },
];

const ETAPA_POR_CODIGO = new Map(ETAPAS_CORREO.map((e) => [e.etapa, e]));

export function etapaCorreo(etapa: string | null | undefined): EtapaCorreo | undefined {
  return etapa ? ETAPA_POR_CODIGO.get(etapa) : undefined;
}

/** Marcadores {{x}} del texto que la etapa no conoce (vacío = todo bien). */
export function variablesNoAdmitidas(texto: string, etapa: string): string[] {
  const e = etapaCorreo(etapa);
  const admitidas = new Set(e?.variables ?? []);
  const usadas = [...texto.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(usadas.filter((v) => !admitidas.has(v)))];
}

/**
 * Asunto y cuerpo listos para enviar: el asunto con los valores tal cual (es
 * texto plano) y el cuerpo con los valores escapados para HTML. Agrega la firma
 * institucional al cuerpo si la plantilla no la trae.
 */
export function componerCorreo(p: { asunto: string; cuerpo: string; destino?: string }, vars: Record<string, string>): { asunto: string; html: string } {
  const escapar = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const seguras = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapar(String(v ?? ""))]));
  const asunto = aplicarPlaceholders(p.asunto, vars).replace(/\s*[\r\n]+\s*/g, " ").slice(0, 300);
  let html = aplicarPlaceholders(p.cuerpo, seguras);
  if (p.destino !== "interno" && !/Atentamente/i.test(html)) html += FIRMA_HTML;
  return { asunto, html };
}

export interface PlantillaCorreo {
  clave: string;
  tipo: TipoCorreo;
  nombre: string;
  /** Asunto con placeholders {{...}}. */
  asunto: string;
  /** Cuerpo HTML con placeholders {{...}}. */
  cuerpo: string;
}

export const FIRMA_HTML =
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
