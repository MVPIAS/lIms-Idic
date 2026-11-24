/**
 * Integración con el software de armas del BPCH · reglas PURAS (sin BD),
 * probadas en reglas-armas.spec.ts. Guía: docs/INTEGRACION_ARMAS_BPCH.md.
 *
 * Fuente: «Fases o etapas proceso de certificaciones armamento BPCH Apis.pdf»
 * (IDIC, 24-11-2026). Ciclo de la OT en el BPCH:
 *   1 Pendiente → 6 Visado Delegación → (7 Visado Internación) → 5 En firma FEA
 *   → 2 Firmada y en Comercial → 8 Finalizada; 3 Anulada. Un rechazo vuelve a 1
 *   con `motivo`.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { diaChile } from "../../common/fecha-chile";

/* ------------------------------------------------------------- estados --- */

export const ESTADOS_BPCH: Record<number, string> = {
  1: "Pendiente",
  6: "Visado Delegación",
  7: "Visado Internación",
  5: "En firma digital",
  2: "Firmada y en Comercial",
  8: "OT Finalizada",
  3: "Anulada",
};
export const ESTADOS_FINALES = [3, 8];

export type EfectoEstado = "rechazo" | "avance" | "firmada" | "finalizada" | "anulada";

/** Qué significa para el LIMS un estado del BPCH. */
export function efectoEstado(estado: number, motivo: string | null | undefined): EfectoEstado {
  if (estado === 1 && motivo && motivo.trim()) return "rechazo";
  if (estado === 2) return "firmada";
  if (estado === 8) return "finalizada";
  if (estado === 3) return "anulada";
  return "avance";
}

/** Descripción del estado: la que manda el BPCH o la del catálogo. */
export function descripcionEstado(estado: number, motivo?: string | null, enviada?: string | null): string {
  if (enviada && enviada.trim()) return enviada.trim().slice(0, 120);
  if (estado === 1 && motivo && motivo.trim()) return "Rechazada";
  return ESTADOS_BPCH[estado] ?? `Estado ${estado}`;
}

/* ----------------------------------------------------------------- RUT --- */

