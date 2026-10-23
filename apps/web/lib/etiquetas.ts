// =============================================================================
// etiquetas.ts · Textos legibles de los códigos internos (B-084)
// -----------------------------------------------------------------------------
// Los códigos («telefono», «oficina_partes», «contado_30») son para la base de
// datos; la pantalla muestra siempre su texto. Lo que viene de una lista
// maestra (parametro_sistema) se etiqueta con esa lista; esto cubre los medios
// fijos del código.
// =============================================================================

const MEDIOS: Record<string, string> = {
  correo: "correo electrónico",
  oficio: "oficio",
  telefono: "teléfono",
  mano: "entrega en mano",
  libro: "libro de despacho",
  oficina_partes: "oficina de partes",
  courier: "courier",
  plataforma: "plataforma del cliente",
  presencial: "presencial",
  formulario_fisico: "formulario físico",
  integracion: "integración",
  otro: "otro medio",
};

/** Texto de un medio de envío o contacto («telefono» → «teléfono»). */
export function textoMedio(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return MEDIOS[codigo] ?? codigo.replace(/_/g, " ");
}

/** Nombre del documento que emite la OT a partir de su código. */
export const DOCUMENTO_OT: Record<string, string> = {
  IE: "Informe de Ensayo",
  IVC: "Informe de Verificación de Calidad",
  II: "Informe de Inspección",
};
