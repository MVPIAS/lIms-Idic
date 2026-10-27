/**
 * Recepción y custodia de la muestra · reglas PURAS (sin BD), probadas en
 * reglas-recepcion.spec.ts. Contrato: docs/FLUJO_RECEPCION_CUSTODIA_EQUIPO.md.
 *
 * Especificación: EP-01 §1.3 (Sección Química, variantes LPN y LME), EP-02 §2.1
 * (Alimentos), EP-03 §1.2 (Vestuario y Equipos), EP-05 §3.1 (Sistemas de
 * Armas) y las respuestas del LME del 20-10-2026.
 *
 *  · Campos propios de cada laboratorio: se definen en Catálogo › Parámetros,
 *    categoría `recepcion_campo`, código `<LAB>.<campo>` y valor JSON
 *    `{tipo, obligatorio, opciones, ayuda}`. Así el IDIC los cambia sin código.
 *    Dos códigos van a columnas de la muestra: `clase_custodia` (destino de la
 *    muestra) y `ubicacion`; el resto se guarda en `muestra.datos_recepcion`.
 *  · Destino de la muestra (clase_custodia): análisis, testigo, en custodia o
 *    contramuestra. Testigo y contramuestra se retienen un plazo (meses, en la
 *    categoría `retencion_muestra`); antes no se pueden destruir. La muestra en
 *    custodia se devuelve: no se destruye.
 */

import { hoyChile, diaChile } from "../common/fecha-chile";

export type TipoCampo = "texto" | "numero" | "entero" | "fecha" | "lista" | "casilla";
export const TIPOS_CAMPO: readonly TipoCampo[] = ["texto", "numero", "entero", "fecha", "lista", "casilla"];

export const CLASES_CUSTODIA = ["analisis", "testigo", "custodia", "contramuestra"] as const;
export type ClaseCustodia = (typeof CLASES_CUSTODIA)[number];
export const NOMBRE_CLASE: Record<ClaseCustodia, string> = {
  analisis: "Análisis",
  testigo: "Testigo",
  custodia: "En custodia",
  contramuestra: "Contramuestra",
};

/** Códigos de campo que se guardan en columnas de la muestra (no en datos_recepcion). */
export const CAMPOS_COLUMNA = ["clase_custodia", "ubicacion"] as const;

export interface OpcionCampo {
  valor: string;
  etiqueta: string;
}

export interface CampoRecepcion {
  /** Código del campo sin el prefijo del laboratorio (fabricante, lote, clase_custodia…). */
  codigo: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio: boolean;
  opciones: OpcionCampo[];
  ayuda: string | null;
  orden: number;
}

/** Fila de parametro_sistema (categoría recepcion_campo). */
export interface FilaParametro {
  codigo: string;
  etiqueta: string;
  orden?: number | null;
  valor?: string | null;
  activo?: boolean | null;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Lee la definición de un campo desde su fila de parámetros. Devuelve null si la
 * fila no es del laboratorio, está inactiva o su JSON no se entiende (un JSON
 * mal editado no rompe la recepción: el campo simplemente no se pide).
 */
export function leerCampo(fila: FilaParametro, laboratorio: string): CampoRecepcion | null {
  if (fila.activo === false) return null;
  const prefijo = `${laboratorio.toUpperCase()}.`;
  if (!fila.codigo?.toUpperCase().startsWith(prefijo)) return null;
  const codigo = fila.codigo.slice(prefijo.length).trim();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(codigo)) return null;
  let def: any = {};
  if (fila.valor && fila.valor.trim()) {
    try {
      def = JSON.parse(fila.valor);
    } catch {
      return null;
    }
  }
  if (!def || typeof def !== "object" || Array.isArray(def)) return null;
  const tipo: TipoCampo = TIPOS_CAMPO.includes(def.tipo) ? def.tipo : "texto";
  const opciones: OpcionCampo[] = Array.isArray(def.opciones)
    ? def.opciones
        .map((o: any) =>
          typeof o === "string" ? { valor: o.trim(), etiqueta: o.trim() } : { valor: texto(o?.valor), etiqueta: texto(o?.etiqueta) || texto(o?.valor) },
        )
        .filter((o: OpcionCampo) => o.valor)
    : [];
  if (tipo === "lista" && !opciones.length) return null;
  // El destino de la muestra solo admite las clases conocidas.
  if (codigo === "clase_custodia" && (tipo !== "lista" || opciones.some((o) => !(CLASES_CUSTODIA as readonly string[]).includes(o.valor))))
    return null;
  return {
    codigo,
    etiqueta: texto(fila.etiqueta) || codigo,
    tipo,
    obligatorio: def.obligatorio === true,
    opciones,
    ayuda: texto(def.ayuda) || null,
    orden: Number(fila.orden ?? 0),
  };
}

/** Campos activos del laboratorio, en orden. */
export function camposDeLaboratorio(filas: FilaParametro[], laboratorio: string | null | undefined): CampoRecepcion[] {
  if (!laboratorio) return [];
  return filas
    .map((f) => leerCampo(f, laboratorio))
    .filter((c): c is CampoRecepcion => c !== null)
    .sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
}

