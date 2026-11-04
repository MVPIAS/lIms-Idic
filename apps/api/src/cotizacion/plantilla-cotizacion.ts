/**
 * Diseño propio de la cotización (contrato 4.6.8) · plantilla «Cotización» del
 * repositorio de plantillas con versiones (align_plantilla_versiones.sql).
 *
 *  · La cotización deja de tener el diseño fijo en el código: su cuerpo es la
 *    versión VIGENTE de la plantilla de tipo COTIZACION (REPID DCO-FORM04),
 *    con el mismo circuito que los informes (borrador → aprobación por Calidad
 *    → vigente; la anterior queda retirada).
 *  · La versión 1 (packages/db/align_brechas_4.sql) es CUERPO_COTIZACION_FORM04,
 *    que con el motor de plantillas da EXACTAMENTE el mismo HTML que el formato
 *    fijo `cuerpoCotizacionHtml` (probado en plantilla-cotizacion.spec.ts): el
 *    PDF no cambia mientras no se apruebe otra versión.
 *  · Si la versión vigente falla (marca mal escrita, variable inexistente,
 *    condicional anidado que el motor no resuelve, error al rendir), se usa la
 *    vigente anterior (la RETIRADA más reciente) y, en último caso, el formato
 *    fijo del código.
 *  · Las firmas del circuito (Ejecutivo que elabora, Jefe DCO que firma) se
 *    estampan FUERA del cuerpo, como hasta ahora; sus nombres y fechas también
 *    están disponibles como variables para redactar textos.
 *
 * Reglas puras salvo `versionesCotizacion` (lee la BD que se le pase).
 */
import { Logger } from "@nestjs/common";
import { renderizar } from "../plantilla-render/template.engine";
import { clp, cuerpoCotizacionHtml, esc, etiquetaFormaPago, fechaCorta, fechaHoraCl, fechaUtc, usdFmt, type FirmasCotizacion } from "./cotizacion-documento";

const logger = new Logger("PlantillaCotizacion");

export const TIPO_PLANTILLA_COTIZACION = "COTIZACION";
export const REPID_COTIZACION = "DCO-FORM04";

/**
 * Cuerpo del FORM04 (DCO-PG01-P01-IT02-FORM04) escrito como plantilla. Debe
 * coincidir carácter a carácter con el que siembra align_brechas_4.sql (lo
 * comprueba el spec) y, rendido, con `cuerpoCotizacionHtml`.
 */
export const CUERPO_COTIZACION_FORM04 = `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Cotización comercial</span>
  </div>
  <div class="doc">
    <b>{{cotizacion.codigo}}</b>
    <span>Cotización</span>
  </div>
</div>

<h1>COTIZACIÓN</h1>

<table class="meta">
  <tr><th>Cliente</th><td>{{cliente.razon_social}}</td><th>RUT</th><td>{{cliente.rut}}</td></tr>
  <tr><th>Código</th><td>{{cotizacion.codigo}}</td><th>Fecha</th><td>{{cotizacion.fecha}}</td></tr>
  <tr><th>Forma de pago</th><td>{{cotizacion.forma_pago}}</td><th>Validez</th><td>{{cotizacion.validez}}</td></tr>
  {{#si cotizacion.referencia}}<tr><th>Referencia</th><td colspan="3">{{cotizacion.referencia}}</td></tr>{{/si}}
  {{#si cotizacion.plazo_entrega_dias}}<tr><th>Plazo de entrega</th><td colspan="3">{{cotizacion.plazo_entrega_dias}} días corridos desde la recepción de las muestras o ítems</td></tr>{{/si}}
  {{#si cotizacion.es_usd}}<tr><th>Moneda</th><td>US$</td><th>Dólar del día</th><td>{{cotizacion.dolar_texto}}</td></tr>{{/si}}
</table>

{{#si cotizacion.descripcion_tecnica}}<h2>Descripción técnica y alcance</h2>{{descripcion_tecnica_parrafos}}{{/si}}

<h2>Detalle</h2>
<table class="rep">
  <thead>
    <tr><th>#</th><th>Ensayo / descripción</th><th class="num">Cantidad</th><th class="num">P. unitario</th><th class="num">Subtotal</th></tr>
  </thead>
  <tbody>
    {{filas_detalle}}
  </tbody>
</table>

<h2>Totales</h2>
<table class="meta">
  <tr><th>Subtotal</th><td>{{totales.subtotal}}</td><th>Neto</th><td>{{totales.neto}}</td></tr>
  <tr><th>IVA</th><td>{{totales.iva}}</td><th>TOTAL</th><td>{{totales.total}}</td></tr>
</table>

{{#si cotizacion.condiciones_adicionales}}<h2>Condiciones adicionales</h2>{{condiciones_adicionales_parrafos}}{{/si}}

<p class="nota">Documento generado por el sistema LIMS IDIC. Los valores están expresados en {{cotizacion.moneda_texto}}.</p>`;

