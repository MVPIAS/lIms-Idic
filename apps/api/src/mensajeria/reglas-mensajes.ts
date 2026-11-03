/**
 * Mensajería interna y correo con adjuntos · reglas PURAS (contrato §4.5.5,
 * §4.5.6), probadas en reglas-mensajes.spec.ts: prioridad, límites de los
 * adjuntos y filtros de búsqueda del historial.
 */
import { nombreSeguro, tipoArchivo } from "../documentos/gestor";
import { sqlDia } from "../common/fecha-chile";
import { decodeEntities } from "../plantilla-render/html.util";

export const PRIORIDADES = ["normal", "alta", "urgente"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = { normal: "Normal", alta: "Alta", urgente: "Urgente" };

/** Prioridad reconocida o «normal». */
export function prioridadDe(v: unknown): Prioridad {
  const s = String(v ?? "").trim().toLowerCase();
  return (PRIORIDADES as readonly string[]).includes(s) ? (s as Prioridad) : "normal";
}

/** Asunto del correo marcado por su urgencia (el destinatario lo ve en su cliente de correo). */
export function asuntoConPrioridad(asunto: string, prioridad: Prioridad): string {
  if (prioridad === "urgente") return `[URGENTE] ${asunto}`;
  if (prioridad === "alta") return `[Prioridad alta] ${asunto}`;
  return asunto;
}

/* --------------------------------------------------------------- adjuntos --- */

export const MAX_ADJUNTOS = 10;
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ADJUNTOS = 20 * 1024 * 1024;

export interface ArchivoSubido {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
}
export interface AdjuntoValido {
  nombre: string;
  mime: string;
  bytes: number;
  datos: Buffer;
}

/**
 * Valida los adjuntos libres: cantidad, tamaño de cada uno y total, y tipo por
 * extensión Y contenido (los mismos tipos del gestor documental: PDF, imágenes,
 * Office, texto y CSV). Devuelve los adjuntos o la lista de errores.
 */
export function validarAdjuntos(archivos: ArchivoSubido[] | undefined | null): { adjuntos: AdjuntoValido[]; errores: string[] } {
  const lista = archivos ?? [];
  const errores: string[] = [];
  if (lista.length > MAX_ADJUNTOS) errores.push(`Se admiten hasta ${MAX_ADJUNTOS} adjuntos por mensaje.`);
  const adjuntos: AdjuntoValido[] = [];
  let total = 0;
  for (const a of lista.slice(0, MAX_ADJUNTOS)) {
    const nombre = nombreSeguro(a.originalname);
    const datos = a.buffer ?? Buffer.alloc(0);
    if (datos.length > MAX_ADJUNTO_BYTES) {
      errores.push(`«${nombre}» supera 10 MB.`);
      continue;
    }
    const t = tipoArchivo(nombre, datos);
    if ("error" in t) {
      errores.push(`«${nombre}»: ${t.error}`);
      continue;
    }
    total += datos.length;
    adjuntos.push({ nombre, mime: t.mime, bytes: datos.length, datos });
  }
  if (total > MAX_TOTAL_ADJUNTOS) errores.push("Los adjuntos juntos no pueden superar 20 MB.");
  return { adjuntos, errores };
}

/** Tamaño legible («1,2 MB», «340 KB»). */
export function tamanoLegible(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* --------------------------------------------------------------- búsqueda --- */

export interface FiltroBusqueda {
  remitente?: string | null;
  destinatario?: string | null;
  asunto?: string | null;
  prioridad?: string | null;
  /** «si» = con adjuntos, «no» = sin adjuntos; otro valor = indiferente. */
  adjuntos?: string | null;
  /** Palabras clave: TODAS deben aparecer en el asunto o el cuerpo. */
  q?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface ColumnasBusqueda {
  remitente: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  prioridad: string;
  nAdjuntos: string;
  fecha: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Condiciones SQL (con parámetros posicionales a partir de `desde`) del
 * historial de mensajes o correos (§4.5.6). Las fechas son días de Chile.
 * Las columnas las fija el servicio (nunca vienen del usuario).
 */
export function condicionesBusqueda(f: FiltroBusqueda, col: ColumnasBusqueda, desde: number): { sql: string[]; args: unknown[] } {
  const sql: string[] = [];
  const args: unknown[] = [];
  const p = (v: unknown) => {
    args.push(v);
    return `$${desde + args.length - 1}`;
  };
  const texto = (v: string | null | undefined) => (v ?? "").trim();
  if (texto(f.remitente)) sql.push(`${col.remitente} ILIKE ${p(`%${texto(f.remitente)}%`)}`);
  if (texto(f.destinatario)) sql.push(`${col.destinatario} ILIKE ${p(`%${texto(f.destinatario)}%`)}`);
  if (texto(f.asunto)) sql.push(`${col.asunto} ILIKE ${p(`%${texto(f.asunto)}%`)}`);
  if ((PRIORIDADES as readonly string[]).includes(texto(f.prioridad))) sql.push(`${col.prioridad} = ${p(texto(f.prioridad))}`);
  if (f.adjuntos === "si") sql.push(`${col.nAdjuntos} > 0`);
  if (f.adjuntos === "no") sql.push(`${col.nAdjuntos} = 0`);
  const palabras = texto(f.q).split(/\s+/).filter((w) => w.length >= 2).slice(0, 8);
  for (const w of palabras) {
    const marca = p(`%${w}%`);
    sql.push(`(${col.asunto} ILIKE ${marca} OR ${col.cuerpo} ILIKE ${marca})`);
  }
  if (FECHA.test(texto(f.desde))) sql.push(`${sqlDia(col.fecha)} >= ${p(texto(f.desde))}::date`);
  if (FECHA.test(texto(f.hasta))) sql.push(`${sqlDia(col.fecha)} <= ${p(texto(f.hasta))}::date`);
  return { sql, args };
}

/** Resumen del cuerpo para listas: texto plano, acotado. */
export function resumenTexto(html: string, max = 200): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Cuerpo HTML seguro de un mensaje escrito como texto (párrafos y saltos de línea). */
export function textoAHtml(texto: string): string {
  const esc = texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
