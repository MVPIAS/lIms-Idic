/**
 * Cuerpo HTML del Certificado de Calibración según cómo se calculó:
 *   - motor GUM parametrizado (procesos sin caso real: ITM03, ITV05),
 *   - motor validado de una IT del LMT,
 *   - motor ISO 376 del LNF (curva, clase por rango y tabla de interpolación),
 *   - formulario estándar por puntos (eléctrica, tiempo, otras magnitudes).
 * El PDF lo arma plantilla-render (membrete, sello SHA-256 y marca de BORRADOR).
 */
import { REGISTRO_MOTORES, type ResumenMotor } from "./motores";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const f = (x: any, d = 4) => (x == null || isNaN(Number(x)) ? "—" : Number(x).toLocaleString("es-CL", { maximumFractionDigits: d }));
const fx = (x: any, d: number) => (x == null || isNaN(Number(x)) ? "—" : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fecha = (x: any) => (x ? new Date(x).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }) : "—");
/** Fecha sin hora (columna DATE): se lee en UTC para no correrla un día. */
const dia = (x: any) => (x ? new Date(x).toLocaleDateString("es-CL", { timeZone: "UTC" }) : "—");
const TABLA = `border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:11px"`;

function cabecera(cal: any): string {
  const ins = cal.instrumento ?? {}, pat = cal.patron_snap ?? {}, amb = cal.ambiente ?? {};
  const acr = cal.acreditacion ? `Acreditación ${esc(cal.acreditacion)}` : "Servicio sin acreditación declarada";
  return `
    <h2>CERTIFICADO DE CALIBRACIÓN ${esc(cal.codigo)}</h2>
    <p><b>${esc(cal.laboratorio_nombre ?? "Sección Metrología")} · IDIC · ${acr}</b><br>Método ${esc(cal.proceso)} — ${esc(cal.metodo ?? "")}${cal.norma ? " · " + esc(cal.norma) : ""}</p>
    <h3>Instrumento</h3><p>${esc(ins.item ?? "—")} · ${esc(ins.marca ?? "")} · N° serie ${esc(ins.serie ?? "—")}${ins.cap ? ` · Capacidad ${esc(ins.cap)}` : ""}${ins.res ? ` · Resolución ${esc(ins.res)}` : ""}<br>Cliente: ${esc(ins.cliente ?? "—")}${ins.ot ? ` · OT ${esc(ins.ot)}` : ""}</p>
    <h3>Condiciones</h3><p>Fecha de calibración ${dia(cal.fecha_calibracion)} · Temperatura (${esc(amb.temp ?? "—")} ± ${esc(amb.tempU ?? "—")}) °C · Humedad (${esc(amb.hum ?? "—")} ± ${esc(amb.humU ?? "—")}) %HR</p>
    <h3>Patrón</h3><p>${esc(pat.nombre ?? "—")} · Clase ${esc(pat.clase ?? "—")} · Cert. ${esc(pat.cert ?? "—")} · Trazabilidad ${esc(pat.trazab ?? "—")}</p>`;
}

function firmas(cal: any): string {
  return `
    <h3>Responsables</h3>
    <table ${TABLA}>
      <thead><tr><th>Calibrado por</th><th>Revisado y emitido por</th><th>Fecha de emisión</th></tr></thead>
      <tbody><tr><td>${esc(cal.autor_nombre ?? "—")}</td><td>${esc(cal.emisor_nombre ?? "Pendiente de revisión")}</td><td>${cal.emitido_at ? fecha(cal.emitido_at) : "—"}</td></tr></tbody>
    </table>`;
}

/** Motor GUM parametrizado (metrologia.calc). */
function cuerpoGum(cal: any): string {
  const u = cal.unidad, dec = cal.decimales ?? 3;
  const filas = (cal.puntos ?? []).map((p: any) =>
    `<tr><td style="text-align:right">${fx(p.nominal, dec > 3 ? 2 : 1)}</td><td style="text-align:right">${fx(p.referencia, dec)}</td>
     <td style="text-align:right">${fx(p.media, dec)}</td><td style="text-align:right">${fx(p.error, dec)}</td>
     <td style="text-align:right">± ${fx(p.u_exp ?? p.uExp, dec)}</td><td>${p.dentro ? "Cumple" : "No cumple"}</td></tr>`).join("");
  return `
    <h3>Resultados de la calibración</h3>
    <table ${TABLA}>
      <thead><tr><th>Nominal ${u}</th><th>Ind. patrón</th><th>Ind. instrumento</th><th>Error</th><th>U (k=2)</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <p style="margin-top:10px"><b>Síntesis:</b> la mayor incertidumbre expandida es ± ${fx(cal.u_max, dec)} ${u} para un nivel de confianza del 95 % (k = 2).</p>`;
}

