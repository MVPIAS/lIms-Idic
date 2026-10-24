/**
 * EP-09 9.16 · Listado oficial de Codificación Única por fabricante (modelos
 * DGMN «MODELO LISTADO EXPLOSIVOS / SUSTANCIAS QUÍMICAS / EN RECESO»): encabezado
 * República de Chile · Ministerio de Defensa Nacional · DGMN, título, fabricante
 * y RUT, fecha de edición, totales, agrupación por grupo y familia, y firmas del
 * Subdirector del BPCH y del Jefe Depto. Control de Armas y Explosivos (DGMN).
 * Reglas y HTML PUROS, probados en listado-oficial.spec.ts. También la
 * exportación a Excel (CSV con BOM y punto y coma, como el resto del LIMS).
 */
import { escapeHtml } from "../../plantilla-render/html.util";
import { libroXlsx } from "../../common/xlsx-escritura";

export const TIPOS_LISTADO = ["EXPLOSIVOS", "SUSTANCIAS_QUIMICAS", "EN_RECESO"] as const;
export type TipoListado = (typeof TIPOS_LISTADO)[number];

export const TITULO_LISTADO: Record<TipoListado, string> = {
  EXPLOSIVOS: "LISTADO DE EXPLOSIVOS DE PRODUCCIÓN NACIONAL, CON CODIFICACIÓN ÚNICA",
  SUSTANCIAS_QUIMICAS: "LISTADO DE SUSTANCIAS QUÍMICAS CONTROLADAS",
  EN_RECESO: "LISTADO DE PRODUCTOS CONTROLADOS, EN RECESO",
};

export interface ProductoListado {
  listado: string;
  estado: string;
  cnc: string;
  fabricanteNombre: string;
  fabricanteRut: string | null;
  grupoListado: string | null;
  elementoGenerico: string | null;
  producto: string;
  claseDivisionUn: string | null;
  numeroUn: string | null;
  eqDin60: number | null;
  ptnPin: string | null;
}

/** Qué productos entran: vigentes del listado, o los en receso de ambos listados. */
export function entraEnListado(p: Pick<ProductoListado, "listado" | "estado">, tipo: TipoListado): boolean {
  if (tipo === "EN_RECESO") return p.estado === "EN_RECESO";
  return p.listado === tipo && p.estado === "VIGENTE";
}

export interface Familia {
  familia: string;
  productos: ProductoListado[];
}
export interface Grupo {
  grupo: string;
  familias: Familia[];
  total: number;
}
export interface SeccionFabricante {
  fabricante: string;
  rut: string | null;
  grupos: Grupo[];
  total: number;
}

const SIN_GRUPO = "Sin grupo asignado";
const orden = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

/** Agrupa por fabricante, grupo del listado y familia (elemento genérico), en orden. */
export function agruparListado(productos: ProductoListado[], tipo: TipoListado): SeccionFabricante[] {
  const porFab = new Map<string, ProductoListado[]>();
  for (const p of productos.filter((x) => entraEnListado(x, tipo))) {
    const k = p.fabricanteNombre.trim();
    porFab.set(k, [...(porFab.get(k) ?? []), p]);
  }
  return [...porFab.entries()]
    .sort(([a], [b]) => orden(a, b))
    .map(([fabricante, ps]) => {
      const porGrupo = new Map<string, ProductoListado[]>();
      for (const p of ps) {
        const g = p.grupoListado?.trim() || SIN_GRUPO;
        porGrupo.set(g, [...(porGrupo.get(g) ?? []), p]);
      }
      const grupos = [...porGrupo.entries()]
        .sort(([a], [b]) => (a === SIN_GRUPO ? 1 : b === SIN_GRUPO ? -1 : orden(a, b)))
        .map(([grupo, gs]) => {
          const porFam = new Map<string, ProductoListado[]>();
          for (const p of gs) {
            const f = p.elementoGenerico?.trim() || p.producto.trim();
            porFam.set(f, [...(porFam.get(f) ?? []), p]);
          }
          const familias = [...porFam.entries()]
            .sort(([a], [b]) => orden(a, b))
            .map(([familia, fs]) => ({ familia, productos: [...fs].sort((a, b) => orden(a.cnc, b.cnc)) }));
          return { grupo, familias, total: gs.length };
        });
      return { fabricante, rut: ps.find((p) => p.fabricanteRut)?.fabricanteRut ?? null, grupos, total: ps.length };
    });
}

const coma = (n: number | null) => (n == null ? "" : n.toFixed(2).replace(".", ","));
const letraEstado = (e: string) => (e === "EN_RECESO" ? "R" : "V");

