/**
 * Circuito de la cotización · reglas PURAS (circuito-cotizacion.spec.ts).
 * Contrato: docs/FLUJO_COTIZACION_ENCUESTAS.md · EP-00 pasos 2.3–2.8, 3.4 y 4.1.
 *
 *   1 Elaboración (Ejecutivo) → 2 Costeo del laboratorio (Jefe de Laboratorio:
 *   FORM06 + FORM05) → 3 V°B° del laboratorio y del departamento → 4 Firma del
 *   Jefe DCO (matriz COTIZACION) → 5 Envío al cliente → 6 Aceptación y OT.
 *
 * Como la «Ruta de la OT» (ot/avance-ot.ts), la etapa NO se guarda: se deduce
 * de lo que existe, y una sola función da la barra y el «Siguiente paso · Le
 * toca a».
 */

/* --------------------------------------------------------------- solicitud --- */

export type EstadoSolicitud =
  | "solicitado"
  | "respondido"
  | "vb_lab"
  | "aprobado"
  | "devuelto"
  | "rechazado"
  // heredados del costeo D2 (sin circuito): no bloquean ni cuentan
  | "estimado"
  | "consolidado";

export type NivelesVb = "lab_depto" | "lab" | "ninguno";
export type RespuestaLab = "aceptar" | "aceptar_con_comentario" | "rechazar";
export type NivelVb = "lab" | "depto";

export const ETIQUETA_SOLICITUD: Record<string, string> = {
  solicitado: "Solicitada al laboratorio",
  respondido: "Respondida · espera V°B° del laboratorio",
  vb_lab: "Con V°B° del laboratorio · espera V°B° del departamento",
  aprobado: "Con V°B°",
  devuelto: "Devuelta al laboratorio",
  rechazado: "El laboratorio no realiza el servicio",
  estimado: "Estimación (sin circuito)",
  consolidado: "Consolidada (sin circuito)",
};

export function nivelesVb(valor: string | null | undefined): NivelesVb {
  const v = String(valor ?? "").trim().toLowerCase();
  return v === "lab" || v === "ninguno" ? v : "lab_depto";
}

export const siNo = (valor: string | null | undefined, def: boolean): boolean => {
  const v = String(valor ?? "").trim().toLowerCase();
  if (["si", "sí", "true", "1", "s"].includes(v)) return true;
  if (["no", "false", "0", "n"].includes(v)) return false;
  return def;
};

/** El laboratorio responde (o vuelve a responder) solo una solicitud pendiente o devuelta. */
export const puedeResponder = (estado: string) => estado === "solicitado" || estado === "devuelto";

/** Estado de la solicitud tras la respuesta del laboratorio. */
export function estadoTrasRespuesta(respuesta: RespuestaLab, niveles: NivelesVb): EstadoSolicitud {
  if (respuesta === "rechazar") return "rechazado";
  return niveles === "ninguno" ? "aprobado" : "respondido";
}

/** Nivel de V°B° que falta en la solicitud (null = ninguno). */
export function nivelVbPendiente(estado: string, niveles: NivelesVb): NivelVb | null {
  if (niveles === "ninguno") return null;
  if (estado === "respondido") return "lab";
  if (estado === "vb_lab" && niveles === "lab_depto") return "depto";
  return null;
}

/** Estado tras dar o devolver el V°B° de un nivel. */
export function estadoTrasVb(nivel: NivelVb, niveles: NivelesVb, accion: "dar" | "devolver"): EstadoSolicitud {
  if (accion === "devolver") return "devuelto";
  if (nivel === "lab" && niveles === "lab_depto") return "vb_lab";
  return "aprobado";
}

/** Solicitudes que forman parte del circuito (con laboratorio; las heredadas D2 no cuentan). */
export interface SolicitudCircuito {
  id: string;
  estado: string;
  unidad: string | null;
  numero?: string | null;
}
const delCircuito = (s: SolicitudCircuito[]) => s.filter((x) => x.unidad && !["estimado", "consolidado"].includes(x.estado));
const nombreSol = (s: SolicitudCircuito) => `${s.numero ? `${s.numero} · ` : ""}${s.unidad ?? "laboratorio"}`;

