/**
 * Avisos, plazos y despacho · reglas PURAS (sin BD), probadas en
 * reglas-avisos.spec.ts. Contrato: docs/FLUJO_AVISOS_DESPACHO_OFICIO.md.
 */

export type Severidad = "info" | "warn" | "alta";
export type EstadoCorreo = "no_aplica" | "enviado" | "error" | "sin_correo" | "sin_configurar";

/** Tipos de aviso y su severidad por defecto. */
export const TIPOS_AVISO = {
  ot_vencida: "alta",
  ot_por_vencer: "warn",
  no_cumple: "alta",
  contaminado: "alta",
  documento_listo: "info",
  despacho: "warn",
  plazo_asignado: "info",
  oficio_firma: "warn",
  oficio_firmado: "info",
  oficio_devuelto: "alta",
} as const satisfies Record<string, Severidad>;
export type TipoAviso = keyof typeof TIPOS_AVISO;

/* ------------------------------------------------------------ parámetros --- */

export interface ConfigAvisos {
  diasPorVencer: number;
  revisionAutomatica: boolean;
  enviarCorreo: boolean;
  noCumpleAlCliente: boolean;
  documentoListo: boolean;
}

export const CONFIG_AVISOS_DEFECTO: ConfigAvisos = {
  diasPorVencer: 3,
  revisionAutomatica: true,
  enviarCorreo: true,
  noCumpleAlCliente: false,
  documentoListo: true,
};