/** Dígito verificador de un RUT chileno (módulo 11). */
export function dvRut(cuerpo: string): string {
  let s = 0;
  let m = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    s += Number(cuerpo[i]) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (s % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

/**
 * RUT en el formato que pide el BPCH: «sin puntos ni guión». Su ejemplo
 * ("76192834") va SIN dígito verificador; por eso el DV es configurable
 * (parámetro integracion_armas.rut_con_dv, por defecto «no»). POR CONFIRMAR.
 * Acepta «76.192.834-5», «76192834-5», «761928345» (si conDv) o el cuerpo solo.
 */
export function rutParaBpch(rut: string | null | undefined, conDv: boolean): string | null {
  const limpio = String(rut ?? "").replace(/[.\s]/g, "").toUpperCase();
  if (!limpio) return null;
  let cuerpo: string;
  let dv: string | null = null;
  if (limpio.includes("-")) {
    const [c, d] = limpio.split("-");
    cuerpo = c;
    dv = d || null;
  } else {
    cuerpo = limpio;
  }
  if (!/^\d{6,9}$/.test(cuerpo)) return null;
  if (!conDv) return cuerpo;
  return cuerpo + (dv && /^[0-9K]$/.test(dv) ? dv : dvRut(cuerpo));
}

/* ------------------------------------------------------ payload de salida --- */

export interface DatosOtArmas {
  limsOtId: string;
  tipoOrden: 1 | 2;
  resolucionNumero: string | null;
  resolucionFecha: string | Date | null;
  solicitanteRut: string | null;
  solicitanteEmail: string | null;
  creadorRut: string | null;
  cantidadArmas: number | null;
  observaciones: string | null;
  adjuntos: { nombre: string; url: string }[];
}

export interface PayloadCrearOt {
  lims_ot_id: string;
  tipo_orden: 1 | 2;
  resolucion: { numero: string; fecha: string };
  solicitante: { rut: string; email: string | null };
  creador: { rut: string | null };
  cantidad_armas: number;
  observaciones: string;
  documentos_adjuntos: { nombre: string; url_descarga: string }[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha AAAA-MM-DD: un texto tal cual; un Date (DATE de la BD o instante) en el día de Chile (regla única de fechas). */
export function fechaIso(f: string | Date | null | undefined): string | null {
  if (!f) return null;
  if (typeof f === "string") return FECHA_ISO.test(f.slice(0, 10)) ? f.slice(0, 10) : null;
  if (Number.isNaN(f.getTime())) return null;
  return diaChile(f);
}

/** Construye el JSON del POST /ordenes-trabajo y devuelve los errores que impiden enviarlo. */
export function construirPayload(d: DatosOtArmas, conDv: boolean): { payload: PayloadCrearOt | null; errores: string[] } {
  const errores: string[] = [];
  const rut = rutParaBpch(d.solicitanteRut, conDv);
  const fecha = fechaIso(d.resolucionFecha);
  const email = d.solicitanteEmail?.trim() || null;
  if (!d.limsOtId?.trim()) errores.push("La OT no tiene código.");
  if (d.tipoOrden !== 1 && d.tipoOrden !== 2) errores.push("Tipo de orden inválido (1 = persona natural, 2 = empresa).");
  if (!d.resolucionNumero?.trim()) errores.push("Falta el número de la resolución (DGMN/IDIC).");
  if (!fecha) errores.push("Falta la fecha de la resolución o no es una fecha válida.");
  if (!rut) errores.push("Falta el RUT del solicitante o no es válido.");
  if (email && !EMAIL.test(email)) errores.push("El correo del solicitante no es válido.");
  if (!Number.isInteger(d.cantidadArmas) || (d.cantidadArmas ?? 0) <= 0) errores.push("La cantidad de armas debe ser un entero mayor que 0.");
  if (errores.length) return { payload: null, errores };
  return {
    payload: {
      lims_ot_id: d.limsOtId.trim(),
      tipo_orden: d.tipoOrden,
      resolucion: { numero: d.resolucionNumero!.trim(), fecha: fecha! },
      solicitante: { rut: rut!, email },
      creador: { rut: rutParaBpch(d.creadorRut, conDv) },
      cantidad_armas: d.cantidadArmas!,
      observaciones: (d.observaciones ?? "").slice(0, 4000),
      documentos_adjuntos: d.adjuntos.map((a) => ({ nombre: a.nombre, url_descarga: a.url })),
    },
    errores,
  };
}

/* ----------------------------------------------- respuesta del BPCH (envío) --- */

export type ResultadoEnvio = "enviado" | "duplicado" | "rechazado" | "reintentar";

/** 201 = creada; 409 = ya existía (se da por enviada); otros 4xx = error sin reintento; 5xx/408/429/red = reintento. */
export function clasificarRespuesta(status: number | null): ResultadoEnvio {
  if (status === 200 || status === 201) return "enviado";
  if (status === 409) return "duplicado";
  if (status === null || status === 408 || status === 429 || status >= 500) return "reintentar";
  return "rechazado";
}

/** `bpch_id` de la respuesta 201/409 (`data.bpch_id`). */
export function bpchIdDe(respuesta: any): number | null {
  const v = respuesta?.data?.bpch_id ?? respuesta?.bpch_id;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Espera antes del reintento n (1, 2, …): 1, 2, 4, 8… min, tope 6 h, con ±10 % de variación. */
export function esperaReintentoMs(intento: number, azar: number = Math.random()): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, intento - 1), 6 * 3_600_000);
  return Math.round(base * (0.9 + 0.2 * Math.min(1, Math.max(0, azar))));
}

/* ------------------------------------------------------------ firma HMAC --- */

/** Firma que enviaría el BPCH en X-BPCH-Signature: `sha256=<hex>` del cuerpo crudo. */
export function firmaHmac(cuerpo: Buffer | string, secreto: string): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo).digest("hex");
}

/** Compara la cabecera con la firma esperada en tiempo constante. Acepta «sha256=<hex>» o el hex solo. */
export function verificarHmac(cuerpo: Buffer | string | null | undefined, cabecera: string | null | undefined, secreto: string | null | undefined): boolean {
  if (!cuerpo || !cabecera || !secreto) return false;
  const recibido = String(cabecera).trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(recibido)) return false;
  const esperado = createHmac("sha256", secreto).update(cuerpo).digest("hex");
  return timingSafeEqual(Buffer.from(recibido, "hex"), Buffer.from(esperado, "hex"));
}