/* ------------------------------------------------------------- cotización --- */

export type FirmaEstado = "pendiente" | "firmada" | "devuelta" | null;

export interface CotizacionCircuito {
  codigo: string;
  estado: string;
  /** historico (anterior al circuito) | r1 */
  circuito: string | null;
  firmaEstado: FirmaEstado;
  lineas: number;
}

export interface ConfigCircuito {
  niveles: NivelesVb;
  exigirConsulta: boolean;
  exigirFirma: boolean;
}

/** ¿Se puede editar el contenido? No mientras está en firma ni ya firmada. */
export function motivoNoEditable(firmaEstado: FirmaEstado): string | null {
  if (firmaEstado === "pendiente")
    return "La cotización está en firma del Jefe DCO: no se puede editar. Pida que se la devuelvan si necesita corregirla.";
  if (firmaEstado === "firmada")
    return "La cotización ya está firmada (emitida): no se puede editar. Si el cliente pide cambios, anúlela y emita otra.";
  return null;
}

/**
 * Lo que falta para enviar a firma (y para firmar): Abierta, en elaboración o
 * devuelta, con líneas, y cada consulta al laboratorio con su V°B° completo.
 */
export function faltantesParaFirma(c: CotizacionCircuito, solicitudes: SolicitudCircuito[], cfg: ConfigCircuito, etapa: "enviar" | "firmar"): string[] {
  const f: string[] = [];
  if (c.estado !== "abierta") f.push(`La cotización ${c.codigo} no está Abierta (está «${c.estado}»).`);
  if (etapa === "enviar" && c.firmaEstado === "pendiente") f.push("Ya está enviada a firma del Jefe DCO.");
  if (etapa === "enviar" && c.firmaEstado === "firmada") f.push("Ya está firmada.");
  if (etapa === "firmar" && c.firmaEstado !== "pendiente") f.push("La cotización no está enviada a firma: el ejecutivo debe enviarla primero.");
  if (c.lineas < 1) f.push("La cotización no tiene líneas.");
  const sol = delCircuito(solicitudes);
  for (const s of sol) {
    if (s.estado === "rechazado") f.push(`El laboratorio ${s.unidad} indicó que no realiza el servicio (${nombreSol(s)}): retire la solicitud o anule la cotización.`);
    else if (s.estado !== "aprobado") f.push(`Falta la respuesta o el V°B° de ${nombreSol(s)} (${ETIQUETA_SOLICITUD[s.estado] ?? s.estado}).`);
  }
  if (cfg.exigirConsulta && !sol.some((s) => s.estado === "aprobado"))
    f.push("Debe consultar al laboratorio (fechas y costo) y contar con su V°B° antes de la firma.");
  return f;
}

/** Regla de aceptación: una cotización del circuito nuevo se acepta firmada (si así está configurado). */
export function motivoNoAceptable(c: CotizacionCircuito, cfg: ConfigCircuito): string | null {
  if (!cfg.exigirFirma || c.circuito !== "r1") return null;
  if (c.firmaEstado === "firmada") return null;
  return `La cotización ${c.codigo} aún no está firmada por el Jefe del Departamento Comercial: no se puede registrar la aceptación. Envíela a firma y, una vez firmada, envíela al cliente.`;
}

/** ¿Se puede enviar al cliente? Firmada (o histórica) y Abierta o Aceptada. */
export function motivoNoEnviable(c: CotizacionCircuito): string | null {
  if (!["abierta", "aceptada"].includes(c.estado)) return `La cotización ${c.codigo} está «${c.estado}»: no se envía al cliente.`;
  if (c.circuito === "r1" && c.firmaEstado !== "firmada")
    return `La cotización ${c.codigo} aún no está firmada por el Jefe DCO: solo se envía al cliente una cotización firmada.`;
  return null;
}