/** Cuerpo HTML del listado (lo imprime el motor de PDF del LIMS: membrete, tablas y firmas). */
export function htmlListado(secciones: SeccionFabricante[], tipo: TipoListado, fechaEdicion: string, firmas: { subdirector: string; dgmn: string }): string {
  const fecha = fechaEdicion.split("-").reverse().join("-");
  const total = secciones.reduce((s, x) => s + x.total, 0);
  const col = tipo === "SUSTANCIAS_QUIMICAS" ? "SQN" : "PTN/PIN";
  const eq = tipo === "SUSTANCIAS_QUIMICAS" ? "EQ. 60 %" : "EQ.DIN 60 %";
  const partes: string[] = [];
  secciones.forEach((s, i) => {
    if (i > 0) partes.push(`<div class="salto-pagina"></div>`);
    partes.push(`<div class="membrete">
  <div class="escudo">DGMN</div>
  <div class="org">
    <b>REPÚBLICA DE CHILE · MINISTERIO DE DEFENSA NACIONAL</b>
    <span>Dirección General de Movilización Nacional</span>
  </div>
  <div class="doc"><b>Fecha de edición: ${escapeHtml(fecha)}</b><span>Banco de Pruebas de Chile</span></div>
</div>
<h1>${escapeHtml(TITULO_LISTADO[tipo])}</h1>
<table class="meta">
  <tr><th>Fabricante</th><td>${escapeHtml(s.fabricante)}</td><th>R.U.T.</th><td>${escapeHtml(s.rut ?? "—")}</td></tr>
  <tr><th>Total de elementos del listado</th><td>${s.total}</td><th>Total del documento</th><td>${total}</td></tr>
</table>`);
    for (const g of s.grupos) {
      partes.push(`<h2>${escapeHtml(g.grupo)} · ${g.total} elemento(s)</h2>`);
      for (const f of g.familias) {
        const filas = f.productos
          .map(
            (p) =>
              `<tr><td>${escapeHtml(p.cnc)}</td><td>${escapeHtml(p.claseDivisionUn ?? "")}</td><td>${escapeHtml(p.numeroUn ?? "")}</td>` +
              `<td>${coma(p.eqDin60)}</td><td>${escapeHtml(p.ptnPin ?? "")}</td><td>${escapeHtml(p.producto)}</td><td>${letraEstado(p.estado)}</td></tr>`,
          )
          .join("");
        partes.push(`<h3>${escapeHtml(f.familia)}</h3>
<table class="resultados"><thead><tr><th>Código asignado al elemento</th><th>Div. NU</th><th>Nº NU</th><th>${eq}</th><th>${col}</th><th>Producto</th><th>Estado</th></tr></thead>
<tbody>${filas}</tbody></table>
<p>Total de elementos de la familia: ${f.productos.length}</p>`);
      }
    }
    partes.push(`<div class="firmas">
  <div class="firma"><span class="linea"></span>${escapeHtml(firmas.subdirector)}</div>
  <div class="firma"><span class="linea"></span>${escapeHtml(firmas.dgmn)}</div>
</div>`);
  });
  if (!secciones.length) partes.push(`<h1>${escapeHtml(TITULO_LISTADO[tipo])}</h1><p>No hay productos en este listado para el fabricante indicado.</p>`);
  return partes.join("\n");
}

/** Filas del listado para Excel: cabecera y una fila por producto (B-077). */
export function filasListado(secciones: SeccionFabricante[]): (string | number | null)[][] {
  const filas: (string | number | null)[][] = [["Fabricante", "RUT", "Grupo", "Familia", "Código asignado", "Div. NU", "Nº NU", "EQ.DIN 60 %", "PTN/PIN", "Producto", "Estado"]];
  for (const s of secciones)
    for (const g of s.grupos)
      for (const f of g.familias)
        for (const p of f.productos)
          filas.push([s.fabricante, s.rut, g.grupo, f.familia, p.cnc, p.claseDivisionUn, p.numeroUn, p.eqDin60 ?? null, p.ptnPin, p.producto, letraEstado(p.estado)]);
  return filas;
}

/** Excel (B-077): libro .xlsx con el listado (la EQ.DIN 60 % va como número). */
export function xlsxListado(secciones: SeccionFabricante[]): Buffer {
  return libroXlsx([{ nombre: "Listado oficial", filas: filasListado(secciones) }]);
}

/** CSV con BOM y punto y coma (se conserva para quien lo use; la pantalla descarga .xlsx). */
export function csvListado(secciones: SeccionFabricante[]): string {
  const c = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const filas = [["Fabricante", "RUT", "Grupo", "Familia", "Código asignado", "Div. NU", "Nº NU", "EQ.DIN 60 %", "PTN/PIN", "Producto", "Estado"].join(";")];
  for (const s of secciones)
    for (const g of s.grupos)
      for (const f of g.familias)
        for (const p of f.productos)
          filas.push(
            [s.fabricante, s.rut, g.grupo, f.familia, p.cnc, p.claseDivisionUn, p.numeroUn, coma(p.eqDin60), p.ptnPin, p.producto, letraEstado(p.estado)].map(c).join(";"),
          );
  return `﻿${filas.join("\r\n")}\r\n`;
}