/* --------------------------------------------------------------- variables --- */

export interface VariableCotizacion {
  clave: string;
  descripcion: string;
  /** Bloque HTML generado (no se escapa; no sirve en {{#si}}). */
  bloque?: boolean;
}

/**
 * Variables documentadas de la plantilla de cotización (pantalla «Versiones de
 * plantillas»). Todas existen siempre en el contexto (vacías si no hay dato).
 */
export const VARIABLES_COTIZACION: VariableCotizacion[] = [
  { clave: "cotizacion.codigo", descripcion: "Código de la cotización (p. ej. COT-2026-0123)" },
  { clave: "cotizacion.fecha", descripcion: "Fecha de emisión (dd-mm-aaaa)" },
  { clave: "cotizacion.validez", descripcion: "Validez en texto: «hasta el dd-mm-aaaa» o «30 días»" },
  { clave: "cotizacion.valida_hasta", descripcion: "Fecha hasta la que vale (vacía si aún no se emite)" },
  { clave: "cotizacion.validez_dias", descripcion: "Días de validez" },
  { clave: "cotizacion.forma_pago", descripcion: "Forma de pago (Contado 30 días, Por adelantado…)" },
  { clave: "cotizacion.referencia", descripcion: "Referencia del cliente" },
  { clave: "cotizacion.plazo_entrega_dias", descripcion: "Plazo de entrega en días corridos (vacío si no se indicó)" },
  { clave: "cotizacion.descripcion_tecnica", descripcion: "Descripción técnica y alcance (texto plano)" },
  { clave: "cotizacion.condiciones_adicionales", descripcion: "Condiciones adicionales (texto plano)" },
  { clave: "cotizacion.moneda", descripcion: "Moneda: CLP o USD" },
  { clave: "cotizacion.moneda_texto", descripcion: "«pesos chilenos (CLP)» o «dólares estadounidenses (US$)»" },
  { clave: "cotizacion.es_usd", descripcion: "Verdadero si la cotización es en dólares (para {{#si}})" },
  { clave: "cotizacion.dolar_valor", descripcion: "Dólar del día congelado al emitir (en pesos)" },
  { clave: "cotizacion.dolar_fecha", descripcion: "Fecha del dólar del día" },
  { clave: "cotizacion.dolar_texto", descripcion: "Dólar del día con su fecha: «$ 950 (01-11-2026)»" },
  { clave: "cotizacion.estado", descripcion: "Estado de la cotización" },
  { clave: "cotizacion.ejecutivo", descripcion: "Ejecutivo de ventas que la elabora" },
  { clave: "cotizacion.numero_lineas", descripcion: "Cantidad de líneas del detalle" },
  { clave: "cliente.razon_social", descripcion: "Razón social del cliente («—» si falta)" },
  { clave: "cliente.rut", descripcion: "RUT del cliente («—» si falta)" },
  { clave: "cliente.nombre_fantasia", descripcion: "Nombre de fantasía" },
  { clave: "cliente.giro", descripcion: "Giro" },
  { clave: "cliente.direccion", descripcion: "Dirección" },
  { clave: "cliente.ciudad", descripcion: "Ciudad" },
  { clave: "cliente.region", descripcion: "Región" },
  { clave: "cliente.telefono", descripcion: "Teléfono" },
  { clave: "cliente.email", descripcion: "Correo electrónico" },
  { clave: "cliente.contacto_nombre", descripcion: "Contacto principal" },
  { clave: "cliente.contacto_cargo", descripcion: "Cargo del contacto" },
  { clave: "cliente.contacto_email", descripcion: "Correo del contacto" },
  { clave: "cliente.contacto_telefono", descripcion: "Teléfono del contacto" },
  { clave: "totales.subtotal", descripcion: "Subtotal con su moneda" },
  { clave: "totales.descuento", descripcion: "Descuento con su moneda" },
  { clave: "totales.neto", descripcion: "Neto con su moneda" },
  { clave: "totales.iva_pct", descripcion: "Porcentaje de IVA (19)" },
  { clave: "totales.iva", descripcion: "Monto del IVA con su moneda" },
  { clave: "totales.total", descripcion: "TOTAL con su moneda" },
  { clave: "firmas.elabora_nombre", descripcion: "Quien elabora (Ejecutivo de ventas)" },
  { clave: "firmas.elabora_fecha", descripcion: "Fecha y hora en que se elaboró" },
  { clave: "firmas.firma_nombre", descripcion: "Jefe DCO que firmó (vacío si falta la firma)" },
  { clave: "firmas.firma_fecha", descripcion: "Fecha y hora de la firma" },
  { clave: "firmas.estado", descripcion: "«Firmada» o «En proceso de firma»" },
  { clave: "filas_detalle", descripcion: "Filas de la tabla de detalle: #, ensayo, cantidad, P. unitario, subtotal", bloque: true },
  { clave: "tabla_detalle", descripcion: "Tabla de detalle completa (encabezado y filas)", bloque: true },
  { clave: "descripcion_tecnica_parrafos", descripcion: "Descripción técnica en párrafos", bloque: true },
  { clave: "condiciones_adicionales_parrafos", descripcion: "Condiciones adicionales en párrafos", bloque: true },
];

