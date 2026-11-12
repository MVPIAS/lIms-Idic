/**
 * Evidencias de prueba de IBIS («evidencias blancas») · reglas PURAS, probadas
 * en ibis-testigos.spec.ts.
 *
 * Cada arma importada se dispara en el banco de pruebas: la vaina y el proyectil
 * quedan como evidencia. El XML diario de IBIS (ESI 3.2) las trae como <Exhibit>
 * con <TestFirearmExhibitUUID> = UUID del arma. Aquí: tipo de la evidencia, texto
 * del resultado, bloque del certificado por arma y ficha imprimible tipo
 * biblioteca (la ubicación es TEXTO: el IDIC aún no clasifica su almacén).
 */
import { escapeHtml } from "../plantilla-render/html.util";
import { svgCode128 } from "../common/code128";

export type TipoTestigo = "vainilla" | "proyectil";

/** «Cartridge Case» → vaina; «Bullet» → proyectil; el resto no es evidencia de prueba. */
export function tipoTestigo(tipoEsi: string | null | undefined): TipoTestigo | null {
  const t = String(tipoEsi ?? "").toLowerCase();
  if (t.includes("cartridge") || t.includes("casing")) return "vainilla";
  if (t.includes("bullet") || t.includes("projectile")) return "proyectil";
  return null;
}

export const NOMBRE_TESTIGO: Record<string, string> = { vainilla: "Vaina", proyectil: "Proyectil" };

/** Texto del resultado de IBIS: «Con hit (2)», «Sin hit». */
export function textoHit(hitCount: number | null | undefined): string {
  const n = Number(hitCount ?? 0);
  return n > 0 ? `Con hit (${n})` : "Sin hit";
}

export interface IbisDeArma {
  uuid: string | null;
  exhibit: string | null;
  fechaPrueba: string | null;
  hitCount: number;
  evidencias: { codigo: string; tipo: string; exhibit: string | null; hitCount: number; ubicacion: string | null }[];
}

/** Marca que deja en el certificado el bloque IBIS sin resultado. */
export const MARCA_PENDIENTE_IBIS = "Pendiente de IBIS";

/**
 * fx5-c · F039: el certificado por arma se emitió «Pendiente de IBIS» y después
 * llegó el registro del arma: hay que reemitirlo para incorporarlo. Solo los
 * vigentes (en firma u oficiales); uno anulado o reemplazado ya no cuenta.
 */
export function debeReemitirPorIbis(c: { estado: string; documentoHtml: string | null | undefined; ibisAsignado: boolean }): boolean {
  if (!c.ibisAsignado) return false;
  if (!["en_firma", "oficial", "emitido"].includes(c.estado)) return false;
  return (c.documentoHtml ?? "").includes(MARCA_PENDIENTE_IBIS);
}

/** Bloque «Registro balístico IBIS» del certificado por arma (CERTARMA). */
export function bloqueIbisArma(d: IbisDeArma | null): string {
  if (!d) {
    return `<h2>Registro balístico IBIS</h2>
<table class="meta"><tr><th>Estado</th><td><b>Pendiente de IBIS</b>: el resultado se agrega cuando llega el archivo diario de IBIS.</td></tr></table>`;
  }
  const filas = d.evidencias
    .map(
      (e) =>
        `<tr><td>${escapeHtml(NOMBRE_TESTIGO[e.tipo] ?? e.tipo)}</td><td>${escapeHtml(e.codigo)}</td><td>${escapeHtml(e.exhibit ?? "—")}</td><td>${escapeHtml(textoHit(e.hitCount))}</td></tr>`,
    )
    .join("");
  return `<h2>Registro balístico IBIS</h2>
<table class="meta">
  <tr><th>Identificador IBIS</th><td>${escapeHtml(d.uuid ?? "—")}${d.exhibit ? ` · ${escapeHtml(d.exhibit)}` : ""}</td><th>Fecha de prueba</th><td>${escapeHtml(d.fechaPrueba ?? "—")}</td></tr>
  <tr><th>Resultado</th><td colspan="3"><b>${escapeHtml(textoHit(d.hitCount))}</b></td></tr>
</table>
${
  filas
    ? `<table class="resultados"><thead><tr><th>Evidencia de prueba</th><th>Código</th><th>Nº IBIS</th><th>Resultado</th></tr></thead><tbody>${filas}</tbody></table>`
    : `<p>Las evidencias de prueba (vaina y proyectil) se registran cuando IBIS las envía.</p>`
}`;
}

export interface FichaEvidencia {
  codigo: string;
  codigoBarras: string | null;
  tipo: string;
  exhibit: string | null;
  uuidIbis: string | null;
  serie: string | null;
  marca: string | null;
  modelo: string | null;
  calibre: string | null;
  ot: string | null;
  fechaDisparo: string | null;
  ubicacion: string | null;
  hitCount: number;
}

/** Una ficha (tipo ficha bibliográfica) con código de barras. */
export function fichaEvidencia(f: FichaEvidencia): string {
  const fila = (k: string, v: string | null | undefined) => `<tr><th>${k}</th><td>${escapeHtml(v && String(v).trim() ? String(v) : "—")}</td></tr>`;
  return `<div class="ficha">
  <div class="cab"><b>${escapeHtml(f.codigo)}</b><span>${escapeHtml(NOMBRE_TESTIGO[f.tipo] ?? f.tipo)} · IDIC</span></div>
  ${svgCode128(f.codigoBarras || f.codigo)}
  <table>
    ${fila("Arma · serie", f.serie)}
    ${fila("Marca / modelo", [f.marca, f.modelo].filter(Boolean).join(" ") || null)}
    ${fila("Calibre", f.calibre)}
    ${fila("OT", f.ot)}
    ${fila("Fecha de disparo", f.fechaDisparo)}
    ${fila("Nº IBIS", [f.exhibit, f.uuidIbis].filter(Boolean).join(" · ") || null)}
    ${fila("Resultado IBIS", textoHit(f.hitCount))}
    <tr class="ubic"><th>Ubicación</th><td>${escapeHtml(f.ubicacion?.trim() || "Sin ubicación asignada")}</td></tr>
  </table>
</div>`;
}

/** Página imprimible con varias fichas. */
export function paginaFichas(titulo: string, fichas: FichaEvidencia[], generada: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:12px;color:#111}
  .barra{margin-bottom:10px;font-size:12px;color:#444}
  .hoja{display:grid;grid-template-columns:repeat(auto-fill,minmax(85mm,1fr));gap:6mm}
  .ficha{border:1px solid #444;padding:3mm;break-inside:avoid;page-break-inside:avoid}
  .ficha svg{display:block;max-width:100%;height:auto;margin:1mm 0}
  .cab{display:flex;justify-content:space-between;font-size:12px;margin-bottom:1mm}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{text-align:left;color:#444;font-weight:normal;width:34%;padding:.6mm 1mm .6mm 0;vertical-align:top}
  td{padding:.6mm 0}
  tr.ubic td{font-weight:bold;font-size:12px}
  @media print{.barra{display:none} body{margin:0}}
</style></head><body>
<div class="barra">${fichas.length} ficha(s) · ${escapeHtml(generada)} · imprima con Ctrl + P</div>
<div class="hoja">
${fichas.map(fichaEvidencia).join("\n")}
</div></body></html>`;
}

/** Normaliza lo que escribe el usuario para buscar por serie (como serie_normalizada). */
export function normalizarBusqueda(q: string): { texto: string; serie: string } {
  const texto = q.trim().slice(0, 80);
  return { texto, serie: texto.toUpperCase().replace(/[^A-Z0-9]/g, "") };
}
