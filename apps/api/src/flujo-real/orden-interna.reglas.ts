/**
 * Órdenes internas · reglas PURAS (sin BD), probadas en orden-interna.reglas.spec.ts.
 *
 * Una orden interna deriva parte de una OT a OTRO laboratorio: se elige el
 * laboratorio de destino (familia del catálogo, enlazada con su unidad del
 * organigrama por CODSUCDEL) y los ensayos del catálogo que le corresponden.
 *
 *  · Ciclo: abierta → recibida → cerrada. Mientras está ABIERTA (el laboratorio
 *    de destino aún no la recibe) se edita y se puede borrar; después solo
 *    avanza de estado. Se anula con motivo en cualquier estado salvo cerrada.
 *  · El destino no puede ser el laboratorio responsable de la OT.
 *  · Los ensayos deben ser de la familia del destino (no se derivan ensayos de
 *    otro laboratorio) y no se repiten.
 *  · La OT de origen debe estar en el alcance de quien crea, edita o anula
 *    (lo impone el controlador con AlcanceService; ver orden-interna-alcance.spec.ts).
 */

export const ESTADOS_OI = ["abierta", "recibida", "cerrada", "anulada"] as const;
export type EstadoOi = (typeof ESTADOS_OI)[number];

/** Siguiente estado válido desde cada estado (sin contar anular). */
const SIGUIENTE: Record<string, string[]> = {
  abierta: ["recibida"],
  recibida: ["cerrada"],
  cerrada: [],
  anulada: [],
};

/** Campos de contenido: solo cambian mientras la orden está abierta. */
export const CAMPOS_CONTENIDO = [
  "tipo", "destinoLab", "origenLab", "ensayos", "detalle", "muestraId", "requisito", "fechaEnvio", "ieReferencia",
] as const;

export interface CambioOi {
  tipo?: string;
  destinoLab?: string | null;
  origenLab?: string | null;
  ensayos?: string[];
  detalle?: string | null;
  muestraId?: string | null;
  requisito?: string | null;
  fechaEnvio?: string | null;
  ieReferencia?: string | null;
  estado?: string;
  otId?: string;
}

/** Normaliza la lista de ensayos: sin vacíos ni repetidos. */
export function normalizarEnsayos(ensayos?: string[] | null): string[] {
  return [...new Set((ensayos ?? []).map((e) => String(e).trim()).filter(Boolean))];
}

/**
 * Errores del contenido de la orden (lista vacía = válida).
 * @param destinoEsPrincipal el destino es el laboratorio responsable de la OT
 * @param ensayosDelDestino ids de cat_ensayo de la familia de destino (vigentes)
 */
export function erroresContenido(d: {
  destinoLab?: string | null;
  ensayos?: string[];
  destinoEsPrincipal?: boolean;
  ensayosDelDestino?: Set<string> | null;
}): string[] {
  const e: string[] = [];
  const ensayos = normalizarEnsayos(d.ensayos);
  if (d.destinoEsPrincipal) e.push("El laboratorio de destino es el responsable de la OT: una orden interna se emite a OTRO laboratorio.");
  if (ensayos.length && !d.destinoLab) e.push("Indique el laboratorio de destino de los ensayos.");
  if (ensayos.length && d.ensayosDelDestino) {
    const ajenos = ensayos.filter((x) => !d.ensayosDelDestino!.has(x));
    if (ajenos.length) e.push(`${ajenos.length} ensayo(s) no son del laboratorio de destino: elija solo ensayos de ese laboratorio.`);
  }
  if (ensayos.length > 200) e.push("Como máximo 200 ensayos por orden interna.");
  return e;
}

/**
 * ¿Se puede aplicar el cambio a una orden en `estado`? Devuelve el motivo del
 * rechazo o null. Reglas: la OT de una orden no cambia; el contenido solo
 * mientras está abierta; el estado avanza de uno en uno (abierta → recibida →
 * cerrada); anulada y cerrada no cambian; anular tiene su propia acción.
 */