/* -------------------------------------------------- evento de estado (entrada) --- */

export interface DocumentoRecibido {
  nombre: string;
  tipo: string;
  descripcion: string | null;
  /** PDF en base64 (se guarda si guardar_acta_pdf = sí). */
  base64: string | null;
  /** O un enlace al documento en el BPCH (se guarda como enlace). */
  url: string | null;
}

export type TipoEnlace = "ot" | "certificado" | "acta" | "otro";
export const TIPOS_ENLACE: TipoEnlace[] = ["ot", "certificado", "acta", "otro"];

/** Enlace al software de armas (sin validar todavía el servidor). */
export interface EnlaceRecibido {
  tipo: TipoEnlace;
  etiqueta: string;
  numeroSerie: string | null;
  idExterno: string | null;
  url: string;
}

export interface EventoEstado {
  eventoId: string | null;
  ot: string;
  bpchId: number | null;
  estado: number;
  descripcion: string;
  motivo: string | null;
  operadorRut: string | null;
  fecha: string | null;
  totalCertificados: number | null;
  documento: DocumentoRecibido | null;
  enlaces: EnlaceRecibido[];
}

const txt = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Lee un aviso de estado del BPCH en cualquiera de sus tres formas:
 *   · opción 1 (POST directo): {ot, nuevo_estado, estado_descripcion, fecha_actualizacion, operador_rut, motivo, …}
 *   · opción 2 (webhook):      {evento_id, ot, estado, estado_descripcion, usuario_rut, fecha_cambio, motivo, …}
 *   · opción 3 (GET estado):   {bpch_id, ot, estado, estado_descripcion, motivo, fecha_actualizacion}
 * Opcionales: total_certificados, documento_cierre {nombre, tipo, descripcion, base64 | url}
 * y los enlaces (ver leerEnlaces): url_ot, enlaces[], certificados[] con solo serie + url + idFed.
 */
