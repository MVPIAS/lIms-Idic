/**
 * Certificado de Calibración del LMT · plantilla oficial de 2 páginas, según las
 * hojas «Certificado» de las planillas del laboratorio (M-3947-ITM03, V-5920-ITV05):
 *
 *  Página 1 · membrete, número, acreditación del PROCESO, OT y fechas, instrumento,
 *             cliente, condiciones (lugar, recepción, calibración, T, HR, P), método
 *             con revisión y desviación, hasta 3 patrones, síntesis, firmas del jefe de
 *             departamento y del jefe del laboratorio, y los 5 textos legales.
 *  Página 2 · membrete, número, ítem, tabla de resultados propia de la instrucción,
 *             observaciones (intervalo, k = 2, 95 %, «"--" = No aplica», «*» fuera del
 *             alcance), firmas del jefe del laboratorio y del metrólogo, «Fin del certificado».
 *
 * Sin «cumple / no cumple» (C1: el LMT no evalúa conformidad); en fuerza, la clase.
 * Un solo identificador: el número del certificado (M-3948…); el código interno
 * CAL-AAAA-NNNN solo aparece en el borrador. El PDF lo arma plantilla-render.
 */
import { REGISTRO_MOTORES, type ResumenMotor } from "./motores";
import { decimales2cs, u2cs } from "./metrologia.reglas";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const NA = "--";
const v = (x: unknown) => (x == null || String(x).trim() === "" ? NA : esc(x));
const fx = (x: any, d: number) => (x == null || isNaN(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fg = (x: any, d = 6) => (x == null || isNaN(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { maximumFractionDigits: d }));
/** Fecha DATE (sin hora) o AAAA-MM-DD → dd-mm-aaaa. */
const dia = (x: any) => {
  if (!x) return NA;
  const s = x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : esc(s);
};
const fechaHora = (x: any) => (x ? new Date(x).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }) : "");
/** U con dos cifras significativas (C12), escrita con sus decimales. */
const u2 = (U: number | null | undefined) => {
  const r = u2cs(U ?? null);
  return r == null ? NA : fx(r, decimales2cs(r));
};

const TEXTOS_LEGALES = [
  "Los patrones utilizados en la calibración cuentan con trazabilidad a patrones nacionales y/o internacionales, los que a su vez están referidos a patrones primarios de acuerdo al Sistema Internacional de Unidades (SI).",
  "El laboratorio de Calibración posee la competencia técnica y cumple con las exigencias de la norma NCh-ISO 17025 «Requisitos generales para la competencia de los Laboratorios de Ensayos y Calibración».",
  "Los resultados de la calibración están referidos solo al ítem calibrado, al momento y condiciones en las cuales fueron efectuadas las mediciones.",
  "Este Certificado de Calibración no puede ser reproducido total o parcialmente, excepto con el permiso del laboratorio emisor.",
  "El laboratorio no asume responsabilidades por los daños posteriores a la calibración, ocasionados por el mal empleo del instrumento.",
];
const LUGAR: Record<string, string> = {
  instalaciones: "La calibración se efectuó en nuestras instalaciones ubicadas en Av. Pedro Montt N° 2136, Santiago, Santiago.",
  cliente: "La calibración se llevó a cabo en las instalaciones del cliente.",
};

/** Firma de un paso del circuito, tal como se imprime (nombre, grado y cargo). */
export interface FirmaCert {
  accion: string; rol: string; nombre: string | null; grado?: string | null; cargo?: string | null;
  fecha?: string | Date | null; pendiente: boolean; via?: string | null;
}
export interface ContextoCertificado {
  /** Nombre del departamento (parámetro `certificado_calibracion.nombre_departamento`). */
  departamento: string;
  /** Firmas por papel: metrólogo (ELABORA), jefe del laboratorio y jefe del departamento. */
  metrologo: FirmaCert | null;
  jefeLab: FirmaCert | null;
  jefeDepto: FirmaCert | null;
  /** Número del certificado que este reemplaza (reemisión). */
  reemplazaNumero?: string | null;
}

