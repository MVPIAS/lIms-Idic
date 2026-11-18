/**
 * Cartas de remisión de encuestas a la Sección Planificación, Estudios y Control
 * Comercial (DCO-PG01-P04-IT05 FORM06, FORM07 y FORM08, Rev00) · reglas PURAS y
 * cuerpo del PDF (cartas-remision.spec.ts).
 *
 *   FORM06 · encuestas REMITIDAS en el período (mes y año, o trimestre).
 *   FORM07 · encuestas REALIZADAS en el período (con respuesta registrada).
 *   FORM08 · encuestas remitidas al cliente Ejército en el TRIMESTRE.
 *
 * Qué es cada cosa en el LIMS (no hay un estado «enviada» ni una fecha de envío
 * propia; los estados son pendiente → registrada · sin_respuesta):
 *   · remitida  = encuesta abierta para el cliente (pendiente, registrada o
 *                 cerrada sin respuesta). Su «fecha de envío» es la fecha en que
 *                 se abrió (encuesta_satisfaccion.fecha_envio: cierre de la OT o
 *                 fecha del servicio, en las altas manuales).
 *   · realizada = encuesta con respuesta registrada; su fecha es la de la
 *                 respuesta (si falta, la del registro).
 * El período se aplica a esa fecha.
 *
 * El PDF lo dibuja el motor común (plantilla-render/pdf.renderer.ts): todo dato
 * se escapa. La firma se estampa a mano (el LIMS no firma documentos del Estado).
 */
import { escapeHtml as esc } from "../plantilla-render/html.util";
import { esTrimestre, MESES_TRIMESTRE, NOMBRE_TRIMESTRE, rangoTrimestre } from "./informe-trimestral";

export const CODIGOS_CARTA = ["FORM06", "FORM07", "FORM08"] as const;
export type CodigoCarta = (typeof CODIGOS_CARTA)[number];

export interface DefinicionCarta {
  codigo: CodigoCarta;
  formulario: string;
  revision: string;
  nombre: string;
  criterio: "remitidas" | "realizadas";
  /** Solo encuestas del formulario Ejército. */
  soloEjercito: boolean;
  /** El período es siempre un trimestre. */
  soloTrimestre: boolean;
}

export const CARTAS: Record<CodigoCarta, DefinicionCarta> = {
  FORM06: {
    codigo: "FORM06",
    formulario: "DCO-PG01-P04-IT05-FORM06",
    revision: "00",
    nombre: "Encuestas remitidas",
    criterio: "remitidas",
    soloEjercito: false,
    soloTrimestre: false,
  },
  FORM07: {
    codigo: "FORM07",
    formulario: "DCO-PG01-P04-IT05-FORM07",
    revision: "00",
    nombre: "Encuestas realizadas",
    criterio: "realizadas",
    soloEjercito: false,
    soloTrimestre: false,
  },
  FORM08: {
    codigo: "FORM08",
    formulario: "DCO-PG01-P04-IT05-FORM08",
    revision: "00",
    nombre: "Encuestas remitidas al cliente Ejército (trimestral)",
    criterio: "remitidas",
    soloEjercito: true,
    soloTrimestre: true,
  },
};

export function esCodigoCarta(x: unknown): x is CodigoCarta {
  return typeof x === "string" && (CODIGOS_CARTA as readonly string[]).includes(x);
}

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

export interface Periodo {
  anio: number;
  mes: number | null;
  trimestre: 1 | 2 | 3 | 4 | null;
  /** [desde, hasta) en AAAA-MM-DD. */
  desde: string;
  hasta: string;
  /** «noviembre de 2026» · «julio a septiembre de 2026 (tercer trimestre)». */
  texto: string;
}

/**
 * Período de la carta: un mes (año + mes) o un trimestre (año + trimestre).
 * Devuelve el error en lenguaje de usuario si los datos no alcanzan.
 */