export function leerEvento(body: any): { evento: EventoEstado | null; errores: string[] } {
  const errores: string[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { evento: null, errores: ["El cuerpo debe ser un objeto JSON."] };
  const ot = txt(body.ot, 60);
  const estadoRaw = body.nuevo_estado ?? body.estado;
  const estado = Number(estadoRaw);
  if (!ot) errores.push("Falta «ot».");
  if (!Number.isInteger(estado) || !(estado in ESTADOS_BPCH)) errores.push("«estado» debe ser 1, 2, 3, 5, 6, 7 u 8.");
  const motivo = txt(body.motivo, 2000);
  const fecha = txt(body.fecha_cambio ?? body.fecha_actualizacion, 40);
  if (fecha && Number.isNaN(Date.parse(fecha))) errores.push("La fecha del cambio no es válida (ISO 8601).");
  const total = body.total_certificados === undefined || body.total_certificados === null ? null : Number(body.total_certificados);
  if (total !== null && (!Number.isInteger(total) || total < 0)) errores.push("«total_certificados» debe ser un entero ≥ 0.");

  let documento: DocumentoRecibido | null = null;
  const dc = body.documento_cierre;
  if (dc !== undefined && dc !== null) {
    const b64 = typeof dc?.base64 === "string" && dc.base64.trim() ? dc.base64 : null;
    const url = txt(dc?.url ?? dc?.url_descarga, 1000);
    if (typeof dc !== "object" || (!b64 && !url)) errores.push("«documento_cierre» debe traer «base64» o «url».");
    else documento = { nombre: txt(dc.nombre, 200) ?? "documento.pdf", tipo: txt(dc.tipo, 40) ?? "documento", descripcion: txt(dc.descripcion, 500), base64: b64, url };
  }

  const r = leerEnlaces(body);
  errores.push(...r.errores);
  if (errores.length) return { evento: null, errores };
  const bpchId = Number(body.bpch_id);
  return {
    evento: {
      eventoId: txt(body.evento_id, 120),
      ot: ot!,
      bpchId: Number.isSafeInteger(bpchId) && bpchId > 0 ? bpchId : null,
      estado,
      descripcion: descripcionEstado(estado, motivo, txt(body.estado_descripcion, 120)),
      motivo,
      operadorRut: txt(body.usuario_rut ?? body.operador_rut, 20),
      fecha,
      totalCertificados: total,
      documento,
      enlaces: r.enlaces,
    },
    errores,
  };
}

/**
 * Enlaces que trae un aviso o la respuesta de la ruta de enlaces del BPCH
 * (formato POR CONFIRMAR con el BPCH; se aceptan las tres formas):
 *   · `url_ot`: la OT en el BPCH;
 *   · `enlaces[]`: {tipo: ot|certificado|acta|otro, etiqueta, url, numero_serie?, idFed?/id_externo?};
 *   · `certificados[]`: {numero_serie, url, idFed?} — SOLO el enlace: un `base64`
 *     que venga en un certificado se ignora (los certificados quedan en el BPCH).
 * Un arreglo en la raíz se lee como `enlaces[]`.
 */
export function leerEnlaces(body: any): { enlaces: EnlaceRecibido[]; errores: string[] } {
  const errores: string[] = [];
  const enlaces: EnlaceRecibido[] = [];
  if (!body || typeof body !== "object") return { enlaces, errores };
  const fuente = Array.isArray(body) ? { enlaces: body } : body;
  const urlOt = txt(fuente.url_ot, 1000);
  if (urlOt) enlaces.push({ tipo: "ot", etiqueta: "OT en el sistema de armas del BPCH", numeroSerie: null, idExterno: null, url: urlOt });
  const lista = (nombre: string): any[] | null => {
    const v = fuente[nombre];
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) {
      errores.push(`«${nombre}» debe ser una lista.`);
      return null;
    }
    if (v.length > 5000) {
      errores.push(`«${nombre}» admite como máximo 5.000 elementos por aviso.`);
      return null;
    }
    return v;
  };
  (lista("enlaces") ?? []).forEach((e: any, i: number) => {
    const url = txt(e?.url, 1000);
    const tipo = String(e?.tipo ?? "otro").toLowerCase() as TipoEnlace;
    if (!url) return errores.push(`enlaces[${i}]: falta «url».`);
    if (!TIPOS_ENLACE.includes(tipo)) return errores.push(`enlaces[${i}]: «tipo» debe ser ot, certificado, acta u otro.`);
    const serie = txt(e.numero_serie, 80);
    enlaces.push({
      tipo,
      etiqueta: txt(e.etiqueta ?? e.nombre, 200) ?? (tipo === "certificado" && serie ? `Certificado serie ${serie}` : tipo === "acta" ? "Acta de cierre" : "Documento del BPCH"),
      numeroSerie: serie,
      idExterno: txt(e.idFed ?? e.id_fed ?? e.id_externo, 80),
      url,
    });
  });
  (lista("certificados") ?? []).forEach((c: any, i: number) => {
    const serie = txt(c?.numero_serie, 80);
    const url = txt(c?.url, 1000);
    if (!serie) return errores.push(`certificados[${i}]: falta «numero_serie».`);
    if (!url) return; // sin enlace no hay nada que guardar (el PDF no se guarda)
    enlaces.push({ tipo: "certificado", etiqueta: `Certificado serie ${serie}`, numeroSerie: serie, idExterno: txt(c.idFed ?? c.id_fed, 80), url });
  });
  return { enlaces, errores };
}

/* ------------------------------------------------------- enlaces seguros --- */

/** Servidores permitidos: los del parámetro o, si está vacío, el de la dirección base. */
export function hostsPermitidos(cfg: Pick<ConfigArmas, "hostsPermitidos" | "urlBase">): string[] {
  if (cfg.hostsPermitidos.length) return cfg.hostsPermitidos;
  try {
    return cfg.urlBase ? [new URL(cfg.urlBase).host.toLowerCase()] : [];
  } catch {
    return [];
  }
}

/**
 * Una URL del BPCH se acepta solo si es http/https, sin usuario ni contraseña y
 * su servidor (con puerto, si lo trae la lista) está permitido. Devuelve la URL
 * normalizada o el motivo del rechazo.
 */