export type ValorCampo = string | number | boolean | null;

export interface EntradaRecepcionLab {
  claseCustodia?: string | null;
  ubicacion?: string | null;
  datos?: Record<string, ValorCampo | undefined> | null;
}

export interface RecepcionLabNormalizada {
  claseCustodia: ClaseCustodia | null;
  ubicacion: string | null;
  datos: Record<string, ValorCampo>;
}

const vacio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function leerNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = texto(v).replace(",", ".");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  return Number(s);
}

function leerFecha(v: unknown): string | null {
  const s = texto(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/**
 * Valida y normaliza los campos propios del laboratorio. `prefijo` antepone
 * «Muestra 2: » cuando se registran varias. Lista de errores vacía = se puede.
 * Un campo que no está definido para el laboratorio se rechaza (no se guarda
 * información sin nombre).
 */
export function validarCamposLaboratorio(
  campos: CampoRecepcion[],
  entrada: EntradaRecepcionLab,
  laboratorio: string,
  prefijo = "",
): { errores: string[]; valor: RecepcionLabNormalizada } {
  const errores: string[] = [];
  const porCodigo = new Map(campos.map((c) => [c.codigo, c]));
  const datos: Record<string, ValorCampo> = {};
  const crudos: Record<string, unknown> = { ...(entrada.datos ?? {}) };
  if (!vacio(entrada.claseCustodia)) crudos.clase_custodia = entrada.claseCustodia;
  if (!vacio(entrada.ubicacion)) crudos.ubicacion = entrada.ubicacion;

  for (const k of Object.keys(entrada.datos ?? {})) {
    if ((CAMPOS_COLUMNA as readonly string[]).includes(k)) continue;
    if (!porCodigo.has(k)) errores.push(`${prefijo}el campo «${k}» no está definido para la recepción del ${laboratorio}.`);
  }

  let claseCustodia: ClaseCustodia | null = null;
  let ubicacion: string | null = null;
  for (const c of campos) {
    const v = crudos[c.codigo];
    const nombre = `«${c.etiqueta}»`;
    if (c.tipo === "casilla") {
      const marcado = v === true || v === "true" || v === "si" || v === "sí";
      if (c.obligatorio && !marcado) errores.push(`${prefijo}marque ${nombre}: es obligatorio en la recepción del ${laboratorio}.`);
      if (!(CAMPOS_COLUMNA as readonly string[]).includes(c.codigo)) datos[c.codigo] = marcado;
      continue;
    }
    if (vacio(v)) {
      if (c.obligatorio) errores.push(`${prefijo}indique ${nombre} (obligatorio en la recepción del ${laboratorio}).`);
      continue;
    }
    let norm: ValorCampo = null;
    if (c.tipo === "numero" || c.tipo === "entero") {
      const n = leerNumero(v);
      if (n === null) errores.push(`${prefijo}${nombre} debe ser un número.`);
      else if (c.tipo === "entero" && (!Number.isInteger(n) || n < 0)) errores.push(`${prefijo}${nombre} debe ser un número entero, sin decimales.`);
      else norm = n;
    } else if (c.tipo === "fecha") {
      norm = leerFecha(v);
      if (norm === null) errores.push(`${prefijo}${nombre} debe ser una fecha válida (AAAA-MM-DD).`);
    } else if (c.tipo === "lista") {
      const s = texto(v);
      if (!c.opciones.some((o) => o.valor === s)) errores.push(`${prefijo}${nombre}: «${s}» no es una de las opciones.`);
      else norm = s;
    } else {
      const s = texto(v);
      if (s.length > 300) errores.push(`${prefijo}${nombre} admite como máximo 300 caracteres.`);
      else norm = s;
    }
    if (norm === null) continue;
    if (c.codigo === "clase_custodia") claseCustodia = norm as ClaseCustodia;
    else if (c.codigo === "ubicacion") ubicacion = String(norm).slice(0, 120);
    else datos[c.codigo] = norm;
  }

  // Sin campo configurado para el laboratorio, el destino y la ubicación igual
  // se aceptan (formulario general), validando el vocabulario.
  if (!porCodigo.has("clase_custodia") && !vacio(entrada.claseCustodia)) {
    const s = texto(entrada.claseCustodia);
    if (!(CLASES_CUSTODIA as readonly string[]).includes(s)) errores.push(`${prefijo}destino de la muestra «${s}» no válido.`);
    else claseCustodia = s as ClaseCustodia;
  }
  if (!porCodigo.has("ubicacion") && !vacio(entrada.ubicacion)) ubicacion = texto(entrada.ubicacion).slice(0, 120);
  return { errores, valor: { claseCustodia, ubicacion, datos } };
}

/* ---------------------------------------------------------------- custodia --- */

/** Plazos de retención (meses) desde los parámetros; los que no sean número se ignoran. */
export function plazosRetencion(filas: { codigo: string; valor?: string | null; activo?: boolean | null }[]): Partial<Record<ClaseCustodia, number>> {
  const out: Partial<Record<ClaseCustodia, number>> = {};
  for (const f of filas) {
    if (f.activo === false || !(CLASES_CUSTODIA as readonly string[]).includes(f.codigo)) continue;
    const n = Number(String(f.valor ?? "").replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n <= 600) out[f.codigo as ClaseCustodia] = n;
  }
  return out;
}

/**
 * Fecha (AAAA-MM-DD) hasta la que se retiene la muestra: recepción + plazo de
 * su clase. Sin plazo para la clase (análisis, custodia) → null.
 */
export function retenerHasta(clase: ClaseCustodia | null | undefined, recepcion: Date | null | undefined, plazos: Partial<Record<ClaseCustodia, number>>): string | null {
  if (!clase || !recepcion) return null;
  const meses = plazos[clase];
  if (!meses) return null;
  // El día de la recepción es el de Chile: una recepción a las 21:30 no cuenta desde el día siguiente (frente f8).
  const diaRec = diaChile(recepcion);
  if (!diaRec) return null;
  const d = new Date(`${diaRec}T00:00:00Z`);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(meses));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
}

/** Hoy en Chile (AAAA-MM-DD) para comparar con DATE, sin depender de la zona del servidor (D02-27). */
export const hoyIso = (ahora = new Date()) => hoyChile(ahora);

const fmtDma = (iso: string) => iso.split("-").reverse().join("-");

/**
 * Por qué no se puede registrar un evento de disposición de la muestra
 * (null = se puede):
 *   · destrucción de una muestra en custodia: se devuelve, no se destruye;
 *   · destrucción de un testigo o contramuestra antes de cumplir su plazo.
 */
export function motivoNoDisponer(
  evento: string,
  m: { codigo: string; claseCustodia?: string | null; retenerHasta?: string | null },
  hoy: string,
): string | null {
  if (evento !== "destruccion") return null;
  if (m.claseCustodia === "custodia")
    return `La muestra ${m.codigo} está en custodia: se devuelve al cliente o a la autoridad, no se destruye.`;
  if (m.retenerHasta && hoy < m.retenerHasta) {
    const clase = m.claseCustodia === "testigo" ? "testigo" : m.claseCustodia === "contramuestra" ? "contramuestra" : "retenida";
    return `La muestra ${m.codigo} es ${clase} y debe conservarse hasta el ${fmtDma(m.retenerHasta)}: no se puede registrar su destrucción antes.`;
  }
  return null;
}

/** Estado de la retención para la pantalla de custodia. */
export function estadoRetencion(
  m: { claseCustodia?: string | null; retenerHasta?: string | null; dispuesta?: boolean },
  hoy: string,
  avisoDias = 7,
): "dispuesta" | "sin_plazo" | "vigente" | "por_cumplir" | "cumplida" {
  if (m.dispuesta) return "dispuesta";
  if (!m.retenerHasta) return "sin_plazo";
  if (hoy >= m.retenerHasta) return "cumplida";
  const dias = Math.round((Date.parse(m.retenerHasta) - Date.parse(hoy)) / 86_400_000);
  return dias <= avisoDias ? "por_cumplir" : "vigente";
}

/* ------------------------------------------------------- número interno --- */

/** Primer número de la numeración (parámetro numeracion_muestra.inicio); 1 si no es válido. */
export function inicioNumeracion(valor: string | null | undefined): number {
  const n = Number(String(valor ?? "").trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/* --------------------------------------------------------------- bandeja --- */

export type OrigenBandeja = "DCO" | "OT interna" | "BPCH";
const ORIGENES_BPCH = ["INTERNACION", "REINSPECCION", "PRODUCCION_NACIONAL", "PROTOTIPO"];
const ORIGENES_INTERNOS = ["OT_INTERNA", "INTERLABORATORIO"];

/** De dónde viene el trabajo en la bandeja de entrada del laboratorio (EP-01 §1.2). */
export function origenBandeja(ot: { origen?: string | null; tipoTrabajo?: string | null; esOrdenInterna?: boolean }): OrigenBandeja {
  if (ot.esOrdenInterna) return "OT interna";
  const o = (ot.origen ?? "").toUpperCase();
  const t = (ot.tipoTrabajo ?? "").toUpperCase();
  if (ORIGENES_BPCH.includes(o) || ORIGENES_BPCH.includes(t)) return "BPCH";
  if (ORIGENES_INTERNOS.includes(o)) return "OT interna";
  return "DCO";
}

export type Semaforo = "vencido" | "por_vencer" | "a_tiempo" | "sin_plazo";

/** Semáforo del plazo: vencido, por vencer (≤ 2 días) o a tiempo. */
export function semaforoPlazo(compromiso: string | null | undefined, hoy: string, diasAviso = 2): Semaforo {
  if (!compromiso) return "sin_plazo";
  const c = compromiso.slice(0, 10);
  if (c < hoy) return "vencido";
  const dias = Math.round((Date.parse(c) - Date.parse(hoy)) / 86_400_000);
  return dias <= diasAviso ? "por_vencer" : "a_tiempo";
}