const DATOS = new Set(VARIABLES_COTIZACION.filter((v) => !v.bloque).map((v) => v.clave));
const BLOQUES = new Set(VARIABLES_COTIZACION.filter((v) => v.bloque).map((v) => v.clave));

/** Texto con saltos de línea → párrafos escapados (igual que el formato fijo). */
function parrafos(t: unknown): string {
  return String(t ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p>${esc(x)}</p>`)
    .join("");
}

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Contexto de la plantilla: datos (texto ya formateado; el motor los escapa) y
 * bloques HTML. Los mismos formatos que el formato fijo (clp/usd, fechas de Chile).
 * Nunca incluye las observaciones internas ni el costeo (SVT3).
 */
export function contextoCotizacion(cot: any, firmas?: FirmasCotizacion | null) {
  const usd = cot.moneda === "USD";
  const monto = (v: unknown) => (usd ? usdFmt(v) : clp(v));
  const lineas: any[] = Array.isArray(cot.lineas) ? cot.lineas : [];
  const filas = lineas
    .map(
      (l, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(l.descripcion ?? l.categoria ?? l.tipo ?? "—")}</td>
        <td class="num">${esc(l.cantidad ?? 1)}</td>
        <td class="num">${monto(l.precioUnitario)}</td>
        <td class="num">${monto(l.subtotal)}</td>
      </tr>`,
    )
    .join("");
  const filasDetalle = filas || '<tr><td class="vacio" colspan="5">Sin líneas de detalle.</td></tr>';
  const cli = cot.cliente ?? {};
  const firmada = firmas?.firma ?? null;
  const datos = {
    cotizacion: {
      codigo: txt(cot.codigo),
      fecha: fechaCorta(cot.fechaEmision ? fechaUtc(cot.fechaEmision) : new Date(cot.createdAt ?? Date.now())),
      validez: cot.validaHasta ? `hasta el ${fechaCorta(fechaUtc(cot.validaHasta))}` : `${cot.validezDias ?? 30} días`,
      valida_hasta: cot.validaHasta ? fechaCorta(fechaUtc(cot.validaHasta)) : "",
      validez_dias: txt(cot.validezDias ?? 30),
      forma_pago: etiquetaFormaPago(cot.formaPago),
      referencia: txt(cot.referencia),
      plazo_entrega_dias: cot.plazoEntregaDias ? txt(cot.plazoEntregaDias) : "",
      descripcion_tecnica: txt(cot.descripcionTecnica),
      condiciones_adicionales: txt(cot.condicionesAdicionales),
      moneda: usd ? "USD" : "CLP",
      moneda_texto: usd ? "dólares estadounidenses (US$)" : "pesos chilenos (CLP)",
      es_usd: usd,
      dolar_valor: cot.dolarValor != null ? clp(cot.dolarValor) : "",
      dolar_fecha: cot.dolarFecha ? fechaCorta(fechaUtc(cot.dolarFecha)) : "",
      dolar_texto: `${clp(cot.dolarValor)}${cot.dolarFecha ? ` (${fechaCorta(fechaUtc(cot.dolarFecha))})` : ""}`,
      estado: txt(cot.estado),
      ejecutivo: txt(firmas?.elabora?.nombre ?? cot.ejecutivo?.nombreCompleto),
      numero_lineas: String(lineas.length),
    },
    cliente: {
      razon_social: txt(cli.razonSocial ?? cli.razon_social ?? "—"),
      rut: txt(cli.rut ?? "—"),
      nombre_fantasia: txt(cli.nombreFantasia),
      giro: txt(cli.giro),
      direccion: txt(cli.direccion),
      ciudad: txt(cli.ciudad),
      region: txt(cli.region),
      telefono: txt(cli.telefono),
      email: txt(cli.email),
      contacto_nombre: txt(cli.contactoNombre),
      contacto_cargo: txt(cli.contactoCargo),
      contacto_email: txt(cli.contactoEmail),
      contacto_telefono: txt(cli.contactoTelefono),
    },
    totales: {
      subtotal: monto(cot.subtotal),
      descuento: monto(cot.descuentoMonto),
      neto: monto(cot.neto),
      iva_pct: txt(cot.ivaPct != null ? Number(cot.ivaPct) : 19),
      iva: monto(cot.ivaMonto),
      total: monto(cot.total),
    },
    firmas: {
      elabora_nombre: txt(firmas?.elabora?.nombre),
      elabora_fecha: firmas?.elabora?.fecha ? fechaHoraCl(firmas.elabora.fecha) : "",
      firma_nombre: txt(firmada?.nombre),
      firma_fecha: firmada?.fecha ? fechaHoraCl(firmada.fecha) : "",
      estado: firmada ? "Firmada" : "En proceso de firma",
    },
  };
  const bloques: Record<string, string> = {
    filas_detalle: filasDetalle,
    tabla_detalle:
      `<table class="rep"><thead><tr><th>#</th><th>Ensayo / descripción</th><th class="num">Cantidad</th>` +
      `<th class="num">P. unitario</th><th class="num">Subtotal</th></tr></thead><tbody>${filasDetalle}</tbody></table>`,
    descripcion_tecnica_parrafos: parrafos(cot.descripcionTecnica),
    condiciones_adicionales_parrafos: parrafos(cot.condicionesAdicionales),
  };
  return { datos, bloques };
}