export function periodoCarta(carta: DefinicionCarta, q: { anio?: unknown; mes?: unknown; trimestre?: unknown }): Periodo | { error: string } {
  const anio = Number(q.anio);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return { error: "Indique un año válido (por ejemplo 2026)." };
  const vacio = (v: unknown) => v === undefined || v === null || v === "";
  const mes = vacio(q.mes) ? null : Number(q.mes);
  const trimestre = vacio(q.trimestre) ? null : Number(q.trimestre);
  if (mes !== null && trimestre !== null) return { error: "Elija un mes o un trimestre, no los dos." };
  if (trimestre !== null) {
    if (!esTrimestre(trimestre)) return { error: "El trimestre debe ser 1, 2, 3 o 4." };
    const r = rangoTrimestre(anio, trimestre);
    return { anio, mes: null, trimestre, ...r, texto: `${MESES_TRIMESTRE[trimestre - 1]} de ${anio} (${NOMBRE_TRIMESTRE[trimestre - 1]} trimestre)` };
  }
  if (carta.soloTrimestre) return { error: `La carta ${carta.formulario} es trimestral: elija el trimestre.` };
  if (mes === null) return { error: "Elija el mes o el trimestre." };
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return { error: "El mes debe estar entre 1 y 12." };
  const dos = (n: number) => String(n).padStart(2, "0");
  return {
    anio,
    mes,
    trimestre: null,
    desde: `${anio}-${dos(mes)}-01`,
    hasta: mes === 12 ? `${anio + 1}-01-01` : `${anio}-${dos(mes + 1)}-01`,
    texto: `${MESES[mes - 1]} de ${anio}`,
  };
}

/** Una encuesta tal como la lee la carta. */
export interface FilaCarta {
  id: string;
  /** Código del formulario de la encuesta (FORM01…). */
  tipo: string | null;
  /** Código del formulario impreso (DCO-PG01-P04-IT05-FORM01…). */
  formulario: string | null;
  estado: string;
  /** Fecha en que se abrió la encuesta (AAAA-MM-DD). */
  fechaEnvio: string | null;
  /** Fecha de la respuesta (AAAA-MM-DD); si falta, la del registro. */
  fechaRespuesta: string | null;
  /** N° de OT, PIA o cotización. */
  referencia: string;
  /** Empresa o persona natural. */
  cliente: string | null;
  promedio: number | null;
}

export interface LineaCarta extends FilaCarta {
  /** Fecha que define el período: envío (remitidas) o respuesta (realizadas). */
  fecha: string;
}

const ESTADOS_REMITIDA = new Set(["pendiente", "registrada", "sin_respuesta"]);

/**
 * Encuestas que van en la carta: las remitidas (abiertas) o realizadas
 * (registradas) cuya fecha cae en el período; en la FORM08, solo las de los
 * formularios Ejército. Ordenadas por fecha y referencia.
 */
export function filasCarta(carta: DefinicionCarta, filas: FilaCarta[], periodo: Pick<Periodo, "desde" | "hasta">, tiposEjercito: string[] = ["FORM03"]): LineaCarta[] {
  const ejercito = new Set(tiposEjercito);
  const out: LineaCarta[] = [];
  for (const f of filas) {
    if (carta.soloEjercito && !(f.tipo && ejercito.has(f.tipo))) continue;
    const fecha = carta.criterio === "realizadas" ? (f.estado === "registrada" ? f.fechaRespuesta : null) : ESTADOS_REMITIDA.has(f.estado) ? f.fechaEnvio : null;
    if (!fecha || fecha < periodo.desde || fecha >= periodo.hasta) continue;
    out.push({ ...f, fecha });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.referencia.localeCompare(b.referencia, "es"));
}

