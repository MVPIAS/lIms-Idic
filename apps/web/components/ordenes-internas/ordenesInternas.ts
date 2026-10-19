/**
 * Órdenes internas · tipos y textos compartidos por la ficha de la OT y la
 * pantalla «Órdenes internas». API: /ordenes-internas (docs/FLUJO_LABORATORIO.md).
 */
export interface EnsayoRef { id: string; codigo: string; nombre: string }

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
  otUnidadCodigo: string | null;
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
  abierta: { texto: "Abierta", pill: "amber" },
  recibida: { texto: "Recibida", pill: "blue" },
  cerrada: { texto: "Cerrada", pill: "green" },
  anulada: { texto: "Anulada", pill: "red" },
};

export const TIPO_OI: Record<string, string> = {
  interna: "Derivación a otro laboratorio",
  generica_interna: "Genérica interna",
  muestreo: "Muestreo",
};

/** Siguiente paso del ciclo (abierta → recibida → cerrada) con el texto del botón. */
export const SIGUIENTE_OI: Record<string, { estado: string; boton: string } | undefined> = {
  abierta: { estado: "recibida", boton: "Marcar recibida" },
  recibida: { estado: "cerrada", boton: "Cerrar" },
};

export const ACCION_HISTORIAL_OI: Record<string, string> = {
  creada: "Creada",
  editada: "Editada",
  estado: "Cambio de estado",
  anulada: "Anulada",
  eliminada: "Borrada",
};

export const destinoTexto = (o: Pick<OrdenInterna, "destinoUnidadCodigo" | "destinoNombre">) =>
  o.destinoUnidadCodigo ? `${o.destinoUnidadCodigo} · ${o.destinoNombre ?? ""}` : o.destinoNombre ?? "Sin laboratorio de destino";