export function motivoNoEditable(estado: string | null | undefined, cambio: CambioOi): string | null {
  const actual = estado ?? "abierta";
  if (cambio.otId !== undefined) return "La OT de una orden interna no se cambia: anúlela y emita otra en la OT correcta.";
  if (actual === "anulada") return "La orden interna está anulada: no admite cambios.";
  if (actual === "cerrada") return "La orden interna está cerrada: no admite cambios.";
  const tocaContenido = CAMPOS_CONTENIDO.some((c) => cambio[c] !== undefined);
  if (tocaContenido && actual !== "abierta")
    return "La orden interna ya fue recibida por el laboratorio de destino: solo se puede avanzar su estado o anularla.";
  if (cambio.estado !== undefined && cambio.estado !== actual) {
    if (cambio.estado === "anulada") return "Para anular use «Anular» e indique el motivo.";
    if (!(SIGUIENTE[actual] ?? []).includes(cambio.estado))
      return `No se puede pasar de «${actual}» a «${cambio.estado}» (abierta → recibida → cerrada).`;
  }
  return null;
}

/** ¿Se puede anular? Devuelve el motivo del rechazo o null. */
export function motivoNoAnulable(estado: string | null | undefined, motivo: string | null | undefined): string | null {
  const actual = estado ?? "abierta";
  if (actual === "anulada") return "La orden interna ya está anulada.";
  if (actual === "cerrada") return "La orden interna está cerrada: el laboratorio de destino ya terminó su trabajo.";
  if ((motivo ?? "").trim().length < 5) return "Indique el motivo de la anulación (mínimo 5 caracteres).";
  return null;
}

/** ¿Se puede borrar? Solo una orden abierta (no recibida aún); si no, se anula. */
export function motivoNoBorrable(estado: string | null | undefined): string | null {
  return (estado ?? "abierta") === "abierta" ? null : "Solo se borra una orden interna abierta; en otro estado, anúlela con motivo.";
}