/* --------------------------------------------------------------- validación --- */

/**
 * Errores de una plantilla de cotización, en frases para la pantalla. Detecta
 * lo que haría salir un documento roto: cuerpo vacío, marcas `{{…}}` mal
 * escritas o sin cerrar, variables que no existen, condicionales sin cerrar o
 * anidados del mismo tipo (el motor no los resuelve) y bloques usados en {{#si}}.
 */
export function validarCuerpoCotizacion(cuerpo: string | null | undefined): string[] {
  const errores: string[] = [];
  const c = cuerpo ?? "";
  if (!c.trim()) return ["El cuerpo de la plantilla está vacío."];
  const marcas = [...c.matchAll(/\{\{([^{}]*)\}\}/g)];
  const abiertas = (c.match(/\{\{/g) ?? []).length;
  if (abiertas !== marcas.length) errores.push("Hay una marca «{{» sin su cierre «}}» (o con llaves de más).");
  const pila: { tipo: string; ruta: string }[] = [];
  for (const m of marcas) {
    const t = m[1].trim();
    let x: RegExpMatchArray | null;
    if ((x = t.match(/^#(si|no)\s+([A-Za-z0-9_.]+)$/))) {
      const [, tipo, ruta] = x;
      if (pila.some((p) => p.tipo === tipo))
        errores.push(`No se puede poner un {{#${tipo}}} dentro de otro {{#${tipo}}} (condición «${ruta}»).`);
      if (BLOQUES.has(ruta)) errores.push(`La condición «${ruta}» es un bloque: use la variable de texto correspondiente.`);
      else if (!DATOS.has(ruta)) errores.push(`La condición usa la variable «${ruta}», que no existe.`);
      pila.push({ tipo, ruta });
    } else if ((x = t.match(/^\/(si|no)$/))) {
      const ultimo = pila.pop();
      if (!ultimo) errores.push(`Hay un {{/${x[1]}}} sin su {{#${x[1]} …}}.`);
      else if (ultimo.tipo !== x[1]) errores.push(`El {{#${ultimo.tipo} ${ultimo.ruta}}} se cierra con {{/${x[1]}}}.`);
    } else if (/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(t)) {
      if (!DATOS.has(t) && !BLOQUES.has(t)) errores.push(`La variable «{{${t}}}» no existe.`);
    } else {
      errores.push(`La marca «{{${m[1]}}}» está mal escrita.`);
    }
  }
  for (const p of pila) errores.push(`Falta cerrar {{#${p.tipo} ${p.ruta}}} con {{/${p.tipo}}}.`);
  return [...new Set(errores)];
}

/** Cuerpo rendido con una plantilla. Lanza si la plantilla tiene errores. */
export function renderCuerpoCotizacion(cuerpo: string, cot: any, firmas?: FirmasCotizacion | null): string {
  const errores = validarCuerpoCotizacion(cuerpo);
  if (errores.length) throw new Error(errores.join(" "));
  const { datos, bloques } = contextoCotizacion(cot, firmas);
  const r = renderizar(cuerpo, datos, bloques);
  if (r.faltantes.length) throw new Error(`Variables sin dato: ${r.faltantes.join(", ")}.`);
  return r.html;
}

/* ---------------------------------------------------------------- versiones --- */

export interface VersionCotizacion {
  id: string;
  numero: number;
  estado: string;
  cuerpoHtml: string | null;
}

export interface CuerpoElegido {
  cuerpo: string;
  /** Versión usada; null = formato fijo del código. */
  version: { id: string; numero: number } | null;
  /** Versiones que fallaron y se saltaron. */
  avisos: string[];
}

/**
 * Cuerpo de la cotización con la primera versión que rinda bien: la VIGENTE y,
 * si falla, las anteriores (RETIRADA, de la más reciente a la más antigua). Sin
 * ninguna utilizable, el formato fijo del código (`cuerpoCotizacionHtml`).
 * Una versión sin cuerpo equivale al formato fijo.
 */
export function elegirCuerpoCotizacion(cot: any, firmas: FirmasCotizacion | null | undefined, versiones: VersionCotizacion[]): CuerpoElegido {
  const avisos: string[] = [];
  for (const v of versiones) {
    if (!v.cuerpoHtml || !v.cuerpoHtml.trim()) return { cuerpo: cuerpoCotizacionHtml(cot), version: { id: v.id, numero: v.numero }, avisos };
    try {
      return { cuerpo: renderCuerpoCotizacion(v.cuerpoHtml, cot, firmas), version: { id: v.id, numero: v.numero }, avisos };
    } catch (e: any) {
      avisos.push(`La versión ${v.numero} de la plantilla de cotización no se pudo usar: ${e?.message ?? e}`);
    }
  }
  return { cuerpo: cuerpoCotizacionHtml(cot), version: null, avisos };
}

/**
 * Versiones utilizables de la plantilla de cotización del tenant, en orden de
 * preferencia (vigente primero, luego las retiradas más recientes). Lista vacía
 * si la BD aún no tiene la plantilla (se usa el formato fijo).
 */
export async function versionesCotizacion(db: any, tenantId: string | null | undefined): Promise<VersionCotizacion[]> {
  if (!tenantId) return [];
  try {
    return await db.$queryRawUnsafe(
      `SELECT v.id, v.numero, v.estado, v.cuerpo_html AS "cuerpoHtml"
         FROM plantilla_informe_version v
        WHERE v.plantilla_id = (
                SELECT p.id FROM plantilla_informe p
                 WHERE p.tenant_id = $1::uuid AND p.tipo = $2 AND p.activo AND p.deleted_at IS NULL
                 ORDER BY (p.repid = $3) DESC, p.created_at, p.id LIMIT 1)
          AND v.estado IN ('VIGENTE', 'RETIRADA')
        ORDER BY (v.estado = 'VIGENTE') DESC, v.aprobado_en DESC NULLS LAST, v.numero DESC
        LIMIT 6`,
      tenantId,
      TIPO_PLANTILLA_COTIZACION,
      REPID_COTIZACION,
    );
  } catch {
    return [];
  }
}

/**
 * Cuerpo de la cotización con la plantilla vigente del tenant (o la anterior
 * si falla; o el formato fijo). Avisa en el registro del servidor cuando salta
 * una versión. Lo usan el circuito (vista previa, PDF, envío) y Mensajería.
 */
export async function cuerpoCotizacionVigente(db: any, tenantId: string | null | undefined, cot: any, firmas: FirmasCotizacion | null | undefined): Promise<string> {
  const r = elegirCuerpoCotizacion(cot, firmas, await versionesCotizacion(db, tenantId));
  for (const a of r.avisos) logger.warn(`Cotización ${cot?.codigo ?? ""}: ${a}`);
  return r.cuerpo;
}

/** Cotización de ejemplo para comprobar una plantilla antes de aprobarla (datos PRUEBA). */
export const COTIZACION_EJEMPLO = {
  codigo: "COT-PRUEBA-0001",
  fechaEmision: "2026-11-03",
  validaHasta: "2026-12-03",
  validezDias: 30,
  formaPago: "contado_30",
  referencia: "Referencia PRUEBA",
  plazoEntregaDias: 15,
  descripcionTecnica: "Descripción técnica PRUEBA.\nSegunda línea.",
  condicionesAdicionales: "Condición PRUEBA.",
  moneda: "USD",
  dolarValor: 950,
  dolarFecha: "2026-11-03",
  estado: "abierta",
  subtotal: 100,
  descuentoMonto: 0,
  neto: 100,
  ivaPct: 19,
  ivaMonto: 19,
  total: 119,
  cliente: { razonSocial: "Cliente PRUEBA", rut: "11.111.111-1" },
  lineas: [{ descripcion: "Ensayo PRUEBA", cantidad: 1, precioUnitario: 100, subtotal: 100 }],
};