/* ------------------------------------------------------------------- ruta --- */

export type EstadoEtapa = "hecho" | "en_curso" | "pendiente" | "no_aplica" | "bloqueado";
export type PestanaCot = "datos" | "laboratorio" | "documento" | "envio" | "aceptacion" | "bitacora";

export interface Etapa { clave: string; titulo: string; estado: EstadoEtapa; detalle: string | null }
export interface LeToca { rol: string; unidad: string | null; personas: string[] }
export interface Accion { texto: string; pestana: PestanaCot; permisos: string[]; usuarios?: string[]; unidadId?: string | null }
export interface Siguiente { etapa: string; texto: string; leToca: LeToca | null; accion: Accion | null }

export interface SolicitudRuta extends SolicitudCircuito {
  unidadId: string | null;
  /** Responsables del V°B° pendiente (si lo hay). */
  vb?: { nivel: NivelVb; rol: string; unidad: string | null; personas: { id: string; nombre: string }[] } | null;
}

export interface HechosCotizacion extends CotizacionCircuito {
  firmaDevueltaMotivo?: string | null;
  firmadaPor?: string | null;
  enviadaAt?: Date | string | null;
  enviadaMedio?: string | null;
  ot?: { codigo: string } | null;
  solicitudes: SolicitudRuta[];
  /** Responsables del paso FIRMA de la matriz COTIZACION. */
  firmantes: { id: string; nombre: string }[];
}

export interface RutaCotizacion {
  etapas: Etapa[];
  etapaActual: string | null;
  siguiente: Siguiente | null;
  avisos: string[];
}

const et = (clave: string, titulo: string, estado: EstadoEtapa, detalle?: string | null): Etapa => ({ clave, titulo, estado, detalle: detalle ?? null });
const EJECUTIVO: LeToca = { rol: "Ejecutivo de Ventas", unidad: "SVT", personas: [] };