/** unidad.codsucdel admite varios códigos («7003/7004»). */
export function codigosSucdel(codsucdel: string | null | undefined): string[] {
  return String(codsucdel ?? "")
    .split(/[\s,;/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/* ========================================================================== */
/* Emisión, recepción, respuesta y cierre (frente r1b · EP-01 2.2, 0.6, 3.7, 5.5) */
/* ========================================================================== */

/**
 * Datos obligatorios al emitir (EP-01 2.2 «OT {código} · Órdenes internas ·
 * Nueva»): muestra de origen, requisito y punto de la especificación, y fecha
 * de envío de la muestra (no futura más allá de 60 días ni anterior a la OT).
 */
export function erroresEmision(d: {
  muestraId?: string | null;
  muestraDeLaOt?: boolean;
  requisito?: string | null;
  fechaEnvio?: string | null;
  fechaOt?: Date | string | null;
  hoy?: Date;
}): string[] {
  const e: string[] = [];
  if (!d.muestraId) e.push("Indique la muestra de origen que se envía al laboratorio de destino.");
  else if (d.muestraDeLaOt === false) e.push("La muestra de origen no es de esta OT.");
  if ((d.requisito ?? "").trim().length < 3) e.push("Indique el requisito y el punto de la especificación que debe evaluar el destino.");
  if (!d.fechaEnvio) e.push("Indique la fecha de envío de la muestra.");
  else {
    const f = new Date(`${String(d.fechaEnvio).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(f.getTime())) e.push("La fecha de envío no es válida.");
    else {
      const hoy = d.hoy ?? new Date();
      const limite = new Date(hoy.getTime() + 60 * 86_400_000);
      if (f > limite) e.push("La fecha de envío no puede estar a más de 60 días.");
      if (d.fechaOt) {
        const ot = new Date(d.fechaOt);
        ot.setHours(0, 0, 0, 0);
        if (!Number.isNaN(ot.getTime()) && f < ot) e.push("La fecha de envío no puede ser anterior a la apertura de la OT.");
      }
    }
  }
  return e;
}

/** ¿Puede el laboratorio de destino recibirla? Solo una orden abierta. */
export function motivoNoRecibible(estado: string | null | undefined): string | null {
  const a = estado ?? "abierta";
  if (a === "abierta") return null;
  if (a === "recibida") return "La orden interna ya fue recibida.";
  return `La orden interna está ${a}: no se puede recibir.`;
}

export interface RespuestaOi {
  informe?: string | null;
  horas?: number | null;
  insumos?: string | null;
  costoDirecto?: number | null;
}

/** Errores de la respuesta del destino (horas y costo directo obligatorios, no negativos). */
export function erroresRespuesta(estado: string | null | undefined, r: RespuestaOi): string[] {
  const e: string[] = [];
  if ((estado ?? "abierta") !== "recibida")
    e.push(estado === "abierta" ? "Reciba primero la orden interna." : `La orden interna está ${estado}: no admite respuesta.`);
  if (r.horas === null || r.horas === undefined || !Number.isFinite(r.horas)) e.push("Indique las horas dedicadas.");
  else if (r.horas < 0 || r.horas > 9999) e.push("Las horas deben estar entre 0 y 9999.");
  if (r.costoDirecto === null || r.costoDirecto === undefined || !Number.isFinite(r.costoDirecto)) e.push("Indique el costo directo.");
  else if (r.costoDirecto < 0) e.push("El costo directo no puede ser negativo.");
  return e;
}

/** Resultado de un ensayo derivado, en la muestra de la OT de origen. */
export interface ResultadoDerivado {
  ensayoId: string;
  ensayo: string;
  estado: string | null;
  valor: number | null;
  texto: string | null;
  observacion: string | null;
}

const CAPTURADOS = ["capturado", "revisado_n1", "revisado", "aprobado"];

/**
 * Qué falta para que el destino cierre la orden y devuelva el informe
 * («Cerrar OT interna → devolver al solicitante», EP-01 5.5):
 *   · estar recibida y con la respuesta guardada (horas y costo directo);
 *   · cada ensayo derivado con su resultado capturado, revisado y APROBADO por el
 *     destino en la muestra (cerrada la orden, el destino ya no lo trabaja);
 *   · ningún resultado en 0,00 sin observación: en el LIMS antiguo el destino
 *     dejaba 0,00 como marcador y el IVC informaba otro valor (EP-03 3.5, EP-05 4.10).
 */
export function faltantesCierreOi(p: {
  estado: string | null | undefined;
  respondida: boolean;
  ensayos: { id: string; nombre: string }[];
  resultados: ResultadoDerivado[];
}): string[] {
  const f: string[] = [];
  const estado = p.estado ?? "abierta";
  if (estado !== "recibida") {
    f.push(estado === "abierta" ? "La orden interna aún no se ha recibido." : `La orden interna está ${estado}.`);
    return f;
  }
  if (!p.respondida) f.push("Guarde la respuesta (horas y costo directo) antes de cerrar.");
  for (const e of p.ensayos) {
    const rs = p.resultados.filter((r) => r.ensayoId === e.id);
    if (!rs.length) {
      f.push(`El ensayo ${e.nombre} no tiene resultado en la muestra.`);
      continue;
    }
    const sin = rs.filter((r) => !CAPTURADOS.includes(r.estado ?? ""));
    if (sin.length) f.push(`El ensayo ${e.nombre} tiene ${sin.length} resultado(s) sin capturar.`);
    // El destino revisa y aprueba lo suyo antes de devolverlo (EP-02 4.1; recorrido
    // MP-02, D02-02): cerrada la orden, ya nadie puede aprobar un derivado.
    const sinAprobar = rs.filter((r) => CAPTURADOS.includes(r.estado ?? "") && r.estado !== "aprobado");
    if (sinAprobar.length)
      f.push(`El ensayo ${e.nombre} tiene ${sinAprobar.length} resultado(s) sin aprobar: revíselos y apruébelos en «Captura y revisión por OT» antes de cerrar.`);
    // El texto del valor no explica el cero si es solo el número («0», «0,00»).
    const explica = (t: string | null) => Boolean((t ?? "").trim()) && !/^[\s\d.,+-]*$/.test(t ?? "");
    const ceros = rs.filter((r) => CAPTURADOS.includes(r.estado ?? "") && r.valor === 0 && !explica(r.texto) && !(r.observacion ?? "").trim());
    if (ceros.length)
      f.push(`El ensayo ${e.nombre} tiene un resultado 0,00 sin observación: registre el valor real o explique el cero (p. ej. «< LD»).`);
  }
  return f;
}

/** ¿Puede el solicitante darla por recibida? Solo cerrada y una vez. */
export function motivoNoAceptable(estado: string | null | undefined, aceptadaAt: Date | string | null | undefined): string | null {
  if ((estado ?? "") !== "cerrada") return "El laboratorio de destino aún no ha cerrado la orden interna con su informe.";
  if (aceptadaAt) return "La orden interna ya se dio por recibida.";
  return null;
}

/** Paso del ciclo en que está la orden (para la barra de 5 pasos de la ficha). */
export function pasoOi(o: { estado: string; respondidaAt?: unknown; aceptadaAt?: unknown }): number {
  if (o.estado === "anulada") return 0;
  if (o.estado === "abierta") return 1;
  if (o.estado === "recibida") return o.respondidaAt ? 3 : 2;
  if (o.estado === "cerrada") return o.aceptadaAt ? 5 : 4;
  return 1;
}