/** Motor validado de una IT del LMT. */
function cuerpoMotor(cal: any): string {
  const m = REGISTRO_MOTORES[cal.motor], r: ResumenMotor = cal.resumen;
  const corr = Object.entries(cal.opciones ?? {}).filter(([, v]) => v).map(([k]) => m.opciones.find((o) => o.clave === k)?.hallazgo ?? k);
  const filas = r.puntos.map((p) =>
    `<tr><td style="text-align:right">${f(p.nominal)}</td><td style="text-align:right">${f(p.error, 6)}</td>
     <td style="text-align:right">± ${f(p.Ucert ?? p.U, 6)}</td><td>${p.conforme == null ? "—" : p.conforme ? "Cumple" : "No cumple"}</td></tr>`).join("");
  return `
    <h3>Resultados de la calibración</h3>
    <table ${TABLA}>
      <thead><tr><th>Nominal ${m.unidad}</th><th>Error ${m.unidadU === "%" ? "%" : m.unidad}</th><th>U (k=2) ${m.unidadU}</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <p style="margin-top:10px"><b>Síntesis:</b> la mayor incertidumbre expandida informada es ± ${f(r.uCert ?? r.uMax, 6)} ${m.unidadU} para un nivel de confianza del 95 % (k = 2).</p>
    <p style="font-size:10px;color:#555">Cálculo según ${m.it} con el motor validado contra el libro de trabajo del laboratorio${corr.length ? ` · correcciones aplicadas: ${corr.join(", ")}` : ""}.</p>`;
}

/** ISO 376 · LNF: deflexiones, parámetros, curva, clase por rango e interpolación. */
function cuerpoLNF(cal: any): string {
  const R = cal.resultado ?? {}, rows: any[] = R.rows ?? [], c = R.coef ?? {};
  const m = REGISTRO_MOTORES[cal.motor];
  const corr = Object.entries(cal.opciones ?? {}).filter(([, v]) => v).map(([k]) => m?.opciones.find((o) => o.clave === k)?.hallazgo ?? k);
  const sci = (x: any) => (x == null ? "—" : Number(x).toExponential(12).replace(".", ","));
  const sentido = cal.datos?.sentido ? esc(cal.datos.sentido) : "—";
  const defl = rows.map((x) => `<tr><td style="text-align:right">${f(x.F, 3)}</td>${x.X.map((v: any) => `<td style="text-align:right">${v == null ? "-.-" : fx(v, 5)}</td>`).join("")}</tr>`).join("");
  const res = rows.map((x) => `<tr><td style="text-align:right">${f(x.F, 3)}</td><td style="text-align:right">${fx(x.Xr, 6)}</td><td style="text-align:right">${fx(x.b, 3)}</td>
    <td style="text-align:right">${fx(x.Xwr, 6)}</td><td style="text-align:right">${fx(x.bp, 3)}</td><td style="text-align:right">${fx(x.Xa, 6)}</td>
    <td style="text-align:right">${fx(x.fc, 3)}</td><td style="text-align:right">${x.v == null ? "-.-" : fx(x.v, 3)}</td>
    <td style="text-align:right">${fx(x.U, 3)}</td><td style="text-align:right">${fx(x.UD, 3)}</td><td>${esc(x.etiqueta)}</td></tr>`).join("");
  const rangos = (R.rangos ?? []).map((g: any) => `<tr><td>Desde ${f(g.desde, 3)} hasta ${f(g.hasta, 3)} kN</td><td>${esc(g.clase)}</td></tr>`).join("");
  const interp = (R.tabla ?? []).map((t: any) => `<tr><td style="text-align:right">${f(t.F, 3)}</td>${t.S.map((v: number) => `<td style="text-align:right">${fx(v, 5)}</td>`).join("")}</tr>`).join("");
  const p0 = R.tabla?.[0]?.F ?? 0;
  return `
    <h3>Resultados · calibración en ${sentido} · ISO 376:2011</h3>
    <p>Rango calibrado ${f(rows[0]?.F, 3)} a ${f(rows[rows.length - 1]?.F, 3)} kN · Resolución ${fx(R.r, 3)} kN · Temperatura ${R.tMed == null ? "—" : `${f(R.tMed, 1)} ± ${f(R.tRan, 1)} °C (${esc(R.tEstado)})`} · f0 máx. ${fx(R.f0max, 4)} %</p>
    <h3>Deformación durante la calibración (mV/V)</h3>
    <table ${TABLA}>
      <thead><tr><th>F kN</th><th>X1 0°</th><th>X2 0°</th><th>X3 120°</th><th>X4 120° desc.</th><th>X5 240°</th><th>X6 240° desc.</th></tr></thead>
      <tbody>${defl}</tbody></table>
    <h3>Promedios, errores relativos e incertidumbre (%)</h3>
    <table ${TABLA}>
      <thead><tr><th>F kN</th><th>Xr</th><th>b</th><th>Xwr</th><th>b'</th><th>Xa</th><th>fc</th><th>v</th><th>U caso C</th><th>U caso D</th><th>Clase</th></tr></thead>
      <tbody>${res}</tbody></table>
    <p><b>Ecuación de interpolación:</b> S = a·F + b·F² + c·F³ con a = ${sci(c.S3?.[0])}, b = ${sci(c.S3?.[1])}, c = ${sci(c.S3?.[2])} (S en mV/V, F en kN).<br>
       <b>Ecuación inversa:</b> F = t·S + u·S² + v·S³ con t = ${sci(c.F3?.[0])}, u = ${sci(c.F3?.[1])}, v = ${sci(c.F3?.[2])}.</p>
    <h3>Clasificación por rango (caso C: con fluencia estimada, sin reversibilidad)</h3>
    <table ${TABLA}><thead><tr><th>Rango</th><th>Clase</th></tr></thead><tbody>${rangos}</tbody></table>
    <h3>Tabla de interpolación (mV/V)</h3>
    <table ${TABLA}>
      <thead><tr><th>kN</th><th>+0</th><th>+${f(p0 / 10, 3)}</th><th>+${f(p0 / 10 * 2, 3)}</th><th>+${f(p0 / 10 * 3, 3)}</th><th>+${f(p0 / 10 * 4, 3)}</th></tr></thead>
      <tbody>${interp}</tbody></table>
    <p style="font-size:10px;color:#555">Incertidumbre expandida con factor de cobertura k = ${f(R.k, 2)} (probabilidad aproximada del 95 %), según ISO 376 Anexo C y EURAMET cg-4.
      Cálculo con el motor ${esc(cal.motor)} validado contra la planilla LCPN-F-PG01-P01-IT01${corr.length ? ` · correcciones aplicadas: ${corr.join(", ")}` : ""}.</p>`;
}