/** Párrafo de la carta, con el texto del formulario Rev00. */
export function textoCarta(carta: DefinicionCarta, periodo: Periodo, fechaCarta: string): string {
  if (carta.codigo === "FORM08")
    return `Sección Planificación, Estudios y Control Comercial, se informa a UD detalle de encuestas remitidas al cliente Ejército, correspondiente al ${
      periodo.trimestre ? `${NOMBRE_TRIMESTRE[periodo.trimestre - 1]} Trimestre del año ${periodo.anio}` : periodo.texto
    }, para su conocimiento y seguimiento.`;
  if (carta.codigo === "FORM07")
    return `Sección Planificación, Estudios y Control Comercial, se informa a UD detalle de encuestas realizadas con fecha ${fechaCarta}, correspondientes al período ${periodo.texto}, para su conocimiento.`;
  return `Sección Planificación, Estudios y Control Comercial, se informa a UD detalle de encuestas remitidas con fecha ${fechaCarta}, correspondiente al período ${periodo.texto}, para su conocimiento y seguimiento.`;
}

export interface CartaRemision {
  carta: DefinicionCarta;
  periodo: Periodo;
  /** Fecha de la carta (dd-mm-aaaa). */
  fecha: string;
  texto: string;
  lineas: LineaCarta[];
  remitente: { nombre: string; cargo: string | null };
}

const fechaDma = (iso: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "—";
};
const nota = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ","));

/** Arma la carta completa (datos para la pantalla y el PDF). */
export function armarCarta(
  carta: DefinicionCarta,
  periodo: Periodo,
  filas: FilaCarta[],
  fechaCartaIso: string,
  remitente: { nombre: string; cargo: string | null },
  tiposEjercito?: string[],
): CartaRemision {
  const fecha = fechaDma(fechaCartaIso);
  return { carta, periodo, fecha, texto: textoCarta(carta, periodo, fecha), lineas: filasCarta(carta, filas, periodo, tiposEjercito), remitente };
}

/** Cuerpo HTML del PDF de la carta (formato FORM06 / FORM07 / FORM08 Rev00). */
export function cuerpoCartaHtml(c: CartaRemision): string {
  const realizadas = c.carta.criterio === "realizadas";
  const cab = [
    "Nº",
    "Nº OT / PIA",
    realizadas ? "Empresa o persona natural" : "Empresa o persona",
    ...(c.carta.soloEjercito ? [] : ["Formulario"]),
    realizadas ? "Fecha de la respuesta" : "Fecha de envío",
    ...(realizadas ? ["Nota promedio"] : []),
  ];
  const filas = c.lineas.length
    ? c.lineas
        .map(
          (l, i) =>
            `<tr><td class="num">${i + 1}</td><td>${esc(l.referencia)}</td><td>${esc(l.cliente ?? "—")}</td>` +
            (c.carta.soloEjercito ? "" : `<td>${esc(l.formulario ?? l.tipo ?? "—")}</td>`) +
            `<td>${fechaDma(l.fecha)}</td>` +
            (realizadas ? `<td class="num">${nota(l.promedio)}</td>` : "") +
            `</tr>`,
        )
        .join("")
    : `<tr><td class="vacio" colspan="${cab.length}">Sin encuestas ${realizadas ? "realizadas" : "remitidas"} en el período.</td></tr>`;
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b><span>Ejército de Chile &middot; Departamento Comercial</span></div>
  <div class="doc"><b>${esc(c.carta.formulario)}</b><span>Revisión ${esc(c.carta.revision)}</span></div>
</div>
<p>Santiago, ${esc(c.fecha)}</p>
<p><b>Sres.</b></p>
<p>${esc(c.texto)}</p>
<table class="rep">
  <thead><tr>${cab.map((h, i) => `<th${i === 0 || h === "Nota promedio" ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${filas}</tbody>
</table>
<p class="nota">Total: ${c.lineas.length} encuesta(s).</p>
<div class="firmas"><div class="firma">${esc(c.remitente.nombre)}${c.remitente.cargo ? ` · ${esc(c.remitente.cargo)}` : ""}</div></div>`;
}
