/**
 * Solicitud de adquisición (IDIC-PG06-IT02-FORM01 Rev. 02) · reglas PURAS (sin
 * BD), probadas en reglas-adquisicion.spec.ts.
 *
 * Compromiso con el Depto. Comercial (respuesta SPC 5, oct-2026): es el mismo
 * procedimiento, digitalizado dentro del IDIC. El laboratorio crea la
 * solicitud, su jefatura da el V°B° y la Sección Abastecimiento (SAB) la
 * recibe; luego SAB anota el Nº de la O/C y su estado. Convive con los sistemas
 * de compra de SAB y Finanzas: no maneja presupuesto, ni las firmas de Finanzas
 * y Dirección, ni emite la O/C.
 *
 *   borrador ──enviar──▶ enviada ──V°B°──▶ visada ──recibir (SAB)──▶ recibida_sab ──O/C──▶ en_compra ──bodega──▶ recibida_bodega
 *                          │ devolver        │ devolver (SAB)          │ devolver (SAB)
 *                          ▼                 ▼                         ▼
 *                       devuelta ──corregir y enviar──▶ enviada (pide un V°B° nuevo)
 *   borrador | enviada | devuelta (laboratorio) · visada | recibida_sab | en_compra (SAB) ──anular──▶ anulada
 */
import { escapeHtml } from "../plantilla-render/html.util";

export const ESTADOS_ADQUISICION = [
  "borrador",
  "enviada",
  "devuelta",
  "visada",
  "recibida_sab",
  "en_compra",
  "recibida_bodega",
  "anulada",
] as const;
export type EstadoAdquisicion = (typeof ESTADOS_ADQUISICION)[number];

export const TEXTO_ESTADO_ADQUISICION: Record<EstadoAdquisicion, string> = {
  borrador: "en borrador",
  enviada: "enviada a la jefatura",
  devuelta: "devuelta",
  visada: "con V°B° de la jefatura",
  recibida_sab: "recibida por Abastecimiento",
  en_compra: "en proceso de compra",
  recibida_bodega: "recibida en bodega",
  anulada: "anulada",
};

/** Quién ejecuta cada acción: el laboratorio, su jefatura o Abastecimiento (SAB). */
export type Actor = "laboratorio" | "jefatura" | "sab";

export type AccionAdquisicion = "enviar" | "visar" | "devolver" | "recibir_sab" | "registrar_oc" | "recibir_bodega" | "anular";

interface ReglaAccion {
  desde: Partial<Record<EstadoAdquisicion, Actor[]>>;
  /** Estado al que lleva (registrar_oc en «en_compra» solo corrige los datos de la O/C). */
  hasta: EstadoAdquisicion;
  verbo: string;
}

export const ACCIONES_ADQUISICION: Record<AccionAdquisicion, ReglaAccion> = {
  enviar: { desde: { borrador: ["laboratorio"], devuelta: ["laboratorio"] }, hasta: "enviada", verbo: "enviar a la jefatura" },
  visar: { desde: { enviada: ["jefatura"] }, hasta: "visada", verbo: "dar el V°B°" },
  devolver: { desde: { enviada: ["jefatura"], visada: ["sab"], recibida_sab: ["sab"] }, hasta: "devuelta", verbo: "devolver" },
  recibir_sab: { desde: { visada: ["sab"] }, hasta: "recibida_sab", verbo: "recibir en Abastecimiento" },
  registrar_oc: { desde: { recibida_sab: ["sab"], en_compra: ["sab"] }, hasta: "en_compra", verbo: "registrar la orden de compra" },
  recibir_bodega: { desde: { en_compra: ["sab"] }, hasta: "recibida_bodega", verbo: "marcar como recibida en bodega" },
  anular: {
    desde: { borrador: ["laboratorio"], enviada: ["laboratorio"], devuelta: ["laboratorio"], visada: ["sab"], recibida_sab: ["sab"], en_compra: ["sab"] },
    hasta: "anulada",
    verbo: "anular",
  },
};

const esEstado = (e: string): e is EstadoAdquisicion => (ESTADOS_ADQUISICION as readonly string[]).includes(e);

/** Error si `actor` no puede ejecutar `accion` con la solicitud en `estado`; null si puede. */
export function errorTransicion(estado: string, accion: AccionAdquisicion, actor: Actor): string | null {
  if (!esEstado(estado)) return `Estado desconocido de la solicitud: ${estado}.`;
  const regla = ACCIONES_ADQUISICION[accion];
  const actores = regla.desde[estado];
  if (!actores) return `La solicitud está ${TEXTO_ESTADO_ADQUISICION[estado]}: no se puede ${regla.verbo}.`;
  if (!actores.includes(actor)) {
    const quien = actores.map((a) => (a === "laboratorio" ? "el laboratorio solicitante" : a === "jefatura" ? "la jefatura del laboratorio" : "Abastecimiento (SAB)")).join(" o ");
    return `Con la solicitud ${TEXTO_ESTADO_ADQUISICION[estado]}, solo ${quien} puede ${regla.verbo}.`;
  }
  return null;
}

