/** Textos comunes del oficio conductor (frente r4c). */
export const ESTADO_OFICIO: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "Borrador", pill: "gray" },
  en_firma: { texto: "En firma", pill: "amber" },
  devuelto: { texto: "Devuelto", pill: "red" },
  firmado: { texto: "Firmado · por despachar", pill: "blue" },
  despachado: { texto: "Despachado", pill: "green" },
  anulado: { texto: "Anulado", pill: "gray" },
};

export const ACCION_OFICIO: Record<string, string> = {
  VB: "V°B°",
  FIRMA: "Firma",
  REVISA: "Revisa",
  APRUEBA: "Aprueba",
  OFICIALIZA: "Oficializa",
  ELABORA: "Elabora",
};

/** Distribución escrita como «destinatario … 2» por línea → [{destinatario, ejemplares}]. */
export function leerDistribucion(texto: string): { destinatario: string; ejemplares: number }[] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)[\s:;,-]+(\d{1,2})$/);
      return m ? { destinatario: m[1].trim(), ejemplares: Number(m[2]) } : { destinatario: l, ejemplares: 1 };
    });
}

export const textoDistribucion = (d: { destinatario: string; ejemplares: number }[] | null | undefined) =>
  (d ?? []).map((x) => `${x.destinatario} ${x.ejemplares}`).join("\n");
