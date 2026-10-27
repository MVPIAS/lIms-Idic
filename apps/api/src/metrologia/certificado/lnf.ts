/**
 * Certificado de Calibración del Laboratorio Nacional de Fuerza (LCPN-F), bilingüe, según
 * el libro real LCPNF-010.26 (hojas «CE DAkks», «CE 2a DAkks» y «ANEXO CE»): 6 hojas más
 * un anexo de transformación de unidades (tonf, factor 9,8067 de la planilla).
 *
 *  1 · portada: número, objeto, fabricante, tipo, serie, cliente, orden, páginas, fecha;
 *      trazabilidad y textos legales; firmas del Jefe del Laboratorio Nacional de Fuerza
 *      y del Encargado de la calibración (Bizagi 4.2.10, JNF L15–L17).
 *  2 · sistema de medición (con amplificador y cable de la recepción), cliente,
 *      condiciones, patrón nacional, síntesis y rango calibrado.
 *  3 · deformaciones X1–X6 y errores relativos (b, b′, fc, v).
 *  4 · ecuación de interpolación S = f(F), tabla de interpolación y ecuación inversa.
 *  5 · clasificación con fluencia (Caso C) e incertidumbre expandida por punto.
 *  6 · incertidumbre con reversibilidad (Caso D), clase por rango y descargo.
 *  Anexo · tabla de interpolación e incertidumbre en tonf.
 *
 * Todo sale del motor ISO 376 validado (483/483 contra la planilla): no hay otro cálculo.
 * La marca DAkkS solo se imprime si el proceso tiene su acreditación cargada en el LIMS
 * (por confirmar con el IDIC: EP-04 §10 P21).
 */
import type { CertificadoArmado, ContextoCertificado, FirmaCert } from "../metrologia.certificado";
import { leerPresentacion, observacionesImpresas } from "./presentacion";
import { ZONA_CHILE, diaChile, diaInstanteChile } from "../../common/fecha-chile";

const NA = "-.-";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const v = (x: unknown) => (x == null || String(x).trim() === "" ? NA : esc(x));
const fx = (x: any, d: number) => (x == null || x === "" || !Number.isFinite(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }));
const fg = (x: any, d = 6) => (x == null || x === "" || !Number.isFinite(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { maximumFractionDigits: d, useGrouping: false }));
const sci = (x: any) => (Number.isFinite(Number(x)) ? Number(x).toExponential(9).replace(".", ",") : NA);
const dia = (x: any) => {
  if (!x) return NA;
  const s = x instanceof Date ? diaChile(x) ?? "" : String(x).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : esc(s);
};
const fechaHora = (x: any) => (x ? new Date(x).toLocaleString("es-CL", { timeZone: ZONA_CHILE, dateStyle: "short", timeStyle: "short" }) : "");
/** Factor kN → tonf de la planilla (ANEXO CE, celda K24). */
export const FACTOR_TONF = 9.8067;

const filas = (pares: [string, string][]) =>
  `<table class="meta compacta"><tbody>${pares.map(([l, x]) => `<tr><th>${l}</th><td>${x}</td></tr>`).join("")}</tbody></table>`;
