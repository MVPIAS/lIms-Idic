export const ESCALON: Record<string, string> = {
  internaciones: "Escalón Internaciones",
  produccion_nacional: "Escalón Producción Nacional",
  scc: "Sección Certificación de la Conformidad",
  delegacion_11: "Delegación 11",
};

export const ESTADO_REQ: Record<string, { l: string; c: string }> = {
  borrador: { l: "Por validar", c: "amber" },
  validado: { l: "Validado · OT generada", c: "green" },
  anulado: { l: "Anulado", c: "gray" },
};