const siNo = (v: string | null | undefined, d: boolean) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (["si", "sí", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return d;
};

/** Lee la categoría `avisos` de parametro_sistema (filas inactivas = valor por defecto). */
export function configAvisos(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigAvisos {
  const d = CONFIG_AVISOS_DEFECTO;
  const v = (c: string) => filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? null;
  const dias = Number.parseInt(String(v("dias_por_vencer") ?? ""), 10);
  return {
    diasPorVencer: Number.isInteger(dias) && dias >= 1 && dias <= 30 ? dias : d.diasPorVencer,
    revisionAutomatica: siNo(v("revision_automatica"), d.revisionAutomatica),
    enviarCorreo: siNo(v("enviar_correo"), d.enviarCorreo),
    noCumpleAlCliente: siNo(v("no_cumple_al_cliente"), d.noCumpleAlCliente),
    documentoListo: siNo(v("documento_listo"), d.documentoListo),
  };
}

/* ---------------------------------------------------------------- plazos --- */

/** Días entre dos fechas AAAA-MM-DD (b − a), sin horas ni zona. */
export function diasEntre(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/**
 * Aviso de plazo de una OT abierta (EP-00 6.2): «vencida» si la fecha de
 * compromiso ya pasó (hoy en Chile), «por_vencer» si vence hoy o dentro de N
 * días; null si no corresponde avisar.
 */
export function avisoDePlazo(fechaCompromiso: string | null, hoy: string, diasPorVencer: number): "vencida" | "por_vencer" | null {
  if (!fechaCompromiso) return null;
  const d = diasEntre(hoy, fechaCompromiso.slice(0, 10));
  if (d < 0) return "vencida";
  if (d <= diasPorVencer) return "por_vencer";
  return null;
}

/**
 * Recepción del informe en DCO (EP-00 6.3, §5.5): d = recepción DCO − fecha de
 * compromiso. d > 0 «Terminado fuera de plazo» con d días de atraso; d ≤ 0
 * «Terminado dentro de plazo» (a favor |d|). Sin fecha de compromiso no hay atraso.
 */
export function atrasoRecepcionDco(recepcion: string, fechaCompromiso: string | null): { dias: number; estado: string; texto: string } {
  if (!fechaCompromiso) return { dias: 0, estado: "Terminado sin plazo", texto: "La OT no tenía fecha de compromiso." };
  const d = diasEntre(fechaCompromiso.slice(0, 10), recepcion.slice(0, 10));
  if (d > 0) return { dias: d, estado: "Terminado fuera de plazo", texto: `${d} día${d === 1 ? "" : "s"} de atraso` };
  const f = -d;
  return { dias: 0, estado: "Terminado dentro de plazo", texto: f ? `${f} día${f === 1 ? "" : "s"} a favor` : "justo en el plazo" };
}

/** Error de validación de la fecha de recepción en DCO (≥ fecha de la OT, no futura). */
export function errorFechaRecepcionDco(recepcion: string, fechaOt: string | null, hoy: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recepcion)) return "Indique la fecha de recepción en DCO (AAAA-MM-DD).";
  if (diasEntre(hoy, recepcion) > 0) return "La fecha de recepción en DCO no puede ser futura.";
  if (fechaOt && diasEntre(fechaOt.slice(0, 10), recepcion) < 0) return "La fecha de recepción en DCO no puede ser anterior a la fecha de la OT.";
  return null;
}

/* ------------------------------------------------------- resultados (§4.2.6) --- */

/**
 * ¿El resultado aprobado merece un aviso? «Contaminado» si el texto del
 * resultado lo dice (microbiología: presencia, contaminado) y es No cumple;
 * «No cumple» si su veredicto lo es. Lo demás no avisa.
 */
export function alertaDeResultado(r: { veredicto: string | null; valorTexto?: string | null; observacion?: string | null }): "no_cumple" | "contaminado" | null {
  if (r.veredicto !== "no_cumple") return null;
  const t = `${r.valorTexto ?? ""} ${r.observacion ?? ""}`.toLowerCase();
  return /contaminad|presencia/.test(t) ? "contaminado" : "no_cumple";
}

/* --------------------------------------------------------------- despacho --- */

export const DESTINOS_DESPACHO = ["DCO", "LAB_SOLICITANTE", "BPCH", "CLIENTE"] as const;
export type DestinoDespacho = (typeof DESTINOS_DESPACHO)[number];
export const NOMBRE_DESTINO: Record<DestinoDespacho, string> = {
  DCO: "Departamento Comercial (DCO)",
  LAB_SOLICITANTE: "Laboratorio solicitante",
  BPCH: "Banco de Pruebas (BPCH)",
  CLIENTE: "Cliente",
};

/**
 * Destino que se propone al despachar (EP-01 6.3): una OT interna o
 * interlaboratorio vuelve al laboratorio solicitante; un documento de una OT
 * del BPCH va al BPCH si el laboratorio no es del BPCH (LME para el BPCH); lo
 * demás, al DCO, que lo entrega al cliente.
 */
export function destinoSugerido(o: { origen: string | null; ramaBpch: boolean; solicitaBpch: boolean }): DestinoDespacho {
  const origen = String(o.origen ?? "").toUpperCase();
  if (origen === "OT_INTERNA" || origen === "INTERLABORATORIO") return "LAB_SOLICITANTE";
  if (o.solicitaBpch && !o.ramaBpch) return "BPCH";
  return "DCO";
}

/** Errores del despacho (solo documentos oficiales, una vez; ejemplares 1–50). */
export function erroresDespacho(d: {
  estado: string;
  yaDespachado: boolean;
  destino: string;
  ejemplares: number;
  fecha: string;
  hoy: string;
  unidadDestino?: string | null;
}): string[] {
  const e: string[] = [];
  if (!["oficial", "emitido"].includes(d.estado)) e.push("Solo se despacha un documento oficial (con todas sus firmas).");
  if (d.yaDespachado) e.push("El documento ya fue despachado.");
  if (!(DESTINOS_DESPACHO as readonly string[]).includes(d.destino)) e.push("Elija el destino del despacho.");
  if (d.destino === "LAB_SOLICITANTE" && !d.unidadDestino) e.push("Indique el laboratorio solicitante.");
  if (!Number.isInteger(d.ejemplares) || d.ejemplares < 1 || d.ejemplares > 50) e.push("El número de ejemplares va de 1 a 50.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) e.push("Indique la fecha de despacho.");
  else if (diasEntre(d.hoy, d.fecha) > 0) e.push("La fecha de despacho no puede ser futura.");
  return e;
}

/* ---------------------------------------------------------- oficio requerido --- */

/**
 * ¿Este documento necesita un oficio conductor firmado para entregarse?
 * (EP-05 7.2: obligatorio para IVC, Informe Técnico y Rechazo en el DSA; los
 * tipos y departamentos son parámetros por confirmar.)
 */
export function exigeOficio(tipoDocumento: string | null, departamento: string | null, cfg: { tipos: string[]; departamentos: string[] }): boolean {
  if (!tipoDocumento || !departamento) return false;
  return cfg.tipos.includes(tipoDocumento) && cfg.departamentos.includes(departamento);
}

/* ---------------------------------------------------------------- correo --- */

/** Estado del correo de un aviso según qué pasó al enviarlo. */
export function estadoCorreo(o: { quiere: boolean; destinatarios: number; error: string | null }): EstadoCorreo {
  if (!o.quiere) return "no_aplica";
  if (!o.destinatarios) return "sin_correo";
  if (!o.error) return "enviado";
  return /configuraci[oó]n de correo|inactiva|host SMTP/i.test(o.error) ? "sin_configurar" : "error";
}

/** Correos válidos y sin repetir (los usuarios sin correo se omiten). */
export function correosValidos(lista: (string | null | undefined)[]): string[] {
  const re = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
  return [...new Set(lista.map((c) => String(c ?? "").trim().toLowerCase()).filter((c) => re.test(c)))];
}
