// =============================================================================
// etiquetas.ts · Textos legibles de los códigos internos (B-084)
// -----------------------------------------------------------------------------
// Los códigos («telefono», «oficina_partes», «contado_30») son para la base de
// datos; la pantalla muestra siempre su texto. Lo que viene de una lista
// maestra (parametro_sistema) se etiqueta con esa lista.
// =============================================================================
import { enFrase, etiquetaLeida } from "./lista-parametro";

/**
 * Medios de CONTACTO que no son de envío (aviso de plazo por teléfono, encuesta
 * presencial…). Los medios de envío salen de «Parámetros del sistema ›
 * medio_envio» (frente f5): la pantalla que los muestra llama a useMediosEnvio().
 */
const MEDIOS_CONTACTO: Record<string, string> = {
  telefono: "teléfono",
  presencial: "presencial",
  formulario_fisico: "formulario físico",
  integracion: "integración",
};

/** Texto de un medio de envío o contacto, para una frase («mano» → «entrega en mano»). */
export function textoMedio(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  const envio = etiquetaLeida("medio_envio", codigo);
  return envio ? enFrase(envio) : MEDIOS_CONTACTO[codigo] ?? codigo.replace(/_/g, " ");
}

/** Nombre del documento que emite la OT a partir de su código. */
export const DOCUMENTO_OT: Record<string, string> = {
  IE: "Informe de Ensayo",
  IVC: "Informe de Verificación de Calidad",
  II: "Informe de Inspección",
};

/** Cierra una frase con punto sin duplicarlo («… Ltda.» no pasa a «… Ltda..»; B-085). */
export function conPunto(texto: string | null | undefined): string {
  const t = String(texto ?? "").trimEnd();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