export function validarUrlEnlace(url: string, hosts: string[]): { url: string | null; error: string | null } {
  let u: URL;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    return { url: null, error: "No es una URL válida." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { url: null, error: "Solo se aceptan enlaces http o https." };
  if (u.username || u.password) return { url: null, error: "El enlace no puede llevar usuario ni contraseña." };
  if (!hosts.length) return { url: null, error: "No hay servidores permitidos configurados (parámetro hosts_permitidos o url_base)." };
  const host = u.host.toLowerCase();
  const nombre = u.hostname.toLowerCase();
  const ok = hosts.some((h) => {
    const p = h.trim().toLowerCase();
    return p.includes(":") ? p === host : p === nombre;
  });
  if (!ok) return { url: null, error: `El servidor ${u.hostname} no está en la lista de permitidos.` };
  const s = u.toString();
  return s.length > 1000 ? { url: null, error: "El enlace es demasiado largo." } : { url: s, error: null };
}

/** Ruta de enlaces del BPCH con {ot} y {bpch_id} reemplazados. null si falta algo. */
export function rutaEnlaces(plantilla: string, ot: string, bpchId: string | number | null): string | null {
  const p = String(plantilla ?? "").trim();
  if (!p || !p.startsWith("/")) return null;
  if (p.includes("{bpch_id}") && (bpchId === null || bpchId === undefined || bpchId === "")) return null;
  return p.replace(/\{ot\}/g, encodeURIComponent(ot)).replace(/\{bpch_id\}/g, encodeURIComponent(String(bpchId ?? "")));
}

/**
 * Identificador para no procesar dos veces el mismo aviso: X-Event-ID o
 * `evento_id`; si no viene (opción 1 y consultas), un hash de OT, estado, fecha y motivo.
 */
export function idEvento(e: EventoEstado, cabecera?: string | null): string {
  const h = txt(cabecera, 120) ?? e.eventoId;
  if (h) return h;
  return "h:" + createHash("sha256").update(`${e.ot}|${e.estado}|${e.fecha ?? ""}|${e.motivo ?? ""}`).digest("hex").slice(0, 40);
}

/** Copia del cuerpo para guardar: sin los base64 (se reemplazan por tamaño y hash; nunca se guardan PDF de certificados). */
export function cuerpoSinBase64(body: any): any {
  if (Array.isArray(body)) return body.map(cuerpoSinBase64);
  if (!body || typeof body !== "object") return body;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if ((k === "base64" || k === "b64") && typeof v === "string") {
      out[k] = { omitido: true, caracteres: v.length, sha256: createHash("sha256").update(v).digest("hex") };
    } else out[k] = cuerpoSinBase64(v);
  }
  return out;
}

/* --------------------------------------------------------- PDF recibido --- */

export const MAX_BYTES_PDF = 15 * 1024 * 1024;

/** Decodifica un base64 (con o sin prefijo data:) y exige un PDF de hasta 15 MB. */
export function pdfDeBase64(b64: string): { datos: Buffer | null; error: string | null } {
  const limpio = String(b64 ?? "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!limpio || !/^[A-Za-z0-9+/]+=*$/.test(limpio)) return { datos: null, error: "El base64 no es válido." };
  if (limpio.length > Math.ceil((MAX_BYTES_PDF * 4) / 3) + 4) return { datos: null, error: "El PDF supera los 15 MB." };
  const datos = Buffer.from(limpio, "base64");
  if (datos.length > MAX_BYTES_PDF) return { datos: null, error: "El PDF supera los 15 MB." };
  if (datos.subarray(0, 5).toString("latin1") !== "%PDF-") return { datos: null, error: "El documento no es un PDF." };
  return { datos, error: null };
}

/** Nombre de archivo seguro terminado en .pdf. */
export function nombrePdf(nombre: string | null | undefined, porDefecto = "documento.pdf"): string {
  const base = String(nombre ?? "")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
    .trim()
    .slice(0, 180);
  if (!base) return porDefecto;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/* ------------------------------------------- enlace de descarga de adjuntos --- */

/**
 * Enlace firmado para que el BPCH descargue un adjunto sin sesión:
 * `<adjuntoId>.<expira (s epoch, base36)>.<hmac>`. No lleva datos personales.
 */
export function firmarEnlace(adjuntoId: string, expiraEpochS: number, secreto: string): string {
  const exp = Math.floor(expiraEpochS).toString(36);
  const mac = createHmac("sha256", secreto).update(`armas-adjunto|${adjuntoId}|${exp}`).digest("base64url").slice(0, 43);
  return `${adjuntoId}.${exp}.${mac}`;
}

export function verificarEnlace(token: string, secreto: string, ahoraEpochS: number = Date.now() / 1000): { adjuntoId: string | null; error: string | null } {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 3) return { adjuntoId: null, error: "Enlace inválido." };
  const [id, exp, mac] = partes;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-z]+$/.test(exp)) return { adjuntoId: null, error: "Enlace inválido." };
  const esperado = firmarEnlace(id, parseInt(exp, 36), secreto).split(".")[2];
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { adjuntoId: null, error: "Enlace inválido." };
  if (parseInt(exp, 36) < ahoraEpochS) return { adjuntoId: null, error: "El enlace venció." };
  return { adjuntoId: id, error: null };
}

