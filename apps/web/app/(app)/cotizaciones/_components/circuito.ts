"use client";

/**
 * Tipos de GET /cotizaciones/:id/circuito (apps/api/src/cotizacion/circuito.service.ts)
 * y textos del circuito de la cotización. Las reglas viven en el servidor
 * (circuito-cotizacion.ts): aquí solo se pinta lo que llega.
 */
export type EstadoEtapa = "hecho" | "en_curso" | "pendiente" | "no_aplica" | "bloqueado";
export type PestanaCot = "datos" | "laboratorio" | "documento" | "envio" | "aceptacion" | "bitacora";

export interface Etapa { clave: string; titulo: string; estado: EstadoEtapa; detalle: string | null }

export interface Solicitud {
  id: string;
  unidadId: string | null;
  unidadCodigo: string | null;
  unidadNombre: string | null;
  numero: string | null;
  tipoServicio: "estandar" | "no_estandar" | "comision" | null;
  estado: string;
  etiquetaEstado: string;
  comentarioEjecutivo: string | null;
  conCopia: string | null;
  solicitadaAt: string | null;
  solicitadaPorNombre: string | null;
  respuesta: string | null;
  comentarioLab: string | null;
  programa: { etapas: { actividad: string; inicio?: string | null; termino?: string | null; recursos?: string | null }[]; fechaInicio?: string | null; fechaTermino?: string | null; plazoEntregaDias: number; puntosEt?: string | null; numItems?: number | null } | null;
  costeo: any;
  plazoEntregaDias: number | null;
  respondidaAt: string | null;
  respondidaPorNombre: string | null;
  vbLabAt: string | null;
  vbLabPorNombre: string | null;
  vbLabComentario: string | null;
  vbDeptoAt: string | null;
  vbDeptoPorNombre: string | null;
  vbDeptoComentario: string | null;
  devueltaMotivo: string | null;
  vb: { nivel: "lab" | "depto"; rol: string; unidad: string | null; personas: { id: string; nombre: string }[] } | null;
  puedoResponder: boolean;
  puedoVb: boolean;
}

export interface Circuito {
  cotizacion: {
    id: string;
    codigo: string;
    estado: string;
    circuito: string | null;
    firmaEstado: "pendiente" | "firmada" | "devuelta" | null;
    firmaDevueltaMotivo: string | null;
    firmadaAt: string | null;
    firmadaPorNombre: string | null;
    firmaSolicitadaAt: string | null;
    enviadaAt: string | null;
    enviadaMedio: string | null;
    enviadaDestinatarios: string | null;
    envioObservacion: string | null;
    ejecutivoNombre: string | null;
    otCodigo: string | null;
  };
  config: { niveles: "lab_depto" | "lab" | "ninguno"; exigirConsulta: boolean; exigirFirma: boolean; cfaPct: number; margenParticularPct: number; ivaPct?: number };
  ruta: {
    etapas: Etapa[];
    etapaActual: string | null;
    siguiente: {
      etapa: string;
      texto: string;
      leToca: { rol: string; unidad: string | null; personas: string[] } | null;
      accion: { texto: string; pestana: PestanaCot } | null;
      puedoActuar: boolean;
    } | null;
    avisos: string[];
  };
  solicitudes: Solicitud[];
  firmantes: string[];
  faltantesFirma: string[];
  eventos: { id: string; accion: string; comentario: string | null; detalle: any; createdAt: string; usuarioNombre: string | null; solicitudNumero: string | null; unidadCodigo: string | null }[];
  destinatarios: { nombre: string; cargo: string | null; email: string; principal: boolean }[];
  puedo: { solicitar: boolean; enviarAFirma: boolean; firmar: boolean; enviarCliente: boolean };
}

/** Pestaña de la ficha que corresponde a cada etapa de la barra. */
export const PESTANA_DE_ETAPA: Record<string, PestanaCot> = {
  elaboracion: "datos",
  costeo: "laboratorio",
  vb: "laboratorio",
  firma: "documento",
  envio: "envio",
  aceptacion: "aceptacion",
};

export const PILL_SOLICITUD: Record<string, string> = {
  solicitado: "amber",
  respondido: "blue",
  vb_lab: "blue",
  aprobado: "green",
  devuelto: "red",
  rechazado: "red",
};

export const TEXTO_EVENTO: Record<string, string> = {
  solicitud: "Solicitó fechas y costo al laboratorio",
  solicitud_retirada: "Retiró la solicitud al laboratorio",
  respuesta_laboratorio: "El laboratorio respondió (programa y costeo)",
  laboratorio_rechaza: "El laboratorio indicó que no realiza el servicio",
  vb_lab: "V°B° del laboratorio",
  vb_depto: "V°B° del departamento",
  vb_lab_devuelto: "El Jefe de Laboratorio devolvió la respuesta",
  vb_depto_devuelto: "El Jefe de Departamento devolvió la respuesta",
  enviada_a_firma: "Envió la cotización a firma del Jefe DCO",
  firmada: "Firmó la cotización (emitida)",
  firma_devuelta: "Devolvió la cotización al ejecutivo",
  enviada_cliente: "Registró el envío al cliente",
  envio_fallido: "Intento de envío por correo fallido",
  discrepancia_oc: "Aceptó con una O/C distinta de la cotización (discrepancia)",
  oc_conforme: "Comparó la O/C con la cotización: coincide",
  orden_cliente_anulada: "Anuló la orden del cliente",
  aceptada: "Registró la aceptación del cliente y generó la OT",
};

export const TEXTO_MEDIO: Record<string, string> = {
  correo: "Correo electrónico",
  mano: "Entrega en mano",
  courier: "Courier",
  oficio: "Oficio",
  oficina_partes: "Oficina de partes",
};