export function calcularRutaCotizacion(h: HechosCotizacion, cfg: ConfigCircuito): RutaCotizacion {
  const avisos: string[] = [];
  const sol = delCircuito(h.solicitudes) as SolicitudRuta[];
  const cerrada = ["anulada", "expirada", "rechazada"].includes(h.estado);
  const aceptada = h.estado === "aceptada";
  const historica = h.circuito !== "r1";

  // 2 · Costeo
  const respondidas = sol.filter((s) => !["solicitado", "devuelto"].includes(s.estado));
  const costeo: Etapa = !sol.length
    ? et("costeo", "Costeo del laboratorio", cfg.exigirConsulta && !historica && !aceptada ? "pendiente" : "no_aplica", cfg.exigirConsulta ? "Sin consulta al laboratorio" : "Sin consulta al laboratorio (opcional)")
    : et(
        "costeo",
        "Costeo del laboratorio",
        respondidas.length === sol.length ? "hecho" : respondidas.length ? "en_curso" : "pendiente",
        `${respondidas.length} de ${sol.length} ${sol.length === 1 ? "respondida" : "respondidas"}`,
      );

  // 3 · V°B°
  const rechazadas = sol.filter((s) => s.estado === "rechazado");
  const aprobadas = sol.filter((s) => s.estado === "aprobado");
  const vb: Etapa =
    !sol.length || cfg.niveles === "ninguno"
      ? et("vb", "V°B° laboratorio y departamento", "no_aplica", cfg.niveles === "ninguno" ? "No exigido (configuración)" : null)
      : rechazadas.length
        ? et("vb", "V°B° laboratorio y departamento", "bloqueado", `${rechazadas.map((s) => s.unidad).join(", ")} no realiza el servicio`)
        : et(
            "vb",
            "V°B° laboratorio y departamento",
            aprobadas.length === sol.length ? "hecho" : sol.some((s) => ["respondido", "vb_lab", "aprobado"].includes(s.estado)) ? "en_curso" : "pendiente",
            `${aprobadas.length} de ${sol.length} con V°B°`,
          );

  // 4 · Firma
  const firma: Etapa = historica
    ? et("firma", "Firma del Jefe DCO", "no_aplica", "Cotización anterior al circuito de firma")
    : h.firmaEstado === "firmada"
      ? et("firma", "Firma del Jefe DCO", "hecho", h.firmadaPor ? `Firmada por ${h.firmadaPor}` : "Firmada")
      : h.firmaEstado === "pendiente"
        ? et("firma", "Firma del Jefe DCO", "en_curso", "En firma")
        : h.firmaEstado === "devuelta"
          ? et("firma", "Firma del Jefe DCO", "bloqueado", `Devuelta${h.firmaDevueltaMotivo ? `: ${h.firmaDevueltaMotivo}` : ""}`)
          : et("firma", "Firma del Jefe DCO", "pendiente", null);

  // 5 · Envío
  const envio: Etapa = h.enviadaAt
    ? et("envio", "Envío al cliente", "hecho", h.enviadaMedio ? `Por ${TEXTO_MEDIO[h.enviadaMedio] ?? h.enviadaMedio}` : "Enviada")
    : aceptada || cerrada
      ? et("envio", "Envío al cliente", "no_aplica", "Sin registro de envío")
      : et("envio", "Envío al cliente", "pendiente", null);

  // 6 · Aceptación
  const aceptacion: Etapa = aceptada
    ? et("aceptacion", "Aceptación y OT", "hecho", h.ot ? `OT ${h.ot.codigo}` : "Aceptada")
    : h.estado === "anulada"
      ? et("aceptacion", "Aceptación y OT", "no_aplica", "Anulada")
      : h.estado === "expirada"
        ? et("aceptacion", "Aceptación y OT", "bloqueado", "Vencida: ya no se puede aceptar")
        : et("aceptacion", "Aceptación y OT", "pendiente", null);

  // Una cotización aceptada o cerrada no deja pasos atrás «pendientes».
  const cerrar = (e: Etapa): Etapa => ((aceptada || cerrada) && e.estado !== "hecho" && e.estado !== "no_aplica" ? { ...e, estado: "no_aplica" } : e);
  const etapas: Etapa[] = [
    et("elaboracion", "Elaboración", h.lineas > 0 ? "hecho" : "en_curso", `${h.lineas} ${h.lineas === 1 ? "línea" : "líneas"}`),
    cerrar(costeo),
    cerrar(vb),
    cerrar(firma),
    envio,
    aceptacion,
  ];

  if (h.estado === "anulada") avisos.push("La cotización está anulada.");
  if (h.estado === "expirada") avisos.push("La cotización venció: no se puede aceptar. Emita una nueva o anúlela.");
  if (rechazadas.length && !cerrada && !aceptada)
    avisos.push(`El laboratorio ${rechazadas.map((s) => s.unidad).join(", ")} indicó que no realiza el servicio.`);

  const actual = etapas.find((e) => e.estado !== "hecho" && e.estado !== "no_aplica") ?? null;
  return { etapas, etapaActual: actual?.clave ?? null, siguiente: cerrada || !actual ? null : siguiente(actual.clave, h, sol, cfg), avisos };
}

export const TEXTO_MEDIO: Record<string, string> = {
  correo: "correo electrónico",
  mano: "entrega en mano",
  courier: "courier",
  oficio: "oficio",
};

