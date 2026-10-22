/**
 * Bloques HTML que los formularios especializados aportan a los documentos ·
 * funciones PURAS (bloques-formularios.spec.ts). Todo dato pasa por escapeHtml.
 *
 *   {{tabla_disparos}}   resultados por panel (Informe de Ensayo de Rechazo, IE)
 *   {{tabla_exigencia}}  exigencia de munición (CRB)
 *   {{tabla_reemplazos}} unidades ensayadas y su reposición (CRB)
 *   {{tabla_aql}}        inspección por atributos del lote (IVC, sección V)
 *   actaNovedades()      Resumen / Acta de Entrega de Novedades del lote SVM
 */
import { escapeHtml } from "../plantilla-render/html.util";
import type { FilaEvaluada } from "./aql";
import type { Amenaza, LoteEvaluado, RegistroDisparos } from "./lrb";
import type { LoteSvm, Novedad } from "./hcp";

const GUION = "-.-";
const n = (v: number | null | undefined, dec = 1) => (v == null || !Number.isFinite(v) ? GUION : v.toLocaleString("es-CL", { maximumFractionDigits: dec }));
const td = (v: unknown, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${v === null || v === undefined || v === "" ? GUION : escapeHtml(v)}</td>`;
const condicion = (v: string) => (v === "cumple" ? "Cumple" : v === "no_cumple" ? "No cumple" : "Pendiente");
const claseCond = (v: string) => (v === "cumple" ? "ok" : v === "no_cumple" ? "no" : "");

/** Resultados por panel: los disparos que no se hicieron por detención del panel salen «-.-». */
export function tablaDisparos(l: LoteEvaluado): string {
  const filas: string[] = [];
  for (const u of l.unidades)
    for (const p of u.paneles) {
      const plan = p.amenazaFila?.disparos ?? p.disparos.length;
      for (let i = 1; i <= Math.max(plan, p.disparos.length); i++) {
        const d = p.disparos.find((x) => x.n === i);
        const lam = d && d.laminasPerforadas != null ? `${d.laminasPerforadas}${d.laminasTotal != null ? `/${d.laminasTotal}` : ""}` : null;
        filas.push(
          "<tr>" +
            td(`${u.serie}${u.talla ? ` (${u.talla})` : ""}`) +
            td(p.zona) +
            td(p.amenazaFila?.municion ?? p.amenaza) +
            td(i, "num") +
            `<td class="num">${d ? n(d.v1) : GUION}</td>` +
            `<td class="num">${d ? n(d.v2 ?? null) : GUION}</td>` +
            `<td class="num">${d ? n(d.trauma ?? null) : GUION}</td>` +
            td(lam, "num") +
            td(d ? (d.penetracion ? "Sí" : "No") : null) +
            (d ? `<td class="${claseCond(d.condicion)}">${escapeHtml(condicion(d.condicion))}${d.fueraVentana ? " · velocidad fuera de ventana" : ""}</td>` : `<td>${p.detenido ? "Panel detenido" : GUION}</td>`) +
            "</tr>",
        );
      }
    }
  if (!filas.length) return `<table class="rep"><tbody><tr><td class="vacio">Sin disparos registrados.</td></tr></tbody></table>`;
  return (
    `<table class="rep"><thead><tr><th>Unidad</th><th>Panel</th><th>Munición</th><th class="num">Disparo</th>` +
    `<th class="num">V1 (m/s)</th><th class="num">V2 (m/s)</th><th class="num">Trauma (mm)</th><th class="num">Láminas</th><th>Penetración</th><th>Condición</th>` +
    `</tr></thead><tbody>${filas.join("")}</tbody></table>`
  );
}

/** Exigencia de munición de las amenazas usadas en el lote. */
export function tablaExigencia(amenazas: Amenaza[]): string {
  if (!amenazas.length) return `<table class="rep"><tbody><tr><td class="vacio">Sin munición registrada.</td></tr></tbody></table>`;
  const filas = amenazas
    .map((a) => "<tr>" + td(`${a.norma} · ${a.nivel}`) + td(a.municion) + `<td class="num">${n(a.masa_g, 2)}</td>` + td(`${n(a.v_min)}–${n(a.v_max)}`) + td(a.disparos, "num") + td(a.criterio) + "</tr>")
    .join("");
  return `<table class="rep"><thead><tr><th>Norma · nivel</th><th>Munición</th><th class="num">Masa (g)</th><th>Velocidad (m/s)</th><th class="num">Disparos</th><th>Criterio</th></tr></thead><tbody>${filas}</tbody></table>`;
}

/** Unidades ensayadas (destruidas) y la serie que las reemplaza en el lote. */
export function tablaReemplazos(r: RegistroDisparos): string {
  if (!r.unidades.length) return `<table class="rep"><tbody><tr><td class="vacio">Sin unidades ensayadas.</td></tr></tbody></table>`;
  const filas = r.unidades.map((u) => "<tr>" + td(u.serie) + td(u.talla ?? null) + td(u.reemplazo ?? null) + "</tr>").join("");
  return `<table class="rep"><thead><tr><th>Serie ensayada</th><th>Talla</th><th>Serie de reposición</th></tr></thead><tbody>${filas}</tbody></table>`;
}

/** Sección V del IVC: inspección por atributos (AQL). */
export function tablaAql(tamanoLote: number, filas: FilaEvaluada[]): string {
  if (!filas.length) return "";
  const cuerpo = filas
    .map(
      (f) =>
        "<tr>" +
        td(f.inspeccion) +
        td(f.aql, "num") +
        td(f.nivel) +
        td(f.plan.letra) +
        td(f.plan.n, "num") +
        td(f.ac, "num") +
        td(f.re, "num") +
        td(f.defectuosos, "num") +
        `<td class="${claseCond(f.cumplimiento)}">${escapeHtml(condicion(f.cumplimiento))}</td>` +
        "</tr>",
    )
    .join("");
  return (
    `<p>Tamaño del lote: ${escapeHtml(tamanoLote.toLocaleString("es-CL"))} unidades. Muestreo simple, inspección normal (NCh 44). Acepta si los defectuosos son ≤ Ac; rechaza si son ≥ Re.</p>` +
    `<table class="rep"><thead><tr><th>Inspección</th><th class="num">AQL</th><th>Nivel</th><th>Letra</th><th class="num">n</th><th class="num">Ac</th><th class="num">Re</th><th class="num">Defectuosos</th><th>Cumplimiento</th></tr></thead><tbody>${cuerpo}</tbody></table>`
  );
}

/** Cuerpo del «Resumen / Acta de Entrega de Novedades» del lote (LVM-PG01-P02-IT02, EP-05 4.8). */
export function actaNovedades(p: {
  ot: string;
  cliente: string | null;
  plantilla: string;
  fecha: string;
  lote: LoteSvm;
  novedades: Novedad[];
  emitidaPor: string | null;
}): string {
  const filas = p.novedades.length
    ? p.novedades
        .map((x) => "<tr>" + td(`Nº ${x.vehiculo}${x.chasis ? ` · ${x.chasis}` : ""}`) + td(x.item) + td(x.clase) + td(x.descripcion) + td(x.accionProveedor) + "</tr>")
        .join("")
    : `<tr><td colspan="5" class="vacio">Sin novedades: todos los ítems inspeccionados están conformes.</td></tr>`;
  const clases = p.lote.clases
    .map((c) => `<li>Clase ${escapeHtml(c.clase)} (AQL ${escapeHtml(c.aql)}): ${c.vehiculosConNc} vehículo(s) con N/C · Ac ${c.ac} / Re ${c.re} → ${c.decision === "acepta" ? "acepta" : "rechaza"}</li>`)
    .join("");
  const veredicto = p.lote.veredicto === "cumple" ? "CUMPLE" : p.lote.veredicto === "no_cumple" ? "NO CUMPLE" : "PENDIENTE";
  return (
    `<div class="membrete"><div class="escudo">IDIC</div><div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>` +
    `<span>Ejército de Chile &middot; Departamento Sistemas de Armas &middot; Sección Vehículos Militares</span></div>` +
    `<div class="doc"><b>Acta de novedades · OT ${escapeHtml(p.ot)}</b><span>LVM-PG01-P02-IT02</span></div></div>` +
    `<h1>RESUMEN / ACTA DE ENTREGA DE NOVEDADES</h1>` +
    `<table class="meta"><tr><th>Orden de Trabajo</th><td>${escapeHtml(p.ot)}</td><th>Fecha</th><td>${escapeHtml(p.fecha)}</td></tr>` +
    `<tr><th>Cliente</th><td>${escapeHtml(p.cliente ?? "—")}</td><th>HCP</th><td>${escapeHtml(p.plantilla)}</td></tr>` +
    `<tr><th>Tamaño del lote</th><td>${p.lote.tamanoLote}</td><th>Vehículos inspeccionados</th><td>${p.lote.inspeccionados} de ${p.lote.muestra}</td></tr></table>` +
    `<h2>Novedades por vehículo</h2>` +
    `<table class="rep"><thead><tr><th>Vehículo</th><th>Ítem</th><th>Clase</th><th>Descripción</th><th>Acción del proveedor</th></tr></thead><tbody>${filas}</tbody></table>` +
    `<h2>Evaluación del lote por clase de defecto</h2><ul>${clases}</ul>` +
    `<p><b>Veredicto del lote: ${veredicto}.</b> Regla por confirmar con el IDIC (AQL y Ac/Re por clase, EP-05 P15).</p>` +
    `<div class="firmas"><div class="firma"><span class="linea"></span>Analista SVM</div><div class="firma"><span class="linea"></span>Analista SVM</div><div class="firma"><span class="linea"></span>Jefe de Comisión Inspectora</div></div>`
  );
}
