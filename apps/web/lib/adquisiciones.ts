/** Textos comunes de la solicitud de adquisición (IDIC-PG06-IT02-FORM01). */
export const ESTADO_ADQUISICION: Record<string, { texto: string; pill: string }> = {
  borrador: { texto: "Borrador", pill: "gray" },
  enviada: { texto: "Enviada · espera V°B°", pill: "amber" },
  devuelta: { texto: "Devuelta", pill: "red" },
  visada: { texto: "Con V°B° · por recibir en SAB", pill: "blue" },
  recibida_sab: { texto: "Recibida por SAB", pill: "blue" },
  en_compra: { texto: "En proceso de compra", pill: "amber" },
  recibida_bodega: { texto: "Recibida en bodega", pill: "green" },
  anulada: { texto: "Anulada", pill: "gray" },
};

export const ACCION_ADQUISICION: Record<string, string> = {
  creada: "Creada (borrador)",
  corregida: "Corregida",
  enviar: "Enviada a la jefatura",
  visar: "V°B° de la jefatura",
  devolver: "Devuelta",
  recibir_sab: "Recibida por Abastecimiento",
  registrar_oc: "Orden de compra registrada",
  recibir_bodega: "Recibida en bodega",
  anular: "Anulada",
};

export interface ItemForm {
  cantidad: string;
  unidadMedida: string;
  descripcion: string;
  valorUnitario: string;
  vinculo: "" | "consumible" | "equipo";
  consumibleId: string | null;
  equipoId: string | null;
  vinculoTexto: string;
}

export const ITEM_VACIO: ItemForm = {
  cantidad: "1",
  unidadMedida: "",
  descripcion: "",
  valorUnitario: "",
  vinculo: "",
  consumibleId: null,
  equipoId: null,
  vinculoTexto: "",
};

/**
 * Número escrito a la chilena: «12,5» → 12.5; «12.500» o «$ 12.500» → 12500
 * (punto de miles); «2.5» → 2.5. Vacío o inválido → null.
 */
export function leerNumero(v: string): number | null {
  let t = String(v ?? "").trim().replace(/[\s$]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Pesos chilenos sin decimales: 138960 → «$138.960». */
export const pesos = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