/* ------------------------------------------------------------- parámetros --- */

export interface ConfigArmas {
  activa: boolean;
  urlBase: string;
  modoRetorno: "webhook" | "post" | "pull";
  enviarAutomatico: boolean;
  unidades: string[];
  maxIntentos: number;
  intervaloPullMin: number;
  rutConDv: boolean;
  vigenciaEnlaceHoras: number;
  cerrarOtAlFinalizar: boolean;
  hostsPermitidos: string[];
  rutaEnlacesOt: string;
  guardarActaPdf: boolean;
}

const entero = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** Lee la categoría `integracion_armas` de parametro_sistema (las filas inactivas cuentan como ausentes). */
export function configArmas(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigArmas {
  const m = new Map<string, string>();
  for (const f of filas) if (f.activo !== false && f.valor !== null) m.set(f.codigo, String(f.valor).trim());
  const modo = m.get("modo_retorno");
  return {
    activa: m.get("activa") === "si",
    urlBase: (m.get("url_base") ?? "").replace(/\/+$/, ""),
    modoRetorno: modo === "post" || modo === "pull" ? modo : "webhook",
    enviarAutomatico: m.get("enviar_automatico") === "si",
    unidades: (m.get("unidades") ?? "D11,BPCH")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    maxIntentos: entero(m.get("max_intentos"), 8, 1, 30),
    intervaloPullMin: entero(m.get("intervalo_pull_min"), 15, 1, 1440),
    rutConDv: m.get("rut_con_dv") === "si",
    vigenciaEnlaceHoras: entero(m.get("vigencia_enlace_horas"), 72, 1, 720),
    cerrarOtAlFinalizar: m.get("cerrar_ot_al_finalizar") === "si",
    hostsPermitidos: (m.get("hosts_permitidos") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    rutaEnlacesOt: m.get("ruta_enlaces_ot") ?? "",
    guardarActaPdf: m.get("guardar_acta_pdf") !== "no",
  };
}

/** La URL base debe ser http(s) sin credenciales ni parámetros. */
export function urlBaseValida(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/**
 * Dirección del LIMS con que el BPCH descarga los adjuntos:
 *   1. LIMS_URL_INTEGRACION (p. ej. https://lims.idic.local, la que el BPCH alcanza en la red del IDIC);
 *   2. https://<DOMAIN>;  3. el primer origen de CORS_ORIGINS;  4. http://localhost:<API_PORT>.
 */
export function urlBaseLims(env: NodeJS.ProcessEnv = process.env): string {
  const limpia = (u: string) => u.trim().replace(/\/+$/, "");
  if (env.LIMS_URL_INTEGRACION?.trim()) return limpia(env.LIMS_URL_INTEGRACION);
  const dominio = env.DOMAIN?.trim().replace(/^https?:\/\//, "");
  if (dominio) return `https://${limpia(dominio)}`;
  const origen = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .find((x) => /^https?:\/\/[^/\s]+$/i.test(x));
  if (origen) return origen;
  return `http://localhost:${env.API_PORT ?? 3001}`;
}

/** Ruta de nuestra API (con el prefijo global «api») por la que el BPCH descarga un adjunto. */
export const rutaDescargaAdjunto = (token: string) => `/api/v1/integracion/bpch/adjuntos/${encodeURIComponent(token)}`;

export const RUTA_CREAR_OT = "/api/v1/integracion/lims/ordenes-trabajo";
export const rutaEstadoOt = (ot: string) => `${RUTA_CREAR_OT}/${encodeURIComponent(ot)}/estado`;