/** Estado resultante de la acción (sin validar: use errorTransicion antes). */
export const estadoTras = (accion: AccionAdquisicion): EstadoAdquisicion => ACCIONES_ADQUISICION[accion].hasta;

/** Solo se corrige una solicitud en borrador o devuelta. */
export const editableAdquisicion = (estado: string) => estado === "borrador" || estado === "devuelta";

/** «Quien crea no da su propio V°B°». */
export function errorAutoVisado(creadoPor: string | null | undefined, yo: string | null | undefined): string | null {
  if (creadoPor && yo && creadoPor === yo) return "Usted creó esta solicitud: el V°B° lo da otra persona de la jefatura del laboratorio.";
  return null;
}

export interface Capacidades {
  esCreador: boolean;
  /** adquisicion.crear en el laboratorio de la solicitud. */
  laboratorio: boolean;
  /** adquisicion.visar en el laboratorio de la solicitud. */
  jefatura: boolean;
  /** adquisicion.gestionar (Abastecimiento). */
  sab: boolean;
}

/** Acciones que la persona puede ejecutar ahora (para los botones de la ficha). */
export function accionesDisponibles(estado: string, c: Capacidades): AccionAdquisicion[] {
  const out: AccionAdquisicion[] = [];
  for (const a of Object.keys(ACCIONES_ADQUISICION) as AccionAdquisicion[]) {
    const actores: Actor[] = [];
    if (c.laboratorio) actores.push("laboratorio");
    if (c.jefatura && !(a === "visar" && c.esCreador)) actores.push("jefatura");
    if (c.sab) actores.push("sab");
    if (actores.some((x) => !errorTransicion(estado, a, x))) out.push(a);
  }
  return out;
}

/* --------------------------------------------------------- validaciones --- */

export const MAX_ITEMS = 40;

export interface ItemSolicitud {
  cantidad: number;
  unidadMedida?: string | null;
  descripcion: string;
  valorUnitario?: number | null;
  consumibleId?: string | null;
  equipoId?: string | null;
}

export interface DatosSolicitud {
  centroCosto: string;
  solicitanteNombre: string;
  objetivo: string;
  items: ItemSolicitud[];
}

/** Errores del contenido de la solicitud (al guardar y antes de enviarla). */
export function erroresSolicitud(d: DatosSolicitud): string[] {
  const e: string[] = [];
  if ((d.centroCosto ?? "").trim().length < 3) e.push("Indique el nombre y centro de costo del solicitante.");
  if ((d.solicitanteNombre ?? "").trim().length < 3) e.push("Indique el nombre del usuario solicitante.");
  if ((d.objetivo ?? "").trim().length < 5) e.push("Indique el objetivo de la adquisición (al menos 5 caracteres).");
  if (!d.items?.length) e.push("Agregue al menos un bien o servicio a la solicitud.");
  if ((d.items?.length ?? 0) > MAX_ITEMS) e.push(`La solicitud admite como máximo ${MAX_ITEMS} ítems: divídala en dos.`);
  (d.items ?? []).forEach((it, i) => {
    const n = `Ítem ${i + 1}:`;
    if (!Number.isFinite(it.cantidad) || it.cantidad <= 0) e.push(`${n} la cantidad a adquirir debe ser mayor que 0.`);
    if ((it.descripcion ?? "").trim().length < 3) e.push(`${n} describa el bien o servicio requerido.`);
    if (it.valorUnitario != null && (!Number.isFinite(it.valorUnitario) || it.valorUnitario < 0)) e.push(`${n} el valor unitario no puede ser negativo.`);
    if (it.consumibleId && it.equipoId) e.push(`${n} vincúlelo a un consumible o a un equipo, no a ambos.`);
  });
  return e;
}

/** Errores de los datos de la O/C que anota SAB (Nº, fecha y proveedor). */
export function erroresOrdenCompra(d: { numero: string; fecha: string; proveedor: string; hoy: string }): string[] {
  const e: string[] = [];
  if (!(d.numero ?? "").trim()) e.push("Indique el Nº de la orden de compra.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? "")) e.push("Indique la fecha de la orden de compra.");
  else if (d.fecha > d.hoy) e.push("La fecha de la orden de compra no puede ser futura.");
  if ((d.proveedor ?? "").trim().length < 2) e.push("Indique el proveedor de la orden de compra.");
  return e;
}

/** Errores de la recepción en bodega (fecha no futura ni anterior a la O/C). */
export function erroresRecepcionBodega(d: { fecha: string; hoy: string; fechaOc?: string | null }): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? "")) return ["Indique la fecha de recepción en bodega."];
  if (d.fecha > d.hoy) return ["La fecha de recepción en bodega no puede ser futura."];
  if (d.fechaOc && d.fecha < d.fechaOc) return ["La recepción en bodega no puede ser anterior a la fecha de la orden de compra."];
  return [];
}