/** Formulario estándar por puntos. */
function cuerpoPuntos(cal: any): string {
  const R = cal.resultado ?? {}, rows: any[] = R.rows ?? [];
  const filas = rows.map((x) => `<tr><td>${esc(x.funcion || "—")}</td><td style="text-align:right">${f(x.nom, 6)} ${esc(x.unidad)}</td>
    <td style="text-align:right">${f(x.mPat, 8)}</td><td style="text-align:right">${f(x.mInst, 8)}</td><td style="text-align:right">${f(x.err, 8)}</td>
    <td style="text-align:right">± ${f(x.U, 8)}</td><td style="text-align:right">${x.emp == null ? "—" : "± " + f(x.emp, 8)}</td>
    <td>${x.conforme == null ? "Sin tolerancia" : x.conforme ? "Cumple" : "No cumple"}</td></tr>`).join("");
  const regla = R.regla === "simple" ? "|error| ≤ EMP" : "|error| + U ≤ EMP";
  return `
    <h3>Resultados de la calibración (comparación directa con el patrón, ${f(R.n, 0)} series por punto)</h3>
    <table ${TABLA}>
      <thead><tr><th>Función / rango</th><th>Nominal</th><th>Ind. patrón</th><th>Ind. instrumento</th><th>Error</th><th>U (k=2)</th><th>EMP</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody></table>
    <p style="font-size:10px;color:#555">Error = promedio de (lectura del instrumento - lectura del patrón). u_A = s / raíz(n); u_patrón = U del certificado del patrón / k (${f(R.kPatron, 2)});
      u_resolución = d / (2 · raíz(3)) cuando se informa; U = 2 · raíz(u_A² + u_patrón² + u_resolución²), nivel de confianza aproximado del 95 %.
      Regla de decisión (solo donde hay tolerancia): cumple si ${regla}.</p>`;
}

export function certificadoHtml(cal: any): string {
  const cuerpo = !cal.motor || !cal.resumen ? cuerpoGum(cal)
    : cal.motor === "LCPNF-IT01" ? cuerpoLNF(cal)
    : cal.motor === "PUNTOS" ? cuerpoPuntos(cal)
    : cuerpoMotor(cal);
  return cabecera(cal) + cuerpo + firmas(cal);
}