const tablaRep = (cab: string[], fs: string[][], titulo?: string) =>
  `${titulo ? `<h3>${titulo}</h3>` : ""}<table class="rep"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
    fs.map((f) => `<tr>${f.map((x, i) => `<td${i ? ' class="num"' : ""}>${x}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const bi = (es: string, en: string) => `${esc(es)} <i>(${esc(en)})</i>`;
const parrafo = (es: string, en: string) => `<p class="nota legal">${esc(es)}</p><p class="nota legal"><i>${esc(en)}</i></p>`;

function firma(f: FirmaCert | null | undefined, cargo: string, cargoEn: string): string {
  if (!f) return `<td>${esc(cargo)}<br><i>${esc(cargoEn)}</i><br>Sin firmante en la matriz de firmas</td>`;
  const estado = f.pendiente ? "Pendiente de firma" : `Firmado electrónicamente el ${esc(fechaHora(f.fecha))}`;
  return `<td><b>${esc(f.nombre ?? "")}</b><br>${f.grado ? `${esc(f.grado)}<br>` : ""}${esc(cargo)}<br><i>${esc(cargoEn)}</i><br>${estado}</td>`;
}

/** Arma el certificado bilingüe del LNF (6 hojas + anexo). */
export function armarCertificadoLnf(cal: any, ctx: ContextoCertificado): CertificadoArmado {
  const ins = cal.instrumento ?? {};
  const R = cal.resultado ?? {};
  const D = cal.datos ?? {};
  const rows: any[] = R.rows ?? [];
  const numero = cal.numero_certificado ?? `BORRADOR ${cal.codigo}`;
  const acred = String(cal.acreditacion ?? "").trim() || null;
  const marca = acred && /^D-K-/i.test(acred) ? acred : null;
  const k = R.k ?? 2;
  const Fs = rows.map((x) => Number(x.F));
  const Fmin = Math.min(...Fs), Fmax = Math.max(...Fs);
  const sentido = String(D.sentido ?? ins.sentido ?? "").trim() || NA;
  const acc: any[] = Array.isArray(cal.instrumento_accesorios) ? cal.instrumento_accesorios : [];
  const amp = acc.find((a) => /amplif/i.test(a?.tipo ?? "")) ?? {};
  const cable = acc.find((a) => /cable/i.test(a?.tipo ?? "")) ?? {};
  const otros = acc.filter((a) => a !== amp && a !== cable);
  const pat = (Array.isArray(cal.patrones) ? cal.patrones : [])[0] ?? {};
  const emision = cal.emitido_at ? dia(diaInstanteChile(cal.emitido_at)) : "Pendiente (se fija al firmar)";
  const p = leerPresentacion(cal.presentacion);
  const N = 6;

  const cabecera = (pag: string) => `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>LABORATORIO CUSTODIO DE PATRONES NACIONALES · MAGNITUD FUERZA</b><span>Instituto de Investigaciones y Control · Ejército de Chile</span></div>
  <div class="doc"><b>${esc(numero)}</b><span>${marca ? esc(marca) : "Laboratorio Nacional de Fuerza (LCPN-F)"}</span></div>
</div>
<p class="linea-acred"><b>${pag}</b></p>`;
  const pagina = (n: number) => `Página ${n} de ${N} <i>(Page ${n} of ${N})</i>`;

  // El certificado numera sus hojas (el anexo aparte): el pie del PDF no añade otra cuenta (B-074).
  const hoja1 = `<!-- paginacion-propia -->
${cabecera(pagina(1))}
<h1 class="compacta">CERTIFICADO DE CALIBRACIÓN N° ${esc(numero)} <i>(CALIBRATION CERTIFICATE)</i></h1>
${acred ? `<p class="linea-acred">${bi(`Acreditado como laboratorio de calibración: ${acred}`, `Accredited calibration laboratory: ${acred}`)}</p>` : ""}
${filas([
    [bi("Marca de calibración", "Calibration mark"), marca ? esc(marca) : NA],
    [bi("Objeto", "Object"), v(ins.item)],
    [bi("Fabricante", "Manufacturer"), v(ins.marca)],
    [bi("Tipo", "Type"), v(ins.modelo)],
    [bi("Número de serie", "Serial number"), v(ins.serie)],
    [bi("Cliente", "Customer"), v(ins.cliente)],
    [bi("Número de orden", "Order No."), v(ins.ot)],
    [bi("Número de páginas del certificado", "Number of pages of the certificate"), `${N} páginas <i>(${N} pages)</i>`],
    [bi("Fecha de calibración", "Date of calibration"), dia(cal.fecha_calibracion)],
  ])}
${parrafo("Este certificado de calibración documenta la trazabilidad a los patrones nacionales, que realizan las unidades de medida de acuerdo con el Sistema Internacional de Unidades (SI).",
    "This calibration certificate documents the traceability to national standards, which realize the units of measurement according to the International System of Units (SI).")}
${acred ? parrafo("La entidad de acreditación es firmante de los acuerdos multilaterales de la European co-operation for Accreditation (EA) y de la International Laboratory Accreditation Cooperation (ILAC) para el reconocimiento mutuo de los certificados de calibración.",
    "The accreditation body is signatory to the multilateral agreements of the European co-operation for Accreditation (EA) and of the International Laboratory Accreditation Cooperation (ILAC) for the mutual recognition of calibration certificates.") : ""}
${parrafo("El usuario está obligado a recalibrar el instrumento a intervalos apropiados.", "The user is obliged to recalibrate the object at appropriate intervals.")}
<div class="pie-hoja">
${parrafo(`Este certificado de calibración sólo puede ser difundido completamente y sin modificaciones. Los extractos o modificaciones requieren la autorización ${acred ? "de la entidad de acreditación y " : ""}del laboratorio de calibración. Los certificados de calibración sin firma no son válidos.`,
    `This calibration certificate may not be reproduced other than in full except with the permission of ${acred ? "both the accreditation body and " : ""}the issuing laboratory. Calibration certificates without signature are not valid.`)}
${filas([[bi("Fecha de emisión", "Date"), emision]])}
<table class="firmas-cert compacta"><tbody><tr>${firma(ctx.jefeLab, "Jefe del Laboratorio Nacional de Fuerza", "Head of the National Laboratory")}${firma(ctx.metrologo, "Encargado de la calibración", "Person in charge")}</tr></tbody></table>
<p class="nota legal">Av. Pedro Montt N° 2136, Santiago, Región Metropolitana · Chile.</p>
</div>`;

  const hoja2 = `
<div class="salto-pagina"></div>
${cabecera(pagina(2))}
<h2 class="compacta">${bi("Identificación del sistema de medición calibrado", "Measurement system identification")}</h2>
${filas([
    [bi("Instrumento", "Object"), v(ins.item)], [bi("Marca", "Brand"), v(ins.marca)], [bi("Modelo", "Model"), v(ins.modelo)],
    [bi("Número de serie", "Serial number"), v(ins.serie)], [bi("Identificación especial", "Special Id."), v(ins.idEspecial)],
    [bi("Capacidad nominal", "Capacity"), v(ins.cap)],
    [bi("Marca amplificador", "Amplifier"), v(amp.marca)], [bi("Modelo amplificador", "Model"), v(amp.modelo)], [bi("Número de serie", "Serial number"), v(amp.serie)],
    [bi("Resolución", "Resolution"), D.resInd != null ? `${fg(D.resInd, 8)} mV/V (${fg(R.r, 4)} kN)` : NA],
    [bi("Señal de cero", "Zero signal"), Array.isArray(D.pre) && D.pre[0]?.[0] != null ? `${fg(D.pre[0][0], 6)} mV/V` : NA],
    [bi("Marca cable", "Cable brand"), v(cable.marca)], [bi("Modelo", "Model"), v(cable.modelo)], [bi("Largo", "Length"), v(cable.detalle)],
  ])}
<h2 class="compacta">${bi("Identificación del cliente", "Customer identification")}</h2>
${filas([[bi("Nombre", "Name"), v(ins.cliente)], [bi("Solicitante", "Applicant"), v(ins.solicitante)], [bi("Dirección", "Address"), v(ins.direccion)]])}
<h2 class="compacta">${bi("Condiciones de calibración", "Calibration environment")}</h2>
${filas([
    [bi("Fecha de calibración", "Date"), dia(cal.fecha_calibracion)],
    [bi("Tª media de calibración", "Mean T"), R.tMed != null ? `(${fx(R.tMed, 1)} ± ${fx(R.tRan, 1)}) °C` : NA],
    [bi("HRA media de calibración", "Mean RAH"), D.hr != null ? `(${fg(D.hr, 1)} ± ${fg(D.hrU, 1)}) %` : NA],
    [bi("Método de calibración", "Procedure"), v(cal.metodo)],
    [bi("Documento o norma", "Standard"), cal.norma ? `Basado en <i>(Based in)</i> ${esc(cal.norma)}` : NA],
  ])}
<h2 class="compacta">${bi("Patrón nacional", "National standard")}</h2>
${filas([
    [bi("Patrón", "Standard"), v(pat.nombre)], [bi("Marca", "Brand"), v(pat.marca)], [bi("Modelo", "Model"), v(pat.modelo)],
    [bi("Número de serie", "Serial number"), v(pat.serie)], [bi("Certificado", "Certificate number"), v(pat.n_certificado)],
    [bi("Fecha de recalibración", "Date"), dia(pat.vence)], [bi("Trazabilidad", "Traceability"), v(pat.trazabilidad)],
  ])}
<h2 class="compacta">${bi("Resultados de la calibración", "Calibration results")}</h2>
${filas([
    [bi("Síntesis de la calibración", "Summary"), `Calibración efectuada en ${esc(sentido)}. Los resultados se presentan en las tablas adjuntas. La incertidumbre declarada es la incertidumbre expandida y se obtiene multiplicando la incertidumbre estándar por el factor de cobertura k = ${fg(k, 2)}, de acuerdo con la guía EURAMET cg-4 «Uncertainty of Force Measurements». El valor del mensurando queda dentro del rango asignado de valores con una probabilidad del 95 %.`],
    [bi("Rango calibrado", "Calibrated range"), `(${fg(Fmin, 3)} a ${fg(Fmax, 3)}) kN`],
    [bi("Accesorios usados en la calibración", "Calibration accessories"), otros.length ? otros.map((a) => esc([a.tipo, a.marca, a.modelo, a.detalle].filter(Boolean).join(" "))).join("<br>") : NA],
  ])}`;

  const X = (x: any, j: number) => (x?.X?.[j] == null ? NA : fx(x.X[j], 5));
  const hoja3 = `
<div class="salto-pagina"></div>
${cabecera(pagina(3))}
<h2 class="compacta">${bi("Tablas de resultados de calibración", "Calibration results")} · ${esc(sentido)}</h2>
${tablaRep(["Valor nominal / kN", "X1 asc. 0° / mV/V", "X2 asc. 0° / mV/V", "X3 asc. 120° / mV/V", "X4 desc. 120° / mV/V", "X5 asc. 240° / mV/V", "X6 desc. 240° / mV/V"],
    [["0", "0", "0", "0", NA, "0", NA], ...rows.map((x) => [fg(x.F, 3), X(x, 0), X(x, 1), X(x, 2), X(x, 3), X(x, 4), X(x, 5)])],
    bi("Deformación del sistema de medición durante la calibración", "Deflection during calibration"))}
<p class="nota legal">${bi(`Error de cero por serie f₀: ${(R.f0 ?? []).map((x: number) => `${fx(x, 4)} %`).join(" · ") || NA}`, "zero error per series")}</p>
${tablaRep(["Valor nominal / kN", "Promedio X1, X3, X5 / mV/V", "E. reproducibilidad b / %", "Promedio X1, X2 / mV/V", "E. repetibilidad b′ / %", "Deformación ajustada Xa / mV/V", "E. interpolación fc / %", "E. reversibilidad v / %"],
    rows.map((x) => [fg(x.F, 3), fx(x.Xr, 6), fx(x.b, 3), fx(x.Xwr, 6), fx(x.bp, 3), fx(x.Xa, 6), fx(x.fc, 3), x.v == null ? NA : fx(x.v, 3)]),
    bi("Promedio de las deformaciones con y sin rotación, deformación ajustada y errores relativos", "Mean deflection with and without rotation, adjusted deflection, relative errors"))}`;

  const c = R.coef ?? {};
  const pasos = [0, 1, 2, 3, 4].map((j) => fg((Fmin / 10) * j, 3));
  const hoja4 = `
<div class="salto-pagina"></div>
${cabecera(pagina(4))}
<h2 class="compacta">${esc(sentido)}</h2>
${filas([
    [bi("Ecuación de interpolación S = a·F + b·F² + c·F³ (F en kN, S en mV/V)", "Interpolation equation"),
      `a = ${sci(c.S3?.[0])} · b = ${sci(c.S3?.[1])} · c = ${sci(c.S3?.[2])}`],
  ])}
${tablaRep(["F / kN", ...pasos.map((x) => `+${x}`)], (R.tabla ?? []).map((t: any) => [fg(t.F, 3), ...t.S.map((s: number) => fx(s, 5))]),
    bi("Tabla de interpolación para S = a·F + b·F² + c·F³ (S en mV/V)", "Interpolation table"))}
${filas([
    [bi("Ecuación inversa de interpolación F = t·S + u·S² + v·S³ (F en kN)", "Inverse interpolation equation"),
      `t = ${sci(c.F3?.[0])} · u = ${sci(c.F3?.[1])} · v = ${sci(c.F3?.[2])}`],
  ])}
${parrafo("Nota: la menor incertidumbre relativa del valor de la media aritmética y del valor interpolado se calculó de acuerdo con la norma ISO 376, Anexo C, vigente. Las incertidumbres son válidas solamente para los valores de fuerza y valores de fuerza ascendentes.",
    "The smallest relative uncertainty of the arithmetic mean value and the interpolated value was calculated according to ISO 376 Annex C. The uncertainties are valid at the force values and increasing forces only.")}`;

  // U del certificado (planilla TR!J57: k·uc, Caso C); la «U mínima por clase» (Umin) es interna de la clasificación.
  const umin = (x: any) => fx(x.U, 3);
  const rangos: any[] = Array.isArray(R.rangos) ? R.rangos : [];
  const tablaRangos = tablaRep([bi("Rango de medición", "Measuring range"), bi("Clase", "Class")],
    rangos.map((r) => [`Desde <i>(from)</i> ${fg(r.desde, 3)} kN hasta <i>(to)</i> ${fg(r.hasta, 3)} kN`, esc(r.clase)]));
  const hoja5 = `
<div class="salto-pagina"></div>
${cabecera(pagina(5))}
<h2 class="compacta">${esc(sentido)} · ${bi("Clasificación con test de fluencia y sin reversibilidad (Caso C)", "Classification with creep test without reversibility (Case C)")}</h2>
<p class="nota legal">N/C: no clasificable, fuera de tabla <i>(out of class)</i>.</p>
${tablaRep(["F / kN", `U (k = ${fg(k, 2)}) / %`], rows.map((x) => [fg(x.F, 3), umin(x)]),
    bi(`Incertidumbre expandida para k = ${fg(k, 2)}: menor incertidumbre relativa para fuerzas ascendentes`, "Smallest relative measurement uncertainty for increasing forces"))}
${tablaRangos}
${parrafo("Análisis de fluencia: se estima dividiendo el valor de histéresis por un factor 3.", "Creep test: estimated dividing the hysteresis value by a factor of 3.")}`;

  const obs = observacionesImpresas(p, []);
  const hoja6 = `
<div class="salto-pagina"></div>
${cabecera(pagina(6))}
<h2 class="compacta">${esc(sentido)} · ${bi("Clasificación con reversibilidad (Caso D)", "Classification with reversibility (Case D)")}</h2>
${tablaRep(["F / kN", "U fuerzas ascendentes / %", "U fuerzas ascendentes y descendentes / %"],
    rows.map((x) => [fg(x.F, 3), umin(x), x.UD == null ? NA : fx(x.UD, 3)]),
    bi("Menor incertidumbre relativa (%)", "Smallest relative measurement uncertainty (%)"))}
${tablaRangos}
${obs.length ? `<h3>Observaciones <i>(Remarks)</i></h3>${obs.map((o) => `<p>${esc(o)}</p>`).join("")}` : ""}
${parrafo("El Laboratorio Nacional declara que no se hace responsable del uso de este certificado para la obtención o mantenimiento de una acreditación. En caso de que el cliente decida utilizarlo con dicho fin, lo hará bajo su exclusiva responsabilidad.",
    "The National Laboratory states that it is not responsible for the use of this certificate for obtaining or maintaining accreditation. Should the client decide to use it for this purpose, they do so under their sole responsibility.")}
<p class="fin"><b>Fin del certificado de calibración</b> <i>(End of calibration certificate)</i></p>`;

  const t = (x: number) => x / FACTOR_TONF;
  const anexo = `
<div class="salto-pagina"></div>
${cabecera(`Anexo · Página 1 de 1 <i>(Annex · Page 1 of 1)</i>`)}
<h2 class="compacta">${bi("Anexo · Transformación de unidades", "Annex · Unit conversion")} · ${esc(sentido)}</h2>
<p class="nota legal">1 tonf = ${fg(FACTOR_TONF, 4)} kN (factor de la planilla del laboratorio).</p>
${tablaRep(["F / tonf", ...[0, 1, 2, 3, 4].map((j) => `+${fx(t((Fmin / 10) * j), 2)}`)], (R.tabla ?? []).map((x: any) => [fx(t(x.F), 2), ...x.S.map((s: number) => fx(s, 5))]),
    bi("Tabla de interpolación (S en mV/V)", "Interpolation table"))}
${tablaRep(["F / tonf", `U (k = ${fg(k, 2)}) / %`], rows.map((x) => [fx(t(x.F), 2), umin(x)]), bi("Incertidumbre expandida", "Expanded uncertainty"))}`;

  return { html: hoja1 + hoja2 + hoja3 + hoja4 + hoja5 + hoja6 + anexo, hojas: N + 1 };
}