/* -------------------------------------------------------------- totales --- */

export const TASA_IVA = 0.19;

/** Valores del formulario: TOTAL por ítem, SUB-TOTAL, 19 % IVA y TOTAL (valor referencial), en pesos enteros. */
export function totales(items: Pick<ItemSolicitud, "cantidad" | "valorUnitario">[], aplicaIva: boolean) {
  const lineas = items.map((i) => (i.valorUnitario == null ? null : Math.round(Number(i.cantidad) * Number(i.valorUnitario))));
  const subtotal = lineas.reduce<number>((a, x) => a + (x ?? 0), 0);
  const iva = aplicaIva ? Math.round(subtotal * TASA_IVA) : 0;
  return { lineas, subtotal, iva, total: subtotal + iva, sinValor: lineas.some((x) => x == null) };
}

/** Ítems ligados a un consumible del kardex: se ofrece registrar el ingreso del lote en Bodegas. */
export function itemsParaIngresoBodega<T extends { consumibleId?: string | null }>(items: T[]): T[] {
  return items.filter((i) => !!i.consumibleId);
}

/* ----------------------------------------------------------------- HTML --- */

export interface VistaSolicitud {
  numero: string | null;
  estado: EstadoAdquisicion;
  fecha: string; // AAAA-MM-DD
  centroCosto: string;
  solicitanteNombre: string;
  solicitanteCargo: string | null;
  delegacionAtribuciones: boolean;
  objetivo: string;
  aplicaIva: boolean;
  items: (ItemSolicitud & { vinculo?: string | null })[];
  ot: string | null;
  vb: { nombre: string; cargo: string | null; fecha: string } | null;
  sab: { numero: string | null; fecha: string | null; nombre: string | null } | null;
  oc: { numero: string; fecha: string; proveedor: string; estado: string | null } | null;
}

const pesos = (n: number | null) => (n == null ? "" : `$${n.toLocaleString("es-CL", { maximumFractionDigits: 0 })}`);
const ddmmaaaa = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

/**
 * Cuerpo del formulario IDIC-PG06-IT02-FORM01 en el subconjunto de HTML del
 * renderizador PDF. Mismas secciones y rótulos que la planilla del IDIC; los
 * casilleros de Finanzas (clasificación, Subt./Ítem/Asig., Nº de registro,
 * montos del ítem) y las firmas de Finanzas y Dirección quedan en blanco: se
 * completan a mano, fuera del LIMS. Todo dato del usuario va escapado.
 */