/** Cargo impreso: el del papel en el certificado (el del departamento sale del parámetro), con (S) si firma el subrogante. */
function firmaCelda(f: FirmaCert | null, cargoDefecto: string): string {
  if (!f) return `<td>${esc(cargoDefecto)}<br>Sin firmante en la matriz de firmas</td>`;
  const sub = f.via === "subrogante" ? " (S)" : "";
  const estado = f.pendiente ? "Pendiente de firma" : `Firmado electrónicamente el ${esc(fechaHora(f.fecha))}`;
  return `<td><b>${esc(f.nombre ?? "")}</b><br>${f.grado ? ` · ${esc(f.grado)}<br>` : ""} · ${esc(cargoDefecto + sub)}<br> · ${estado}</td>`;
}
const tablaFirmas = (izq: string, der: string) => `<table class="firmas-cert"><tbody><tr>${izq}${der}</tr></tbody></table>`;

function membrete(numero: string, acreditacion: string | null): string {
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL, IDIC</b><span>Ejército de Chile · Laboratorio de Metrología</span></div>
  <div class="doc"><b>${esc(numero)}</b><span>${acreditacion ? `Acreditación ${esc(acreditacion)}` : ""}</span></div>
</div>`;
}

/** Tabla de resultados propia de cada instrucción de trabajo (página 2). */
function tablaResultados(cal: any): { html: string; fueraAlcance: boolean; sintesis: string } {
  const r: ResumenMotor | null = cal.resumen ?? null;
  const R = cal.resultado ?? {};
  const pr = r?.puntos ?? [];
  const marca = (i: number) => ((pr[i] as any)?.fueraAlcance ? " *" : "");
  const fuera = pr.some((p: any) => p.fueraAlcance);
  const uc = (i: number, U: number | null | undefined) => `${u2((pr[i] as any)?.uCertificado ?? U)}${marca(i)}`;
  const m = cal.motor ? REGISTRO_MOTORES[cal.motor] : null;
  const fila = (celdas: string[]) => `<tr>${celdas.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`;
  const tabla = (cab: string[], filas: string[]) => `<table class="rep"><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${filas.join("")}</tbody></table>`;
  const unidad = cal.unidad ?? "";
  const mayor = (us: (number | null)[]) => u2(Math.max(...us.filter((x): x is number => x != null && Number.isFinite(x))));

  switch (cal.motor) {
    case "ITM03": {
      const rows: any[] = R.rows ?? [];
      return {
        html: tabla(["Ítem número", "Valor de masa convencional / g", "Incertidumbre expandida / mg", "Identificación del ítem"],
          rows.map((x, i) => fila([String(i + 1), fx(x.L77, 3), `${esc(String(x.certU).replace(/\s*mg$/, ""))}${marca(i)}`, v(x.id)]))),
        fueraAlcance: fuera,
        sintesis: "La incertidumbre asignada para cada masa del sistema de medición calibrado se presenta en la tabla de resultados.",
      };
    }
    case "ITV05": {
      const rows: any[] = R.rows ?? [];
      const U = rows.map((x, i) => u2cs(((pr[i] as any)?.uCertificado ?? x.M) * 1000));
      return {
        html: tabla(["Volumen entregado / µL", "Volumen nominal / µL", "Error / µL", "Incertidumbre expandida / µL", "Inexactitud Et %", "Imprecisión CVt %"],
          rows.map((x, i) => fila([fx(x.cC, 2), fx(x.cD, 2), fx(x.cE, 2), `${fx(U[i], 2)}${marca(i)}`, fx(x.cG, 2), fx(x.cH, 2)]))),
        fueraAlcance: fuera,
        sintesis: `La mayor incertidumbre encontrada para el instrumento, considerando que se efectúe la corrección respectiva, es de ± ${fx(Math.max(...U.map((x) => x ?? 0)), 2)} µL, para un nivel de confianza del 95 %.`,
      };
    }
    case "ITM01": {
      const nom = pr[0]?.nominal;
      return {
        html: tabla(["Valor nominal / mg", "Valor de masa convencional / mg", "Desviación del nominal / mg", "Incertidumbre expandida / mg"],
          [fila([fg(nom, 3), fg(R.mc, 3), fg(R.dev, 3), `${fg(R.asig, 3)}${marca(0)}`])]),
        fueraAlcance: fuera,
        sintesis: "La incertidumbre asignada a la masa calibrada se presenta en la tabla de resultados.",
      };
    }
    case "ITM02": {
      const rows: any[] = R.rows ?? [];
      return {
        html: tabla(["Valor nominal / g", "Indicación patrón / g", "Indicación instrumento / g", "Error / g", "Incertidumbre expandida / g", "Repetibilidad / g"],
          rows.map((x, i) => fila([fg(x.nom, 4), fg(x.C, 5), fg(x.B, 5), fg(x.E, 5), uc(i, x.Uc), fg(x.sd, 5)]))),
        fueraAlcance: fuera,
        sintesis: `La mayor incertidumbre encontrada es de ± ${mayor(pr.map((p: any) => p.uCertificado ?? p.Ucert ?? p.U))} g, para un nivel de confianza del 95 %.`,
      };
    }
    case "LCPNF-IT01":
    case "PUNTOS":
      return { html: "", fueraAlcance: fuera, sintesis: "" };
  }
  if (r && m) {
    const conClase = pr.some((p) => p.clase);
    const uu = m.unidadU, un = m.unidad;
    return {
      html: tabla(
        [`Valor nominal / ${un}`, `Error / ${uu === "%" ? "%" : un}`, `Incertidumbre expandida / ${uu}`, ...(conClase ? ["Clase"] : [])],
        pr.map((p, i) => fila([fg(p.nominal, 4), fg(p.error, 6), uc(i, p.Ucert ?? p.U), ...(conClase ? [v(p.clase)] : [])]))),
      fueraAlcance: fuera,
      sintesis: `La mayor incertidumbre encontrada es de ± ${mayor(pr.map((p: any) => p.uCertificado ?? p.Ucert ?? p.U))} ${esc(uu)}, para un nivel de confianza del 95 %.`,
    };
  }
  // Motor GUM parametrizado (calibraciones antiguas, sin motor)
  const ptos: any[] = cal.puntos ?? [];
  return {
    html: tabla([`Valor nominal / ${unidad}`, "Indicación patrón", "Indicación instrumento", "Error", `Incertidumbre expandida / ${unidad}`],
      ptos.map((p) => fila([fg(p.nominal, 4), fg(p.referencia, 6), fg(p.media, 6), fg(p.error, 6), u2(p.u_exp ?? p.uExp)]))),
    fueraAlcance: false,
    sintesis: `La mayor incertidumbre encontrada es de ± ${u2(cal.u_max)} ${esc(unidad)}, para un nivel de confianza del 95 %.`,
  };
}

/** Resultados del LNF (ISO 376) y del formulario por puntos: tabla resumida sin veredicto. */
function tablaEspecial(cal: any): string {
  const R = cal.resultado ?? {};
  if (cal.motor === "LCPNF-IT01") {
    const rows: any[] = R.rows ?? [];
    return `<table class="rep"><thead><tr><th>F kN</th><th>Xr</th><th>b %</th><th>b' %</th><th>fc %</th><th>v %</th><th>U caso C %</th><th>U caso D %</th><th>Clase</th></tr></thead><tbody>${rows
      .map((x) => `<tr><td class="num">${fg(x.F, 3)}</td><td class="num">${fx(x.Xr, 6)}</td><td class="num">${fx(x.b, 3)}</td><td class="num">${fx(x.bp, 3)}</td><td class="num">${fx(x.fc, 3)}</td><td class="num">${x.v == null ? NA : fx(x.v, 3)}</td><td class="num">${fx(x.U, 3)}</td><td class="num">${fx(x.UD, 3)}</td><td>${esc(x.etiqueta)}</td></tr>`)
      .join("")}</tbody></table>`;
  }
  if (cal.motor === "PUNTOS") {
    const rows: any[] = R.rows ?? [];
    const pr: any[] = cal.resumen?.puntos ?? [];
    return `<table class="rep"><thead><tr><th>Función / rango</th><th>Valor nominal</th><th>Indicación patrón</th><th>Indicación instrumento</th><th>Error</th><th>Incertidumbre expandida</th></tr></thead><tbody>${rows
      .map((x, i) => `<tr><td>${v(x.funcion)}</td><td class="num">${fg(x.nom, 6)} ${esc(x.unidad)}</td><td class="num">${fg(x.mPat, 8)}</td><td class="num">${fg(x.mInst, 8)}</td><td class="num">${fg(x.err, 8)}</td><td class="num">${u2(pr[i]?.uCertificado ?? x.U)}${pr[i]?.fueraAlcance ? " *" : ""}</td></tr>`)
      .join("")}</tbody></table>`;
  }
  return "";
}

/** Condiciones ambientales: las corregidas del motor (ITM03, ITV05) o las declaradas en el formulario. */
function condiciones(cal: any): { t: string; h: string; p: string } {
  const R = cal.resultado ?? {}, a = cal.ambiente ?? {};
  const par = (x: any, u: any, unidad: string) => (x == null || x === "" ? NA : `(${fg(x, 1)} ± ${u == null || u === "" ? NA : fg(u, 2)}) ${unidad}`);
  if (cal.motor === "ITM03" && R.Y5 != null) return { t: par(Math.round(R.Y5 * 10) / 10, R.tU, "°C"), h: par(Math.round(R.Y6 * 10) / 10, R.hU, "%"), p: par(R.Y7, R.pU, "hPa") };
  if (cal.motor === "ITV05" && R.amb) return { t: par(R.amb.t, R.amb.tU, "°C"), h: par(R.amb.h, R.amb.hU, "%"), p: par(R.amb.p, R.amb.pU, "hPa") };
  const num = (s: any) => (s == null || s === "" ? null : Number(String(s).replace(",", ".")));
  return { t: par(num(a.temp), num(a.tempU), "°C"), h: par(num(a.hum), num(a.humU), "%"), p: par(num(a.pres), num(a.presU), "hPa") };
}

/** Hasta 3 patrones (snapshot guardado en la calibración; las antiguas, el patrón único). */
function patronesHtml(cal: any): string {
  const ps: any[] = (Array.isArray(cal.patrones) && cal.patrones.length ? cal.patrones : cal.patron_snap?.nombre ? [{
    nombre: cal.patron_snap.nombre, clase: cal.patron_snap.clase, n_certificado: cal.patron_snap.cert, trazabilidad: cal.patron_snap.trazab,
  }] : []).slice(0, 3);
  if (!ps.length) return `<p>${NA}</p>`;
  const filas: [string, (p: any) => string][] = [
    ["Patrón utilizado", (p) => v(p.nombre)], ["Marca · modelo", (p) => `${v(p.marca)} · ${v(p.modelo)}`], ["Número de serie · clase", (p) => `${v(p.serie)} · ${v(p.clase)}`],
    ["Certificado · próxima calibración", (p) => `${v(p.n_certificado)} · ${dia(p.vence)}`], ["Emitido por · trazabilidad inmediata", (p) => `${v(p.emisor)} · ${v(p.trazabilidad)}`],
  ];
  return `<table class="meta"><tbody>${filas.map(([l, f]) => `<tr><th>${esc(l)}</th>${ps.map((p) => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function certificadoHtml(cal: any, ctx: ContextoCertificado): string {
  const ins = cal.instrumento ?? {};
  const numero = cal.numero_certificado ?? `BORRADOR ${cal.codigo}`;
  const acreditado = !!cal.acreditacion;
  const mag = cal.magnitud_nombre ?? cal.magnitud ?? "";
  const titulo = `CERTIFICADO DE CALIBRACIÓN N° ${numero}`;
  const linea = `Laboratorio de Calibración${acreditado ? " Acreditado" : ""} en la magnitud ${esc(mag)}`;
  const c = condiciones(cal);
  const res = tablaResultados(cal);
  const cuerpoRes = res.html || tablaEspecial(cal);
  const cargoDepto = `Jefe ${ctx.departamento}`;
  const cargoLab = "Jefe Laboratorio de Metrología";
  const metodo = [cal.metodo, cal.revision].filter(Boolean).join(" · ");
  const k = cal.motor === "LCPNF-IT01" && cal.resultado?.k ? fg(cal.resultado.k, 2) : "2";

  const pagina1 = `
${membrete(numero, cal.acreditacion)}
<h1>${esc(titulo)}</h1>
<p><b>${linea}</b>${ctx.reemplazaNumero ? `<br>Este certificado reemplaza al certificado N° ${esc(ctx.reemplazaNumero)}.` : ""}</p>
<table class="meta"><tbody>
  <tr><th>Orden de trabajo número</th><td>${v(ins.ot)}</td><th>Fecha OT</th><td>${dia(ins.fechaOt)}</td><th>Fecha de emisión del certificado</th><td>${cal.emitido_at ? dia(new Date(cal.emitido_at).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" })) : "Pendiente"}</td></tr>
</tbody></table>
<h2>Identificación del instrumento calibrado</h2>
<table class="meta"><tbody>
  <tr><th>Descripción del ítem</th><td>${v(ins.item)}</td><th>Marca</th><td>${v(ins.marca)}</td><th>Modelo</th><td>${v(ins.modelo)}</td></tr>
  <tr><th>Número de serie</th><td>${v(ins.serie)}</td><th>Identificación especial</th><td>${v(ins.idEspecial)}</td><th>Clase</th><td>${v(ins.clase)}</td></tr>
  <tr><th>Capacidad / valor nominal</th><td>${v(ins.cap)}</td><th>Resolución</th><td>${v(ins.res)}</td><th>Rango calibrado</th><td>${v(ins.rango)}</td></tr>
</tbody></table>
<h2>Identificación del cliente</h2>
<table class="meta"><tbody>
  <tr><th>Cliente</th><td>${v(ins.cliente)}</td><th>Solicitante</th><td>${v(ins.solicitante)}</td><th>Contacto</th><td>${v(ins.contacto)}</td></tr>
  <tr><th>Dirección</th><td>${v(ins.direccion)}</td><th>Fecha de recepción</th><td>${dia(ins.fechaRecepcion)}</td><th>Fecha de calibración</th><td>${dia(cal.fecha_calibracion)}</td></tr>
</tbody></table>
<h2>Condiciones de calibración</h2>
<table class="meta"><tbody>
  <tr><th>Lugar de la calibración</th><td>${esc(LUGAR[ins.lugar] ?? LUGAR.instalaciones)}</td><th>Intervalo de calibración</th><td>${cal.intervalo_meses ? `${esc(cal.intervalo_meses)} meses` : "Según el cliente"}</td></tr>
</tbody></table>
<table class="meta"><tbody>
  <tr><th>Temperatura promedio</th><td>${c.t}</td><th>Humedad relativa promedio</th><td>${c.h}</td><th>Presión atmosférica promedio</th><td>${c.p}</td></tr>
  <tr><th>Método de calibración</th><td>${v(metodo)}</td><th>Desviaciones del método</th><td>${v(ins.desviacion || "No")}</td><th>Documento o norma base</th><td>${v(cal.norma)}</td></tr>
</tbody></table>
<p class="nota">Los valores indicados corresponden a la temperatura y humedad relativa durante la calibración; se indica la incertidumbre del instrumento con que se midieron.</p>
<h2>Identificación del patrón</h2>
${patronesHtml(cal)}
<h2>Resultados de la calibración</h2>
<p><b>Síntesis de la calibración:</b> ${res.sintesis ? esc(res.sintesis) : "los resultados se presentan en la tabla de resultados."}</p>
${tablaFirmas(firmaCelda(ctx.jefeDepto, cargoDepto), firmaCelda(ctx.jefeLab, cargoLab))}
<p class="nota">${TEXTOS_LEGALES.map((t, n) => `${n + 1}. ${esc(t)}`).join(" ")}</p>`;

  const pagina2 = `
<div class="salto-pagina"></div>
${membrete(numero, cal.acreditacion)}
<h1>${esc(titulo)}</h1>
<p><b>${linea}</b></p>
<table class="meta"><tbody>
  <tr><th>Descripción del ítem</th><td>${v(ins.item)}</td><th>Rango calibrado</th><td>${v(ins.rango)}</td></tr>
  <tr><th>Resolución</th><td>${v(ins.res)}</td><th>Valor nominal</th><td>${v(ins.cap)}</td></tr>
</tbody></table>
<h2>Resultados de la calibración · valores obtenidos</h2>
${cuerpoRes}
<h2>Observaciones</h2>
<p>Intervalo de calibración: ${cal.intervalo_meses ? `${esc(cal.intervalo_meses)} meses` : "según requerimiento del cliente"}.</p>
<p>La incertidumbre expandida ha sido estimada multiplicando la incertidumbre estándar por el factor de cobertura k = ${k}.</p>
<p>El valor del mensurando se encuentra dentro del intervalo indicado de valores con una probabilidad del 95 %.</p>
<p>"--" = No aplica.</p>
${res.fueraAlcance ? "<p>* Las calibraciones marcadas no están incluidas en el alcance de acreditación.</p>" : ""}
${tablaFirmas(firmaCelda(ctx.jefeLab, cargoLab), firmaCelda(ctx.metrologo, "Metrólogo"))}
<p><b>Fin del certificado de calibración</b></p>`;

  return pagina1 + pagina2;
}