function siguiente(clave: string, h: HechosCotizacion, sol: SolicitudRuta[], cfg: ConfigCircuito): Siguiente | null {
  const nombre = (s: SolicitudRuta) => nombreSol(s);
  if (clave === "elaboracion")
    return { etapa: clave, texto: "Agregar las líneas de la cotización", leToca: EJECUTIVO, accion: { texto: "Ir a Datos", pestana: "datos", permisos: ["cotizacion.crear"] } };
  if (clave === "costeo") {
    const pend = sol.find((s) => s.estado === "solicitado" || s.estado === "devuelto");
    if (!pend)
      return {
        etapa: clave,
        texto: "Solicitar fechas y costo al laboratorio",
        leToca: EJECUTIVO,
        accion: { texto: "Ir a Laboratorio", pestana: "laboratorio", permisos: ["cotizacion.crear"] },
      };
    return {
      etapa: clave,
      texto: `${pend.estado === "devuelto" ? "Corregir y volver a responder" : "Responder"} ${nombre(pend)}: programa de trabajo${pend.numero ? " y formulario de costeo" : " y fechas"}`,
      leToca: { rol: "Jefe de Laboratorio", unidad: pend.unidad, personas: [] },
      accion: { texto: "Responder", pestana: "laboratorio", permisos: ["cotizacion.costear"], unidadId: pend.unidadId },
    };
  }
  if (clave === "vb") {
    const rech = sol.find((s) => s.estado === "rechazado");
    if (rech)
      return {
        etapa: clave,
        texto: `${rech.unidad} no realiza el servicio: retire esa solicitud (y consulte a otro laboratorio) o anule la cotización`,
        leToca: EJECUTIVO,
        accion: { texto: "Ir a Laboratorio", pestana: "laboratorio", permisos: ["cotizacion.crear"] },
      };
    const s = sol.find((x) => nivelVbPendiente(x.estado, cfg.niveles));
    if (s) {
      const nivel = nivelVbPendiente(s.estado, cfg.niveles) as NivelVb;
      const personas = s.vb?.personas ?? [];
      return {
        etapa: clave,
        texto: `Dar el V°B° ${nivel === "lab" ? "del laboratorio" : "del departamento"} a ${nombre(s)}`,
        leToca: {
          rol: s.vb?.rol ?? (nivel === "lab" ? "Jefe de Laboratorio" : "Jefe de Departamento"),
          unidad: s.vb?.unidad ?? s.unidad,
          personas: personas.map((p) => p.nombre),
        },
        accion: { texto: "Ir a V°B°", pestana: "laboratorio", permisos: ["cotizacion.vb"], usuarios: personas.map((p) => p.id) },
      };
    }
    // Aún falta la respuesta de algún laboratorio: el paso es el del costeo.
    return siguiente("costeo", h, sol, cfg);
  }
  if (clave === "firma") {
    if (h.firmaEstado === "pendiente")
      return {
        etapa: clave,
        texto: `Revisar y firmar la cotización ${h.codigo}`,
        leToca: { rol: "Jefe del Departamento Comercial", unidad: "DCO", personas: h.firmantes.map((p) => p.nombre) },
        accion: { texto: "Ir a Documento y firma", pestana: "documento", permisos: ["cotizacion.firmar"], usuarios: h.firmantes.map((p) => p.id) },
      };
    return {
      etapa: clave,
      texto: h.firmaEstado === "devuelta" ? "Corregir lo observado y volver a enviar a firma del Jefe DCO" : "Revisar la vista previa y enviar a firma del Jefe DCO",
      leToca: EJECUTIVO,
      accion: { texto: "Ir a Documento y firma", pestana: "documento", permisos: ["cotizacion.crear"] },
    };
  }
  if (clave === "envio")
    return { etapa: clave, texto: "Enviar la cotización firmada al cliente y registrar el envío", leToca: EJECUTIVO, accion: { texto: "Ir a Envío", pestana: "envio", permisos: ["cotizacion.crear"] } };
  if (clave === "aceptacion")
    return {
      etapa: clave,
      texto: "Registrar la aceptación del cliente (genera la OT)",
      leToca: EJECUTIVO,
      accion: { texto: "Ir a Aceptación", pestana: "aceptacion", permisos: ["cotizacion.aceptar"] },
    };
  return null;
}
