/**
 * Órdenes internas · tipos y textos compartidos por la ficha de la OT, la
 * pantalla «Órdenes internas» y la ficha de cada orden.
 * API: /ordenes-internas (docs/FLUJO_LABORATORIO.md › «Órdenes internas»).
 */
export interface EnsayoRef { id: string; codigo: string; nombre: string }

export interface ResultadoDerivado {
  id: string;
  ensayoId: string;
  ensayo: string;
  analito: string | null;
  muestra: string;
  estado: string | null;
  valor: number | null;
  texto: string | null;
  observacion: string | null;
  unidad: string | null;
}

export interface OrdenInterna {
  id: string;
  numero: string;
  tipo: string;
  estado: "abierta" | "recibida" | "cerrada" | "anulada";
  detalle: string | null;
  ensayos: string[];
  otId: string;
  otCodigo: string;
  otEstado: string | null;
  otUnidadId?: string | null;
  otUnidadCodigo: string | null;
  otUnidadNombre?: string | null;
  destinoLab: string | null;
  destinoNombre: string | null;
  destinoUnidadId: string | null;
  destinoUnidadCodigo: string | null;
  destinoUnidadNombre: string | null;
  creadaPor: string | null;
  createdAt: string;
  updatedAt: string | null;
  anuladaAt: string | null;
  motivoAnulacion: string | null;
  nEnsayos: number;
  ensayosDetalle: EnsayoRef[];
  // Emisión (EP-01 2.2)
  muestraId: string | null;
  muestraCodigo: string | null;
  muestraNombre?: string | null;
  requisito: string | null;
  fechaEnvio: string | null;
  ieReferencia: string | null;
  origenBpch: string | null;
  // Recepción, respuesta y cierre por el destino (EP-01 0.6, 5.5)
  recibidaAt: string | null;
  recibidaPorNombre: string | null;
  respuestaNumero: string | null;
  respuestaInforme: string | null;
  respuestaHoras: number | null;
  respuestaInsumos: string | null;
  costoDirecto: number | null;
  respondidaAt: string | null;
  respondidaPorNombre: string | null;
  cerradaAt: string | null;
  cerradaPorNombre: string | null;
  // Vuelta al solicitante (EP-01 3.7)
  aceptadaAt: string | null;
  aceptadaPorNombre: string | null;
  aceptadaObservacion: string | null;
  // Solo en la ficha
  paso?: number;
  resultados?: ResultadoDerivado[];
  faltantesCierre?: string[];
  respuestaNumeroPropuesto?: string | null;
  costoDirectoOt?: number;
  historial?: { id: string; accion: string; detalle: any; createdAt: string; usuarioNombre: string | null }[];
}

export interface DestinoOi {
  id: string;
  codsucdel: string;
  nombre: string;
  unidadId: string;
  unidadCodigo: string;
  unidadNombre: string;
  ensayos: number;
}

export const ESTADO_OI: Record<string, { texto: string; pill: string }> = {
  abierta: { texto: "Emitida · por recibir", pill: "amber" },
  recibida: { texto: "Recibida · en análisis", pill: "blue" },
  cerrada: { texto: "Cerrada · informe devuelto", pill: "green" },
  anulada: { texto: "Anulada", pill: "red" },
};

/** Estado legible con el matiz de la respuesta y de la vuelta al solicitante. */
export function estadoOi(o: Pick<OrdenInterna, "estado" | "respondidaAt" | "aceptadaAt">): { texto: string; pill: string } {
  if (o.estado === "recibida" && o.respondidaAt) return { texto: "Respondida · por cerrar", pill: "teal" };
  if (o.estado === "cerrada" && o.aceptadaAt) return { texto: "Integrada por el solicitante", pill: "green" };
  return ESTADO_OI[o.estado] ?? { texto: o.estado, pill: "gray" };
}

export const TIPO_OI: Record<string, string> = {
  interna: "Derivación a otro laboratorio",
  generica_interna: "Genérica interna",
  muestreo: "Muestreo",
};

/** Los 5 pasos del procedimiento (EP-01 2.2 → 0.6 → 5.5 → 3.7). */
export const PASOS_OI = [
  { n: 1, titulo: "Emitida", quien: "Laboratorio solicitante" },
  { n: 2, titulo: "Recibida", quien: "Laboratorio de destino" },
  { n: 3, titulo: "Respondida", quien: "Laboratorio de destino" },
  { n: 4, titulo: "Cerrada · informe devuelto", quien: "Laboratorio de destino" },
  { n: 5, titulo: "Dada por recibida", quien: "Laboratorio solicitante" },
] as const;

export const ACCION_HISTORIAL_OI: Record<string, string> = {
  creada: "Emitida",
  editada: "Editada",
  estado: "Cambio de estado",
  recibida: "Recibida por el destino",
  respondida: "Respuesta guardada",
  respuesta_corregida: "Respuesta corregida",
  cerrada: "Cerrada · informe devuelto",
  dada_por_recibida: "Dada por recibida por el solicitante",
  anulada: "Anulada",
  eliminada: "Borrada",
};

export const destinoTexto = (o: Pick<OrdenInterna, "destinoUnidadCodigo" | "destinoNombre">) =>
  o.destinoUnidadCodigo ? `${o.destinoUnidadCodigo} · ${o.destinoNombre ?? ""}` : o.destinoNombre ?? "Sin laboratorio de destino";

export const pesos = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$ ${Math.round(n).toLocaleString("es-CL")}`;

/** «AAAA-MM-DD» → «DD-MM-AAAA» sin pasar por Date (la zona horaria no cambia el día). */
export const fechaDia = (s: string | null | undefined) => {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