export function htmlSolicitud(v: VistaSolicitud): string {
  const t = totales(v.items, v.aplicaIva);
  const [a, m, d] = (v.fecha ?? "").split("-");
  const filas = v.items
    .map((it, i) => {
      const desc = [it.descripcion, it.unidadMedida ? `(${it.unidadMedida})` : "", it.vinculo ? `· ${it.vinculo}` : ""].filter(Boolean).join(" ");
      return `<tr><td class="num">${i + 1}</td><td class="num">${escapeHtml(String(it.cantidad).replace(".", ","))}</td><td>${escapeHtml(desc)}</td><td></td><td class="num">${escapeHtml(pesos(it.valorUnitario == null ? null : Math.round(Number(it.valorUnitario))))}</td><td class="num">${escapeHtml(pesos(t.lineas[i]))}</td></tr>`;
    })
    .join("");
  const vb = v.vb ? `V°B° ${v.vb.nombre}${v.vb.cargo ? `, ${v.vb.cargo}` : ""} · ${v.vb.fecha}` : "Responsable del Depto./Sección solicitante";
  const sab = v.sab?.nombre ? `Recibida por ${v.sab.nombre}${v.sab.fecha ? ` · ${v.sab.fecha}` : ""}` : "Jefe Sección Abastecimiento";
  return [
    `<div class="membrete"><div class="escudo">IDIC</div><div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b><span>Ejército de Chile</span></div>`,
    `<div class="doc"><b>IDIC-PG06-IT02-FORM01</b><span>Revisión 02 · Emisión 02/01/2026</span></div></div>`,
    `<h1>SOLICITUD DE ADQUISICIÓN DE BIENES Y/O SERVICIOS</h1>`,
    `<table class="meta"><tr><th>USO EXCLUSIVO SAB · Nº (registro interno Sección Abastecimiento)</th><td>${escapeHtml(v.sab?.numero ?? "")}</td>`,
    `<th>Fecha</th><td>${escapeHtml(v.sab?.fecha ?? "")}</td></tr></table>`,
    `<h2>Datos del solicitante</h2>`,
    `<table class="meta"><tr><th>Nombre y centro de costo del solicitante</th><td>${escapeHtml(v.centroCosto)}</td>`,
    `<th>Fecha (D/M/A)</th><td>${escapeHtml(d && m && a ? `${d}/${m}/${a}` : "")}</td></tr>`,
    `<tr><th>Nº registro (interno centro de costo solicitante)</th><td>${escapeHtml(v.numero ?? "(se asigna al enviar)")}</td>`,
    `<th>Nombre del usuario solicitante</th><td>${escapeHtml([v.solicitanteNombre, v.solicitanteCargo].filter(Boolean).join(" · "))}</td></tr>`,
    `<tr><th>Compra con delegación de atribuciones</th><td>${v.delegacionAtribuciones ? "SÍ (X)" : "NO (X)"}</td>`,
    `<th>OT relacionada</th><td>${escapeHtml(v.ot ?? "—")}</td></tr></table>`,
    `<table class="rep"><thead><tr><th class="num">ID</th><th class="num">Cantidad a adquirir</th>`,
    `<th>Características detalladas del bien o servicio requerido (cantidad de unidades, envases, unidad de medida)</th>`,
    `<th>Uso y aprobación exclusiva del Depto. de Finanzas (clasificación · Subt. · Ítem · Asig. · Denominación)</th>`,
    `<th class="num">Valor unitario</th><th class="num">Valor total</th></tr></thead><tbody>${filas}`,
    `<tr><td></td><td></td><td></td><td></td><th class="num">SUB-TOTAL</th><td class="num">${escapeHtml(pesos(t.subtotal))}</td></tr>`,
    `<tr><td></td><td></td><td></td><td></td><th class="num">19% IVA</th><td class="num">${v.aplicaIva ? escapeHtml(pesos(t.iva)) : ""}</td></tr>`,
    `<tr><td></td><td></td><td></td><td></td><th class="num">TOTAL (valor referencial)</th><td class="num">${escapeHtml(pesos(t.total))}</td></tr>`,
    `</tbody></table>`,
    `<p class="nota">(Indicar valor de referencia final, impuestos incluidos, del bien a adquirir.)${t.sinValor ? " Hay ítems sin valor estimado." : ""}</p>`,
    `<h2>Objetivo de la adquisición</h2>`,
    `<p>${escapeHtml(v.objetivo)}</p>`,
    `<table class="meta"><tr><th>Nº registro (interno Sección Finanzas) · Firma y timbre Jefe de Presupuesto</th><td></td></tr>`,
    `<tr><th>Monto asignado al ítem · Gastado incluyendo esta adquisición · Saldo disponible</th><td></td></tr></table>`,
    v.oc
      ? `<h2>Orden de compra (registrada por SAB)</h2><table class="meta"><tr><th>Nº O/C</th><td>${escapeHtml(v.oc.numero)}</td><th>Fecha</th><td>${escapeHtml(ddmmaaaa(v.oc.fecha))}</td></tr><tr><th>Proveedor</th><td>${escapeHtml(v.oc.proveedor)}</td><th>Estado</th><td>${escapeHtml(v.oc.estado ?? "—")}</td></tr></table>`
      : "",
    `<div class="firmas"><div class="firma"><span class="linea"></span>${escapeHtml(vb)}</div><div class="firma"><span class="linea"></span>Responsable cuenta centralizada</div><div class="firma"><span class="linea"></span>${escapeHtml(sab)}</div></div>`,
    `<div class="firmas"><div class="firma"><span class="linea"></span>Jefe Departamento Finanzas</div><div class="firma"><span class="linea"></span>Subdirector del IDIC</div><div class="firma"><span class="linea"></span>V°B° Director del IDIC</div></div>`,
    `<p class="nota">Nota 1) Todas las solicitudes superiores a 800 UTM que se tramiten por Licitación Pública o superiores a 300 UTM que se tramiten por trato directo deben incluir el oficio conductor por «Solicitud de Delegación» y la proposición de oficio por «Delegación de Atribuciones», con su «Certificado de Fondos» del Departamento de Finanzas.</p>`,
    `<p class="nota">Nota 2) Este documento lo realiza directamente el usuario solicitante con visación del Asesor Jurídico y debe incluir en su distribución al Departamento de Finanzas y a la Sección de Abastecimiento.</p>`,
    `<p class="nota">El V°B° de la jefatura y la recepción en Abastecimiento quedan registrados en el LIMS. Las firmas de Finanzas y Dirección y la emisión de la O/C siguen en los sistemas de SAB y Finanzas.</p>`,
  ].join("");
}
