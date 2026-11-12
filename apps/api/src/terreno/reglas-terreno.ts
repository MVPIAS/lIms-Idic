/**
 * Trabajo en terreno sin recepción ni toma de muestras · sesión R10 (Vehículos
 * Militares, 04-11-2026), también para Armamento y Telecomunicaciones.
 * Reglas PURAS (reglas-terreno.spec.ts).
 *
 * Pasos de la OT en terreno:
 *   1. Apertura de la OT en terreno (lugar, fechas, control al 100 % o por
 *      muestreo con letra código y número de muestras).
 *   2. Asignación de analistas.
 *   3. Selección de las pruebas según el protocolo de recepción cualitativa
 *      (formato de control de prueba) y de las unidades controladas (por
 *      vehículo: chasis, motor y año de fabricación).
 *   4. Lista de chequeo: el resultado de cada prueba (cumple / no cumple /
 *      no aplica) registrado en el LIMS y la hoja de control de pruebas adjunta.
 *   5. IVC: grado de cumplimiento (cumple / no cumple) y el informe adjunto,
 *      trazables con el protocolo y las hojas de control.
 *   6. Cierre del trabajo en terreno: resultado por sistema controlado.
 */

export const MODALIDADES = ["total", "muestreo"] as const;
export type Modalidad = (typeof MODALIDADES)[number];
export const RESULTADOS_PRUEBA = ["cumple", "no_cumple", "no_aplica"] as const;
export type ResultadoPrueba = (typeof RESULTADOS_PRUEBA)[number];
export const TIPOS_ADJUNTO = ["protocolo", "hoja_control", "ivc", "otro"] as const;
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number];
export const NOMBRE_ADJUNTO: Record<TipoAdjunto, string> = {
  protocolo: "Protocolo de recepción",
  hoja_control: "Hoja de control de pruebas",
  ivc: "Informe de verificación de calidad (IVC)",
  otro: "Otro documento",
};

/* ------------------------------------------------------------- apertura --- */

export interface DatosApertura {
  lugar?: string | null;
  fechaInicio?: string | null;
  fechaTermino?: string | null;
  modalidad?: string | null;
  normaMuestreo?: string | null;
  letraCodigo?: string | null;
  tamanoLote?: number | null;
  nMuestras?: number | null;
}

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** Errores de los datos de apertura (lista vacía = válidos). */
export function erroresApertura(d: DatosApertura): string[] {
  const e: string[] = [];
  if (vacio(d.lugar)) e.push("Indique el lugar del trabajo en terreno.");
  if (vacio(d.fechaInicio)) e.push("Indique la fecha de inicio.");
  if (!vacio(d.fechaInicio) && !vacio(d.fechaTermino) && String(d.fechaTermino) < String(d.fechaInicio))
    e.push("La fecha de término no puede ser anterior a la de inicio.");
  if (!d.modalidad || !(MODALIDADES as readonly string[]).includes(d.modalidad)) e.push("Elija el control: al 100 % o por muestreo.");
  if (d.modalidad === "muestreo") {
    if (vacio(d.letraCodigo)) e.push("Con muestreo por norma, indique la letra código.");
    else if (!/^[A-R]$/i.test(String(d.letraCodigo).trim())) e.push("La letra código va de la A a la R (NCh 44).");
    if (d.nMuestras == null || !Number.isInteger(d.nMuestras) || d.nMuestras <= 0) e.push("Con muestreo por norma, indique el número de muestras.");
  }
  if (d.tamanoLote != null && (!Number.isInteger(d.tamanoLote) || d.tamanoLote <= 0)) e.push("El tamaño del lote debe ser un entero mayor que cero.");
  if (d.tamanoLote != null && d.nMuestras != null && d.nMuestras > d.tamanoLote) e.push("El número de muestras no puede superar el tamaño del lote.");
  return e;
}

/* -------------------------------------------------------------- unidades --- */

export interface UnidadControlada {
  descripcion?: string | null;
  chasis?: string | null;
  motor?: string | null;
  anioFabricacion?: number | null;
  serie?: string | null;
  seleccionada?: boolean;
}

/** Errores de las unidades controladas (vehículo: chasis, motor y año; arma o equipo: serie). */
export function erroresUnidades(unidades: UnidadControlada[], anioActual: number): string[] {
  const e: string[] = [];
  const chasis = new Set<string>();
  unidades.forEach((u, i) => {
    const n = `Unidad ${i + 1}`;
    if (vacio(u.chasis) && vacio(u.serie) && vacio(u.descripcion)) e.push(`${n}: indique el chasis, la serie o una descripción.`);
    if (u.anioFabricacion != null && (!Number.isInteger(u.anioFabricacion) || u.anioFabricacion < 1900 || u.anioFabricacion > anioActual + 1))
      e.push(`${n}: el año de fabricación no es válido.`);
    const c = String(u.chasis ?? "").trim().toUpperCase();
    if (c) {
      if (chasis.has(c)) e.push(`${n}: el chasis ${c} está repetido.`);
      chasis.add(c);
    }
  });
  if (unidades.length > 500) e.push("Registre como máximo 500 unidades.");
  return e;
}

/**
 * Selección de unidades según el control: al 100 % se controlan todas; por
 * muestreo, exactamente el número de muestras indicado.
 */
export function erroresSeleccion(modalidad: string, nMuestras: number | null, unidades: { seleccionada: boolean }[]): string[] {
  if (!unidades.length) return [];
  const sel = unidades.filter((u) => u.seleccionada).length;
  if (modalidad === "total" && sel !== unidades.length) return ["Con control al 100 % se controlan todas las unidades."];
  if (modalidad === "muestreo" && nMuestras != null && sel !== nMuestras)
    return [`Con muestreo por norma se controlan ${nMuestras} unidad(es); hay ${sel} seleccionada(s).`];
  return [];
}

/* ---------------------------------------------------- resultados e IVC --- */

export interface PruebaRegistrada {
  sistema: string;
  resultado: string | null;
}

/** Resultado por sistema controlado: no cumple si alguna prueba no cumple; pendiente si falta alguna. */
export function resultadoPorSistema(pruebas: PruebaRegistrada[]): { sistema: string; resultado: "cumple" | "no_cumple" | "pendiente"; pruebas: number }[] {
  const grupos = new Map<string, PruebaRegistrada[]>();
  for (const p of pruebas) grupos.set(p.sistema, [...(grupos.get(p.sistema) ?? []), p]);
  return [...grupos.entries()].map(([sistema, ps]) => ({
    sistema,
    pruebas: ps.length,
    resultado: ps.some((p) => p.resultado === "no_cumple") ? "no_cumple" : ps.some((p) => !p.resultado) ? "pendiente" : "cumple",
  }));
}

/** Grado de cumplimiento que propone el LIMS (null si faltan pruebas por registrar). */
export function gradoPropuesto(pruebas: PruebaRegistrada[]): "cumple" | "no_cumple" | null {
  if (!pruebas.length) return null;
  if (pruebas.some((p) => p.resultado === "no_cumple")) return "no_cumple";
  if (pruebas.some((p) => !p.resultado)) return null;
  return "cumple";
}

/** Errores al emitir el IVC (grado de cumplimiento). */
export function erroresIvc(
  d: { grado?: string | null; conclusion?: string | null },
  pruebas: PruebaRegistrada[],
  adjuntos: { hoja_control: number; ivc: number },
): string[] {
  const e: string[] = [];
  if (!pruebas.length) e.push("Seleccione las pruebas del protocolo antes del IVC.");
  const faltan = pruebas.filter((p) => !p.resultado).length;
  if (faltan) e.push(`Faltan ${faltan} prueba(s) por registrar en la lista de chequeo.`);
  if (d.grado !== "cumple" && d.grado !== "no_cumple") e.push("Indique el grado de cumplimiento: cumple o no cumple.");
  if (d.grado === "cumple" && pruebas.some((p) => p.resultado === "no_cumple"))
    e.push("Hay pruebas que no cumplen: el grado de cumplimiento no puede ser «cumple».");
  if (!adjuntos.hoja_control) e.push("Adjunte la hoja de control de pruebas.");
  if (!adjuntos.ivc) e.push("Adjunte el informe de verificación de calidad (IVC).");
  return e;
}

/* ----------------------------------------------------------------- pasos --- */

export interface HechosTerreno {
  abierto: boolean;
  analistas: number;
  pruebas: number;
  registradas: number;
  adjuntos: { protocolo: number; hoja_control: number; ivc: number };
  ivcGrado: string | null;
  cerrado: boolean;
}

export type EstadoPasoTerreno = "hecho" | "en_curso" | "pendiente";
export interface PasoTerreno {
  clave: string;
  titulo: string;
  boton: string;
  leToca: string;
  estado: EstadoPasoTerreno;
  detalle: string;
}

/** Pasos del trabajo en terreno; un paso solo cuenta como hecho si los anteriores lo están. */
export function pasosTerreno(h: HechosTerreno): { pasos: PasoTerreno[]; actual: number; completo: boolean } {
  const p = (clave: string, titulo: string, boton: string, leToca: string, hecho: boolean, enCurso: boolean, detalle: string): PasoTerreno => ({
    clave,
    titulo,
    boton,
    leToca,
    estado: hecho ? "hecho" : enCurso ? "en_curso" : "pendiente",
    detalle,
  });
  const chequeoHecho = h.pruebas > 0 && h.registradas === h.pruebas && h.adjuntos.hoja_control > 0;
  const pasos = [
    p("apertura", "Apertura en terreno", "Abrir → asignar", "Jefe de laboratorio", h.abierto, false, h.abierto ? "Abierta" : "Lugar, fechas y tipo de control"),
    p("asignacion", "Asignación de analistas", "Asignar → pruebas", "Jefe de laboratorio", h.analistas > 0, false, h.analistas ? `${h.analistas} analista(s)` : "Sin asignar"),
    p("pruebas", "Pruebas del protocolo", "Elegir pruebas → lista de chequeo", "Analista", h.pruebas > 0, false, h.pruebas ? `${h.pruebas} prueba(s)` : "Según el protocolo de recepción"),
    p("chequeo", "Lista de chequeo", "Registrar → IVC", "Analista", chequeoHecho, h.registradas > 0,
      `${h.registradas} de ${h.pruebas} registradas${h.adjuntos.hoja_control ? " · hoja de control adjunta" : " · falta la hoja de control"}`),
    p("ivc", "Informe de verificación de calidad (IVC)", "Emitir IVC → cierre", "Jefe de laboratorio", Boolean(h.ivcGrado) && h.adjuntos.ivc > 0, h.adjuntos.ivc > 0,
      h.ivcGrado ? (h.ivcGrado === "cumple" ? "Cumple" : "No cumple") : "Grado de cumplimiento"),
    p("cierre", "Cierre del trabajo en terreno", "Cerrar → informe y cierre de la OT", "Jefe de laboratorio", h.cerrado, false, h.cerrado ? "Cerrado" : "Resultado por sistema"),
  ];
  let corte = pasos.findIndex((x) => x.estado !== "hecho");
  if (corte < 0) corte = pasos.length;
  pasos.forEach((x, i) => {
    if (i > corte && x.estado === "hecho") x.estado = "en_curso";
  });
  return { pasos, actual: Math.min(corte, pasos.length - 1) + 1, completo: corte === pasos.length };
}

/** ¿El laboratorio trabaja en terreno? (parámetro terreno.laboratorios, «SVM,LAM,SEO» por defecto). */
export function laboratorioDeTerreno(valor: string | null | undefined, laboratorio: string | null | undefined): boolean {
  if (!laboratorio) return false;
  const lista = (valor ?? "SVM,LAM,SEO").split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  return lista.includes(laboratorio.toUpperCase());
}

/* ------------------------------------------- informe de la OT (F083) --- */

/** Estado del trabajo en terreno para emitir el informe de la OT. */
export interface TerrenoParaInforme {
  cerrado: boolean;
  ivcGrado: string | null;
}

/**
 * F083 · Una OT en terreno no tiene resultados de la captura normal: sus resultados
 * son los del trabajo en terreno (lista de chequeo e IVC). Lo que falta para emitir
 * el informe con ellos (lista vacía = se puede). null = la OT no trabaja en terreno.
 */
export function faltantesInformeTerreno(t: TerrenoParaInforme | null | undefined): string[] | null {
  if (!t) return null;
  const f: string[] = [];
  if (!t.ivcGrado) f.push("Emita primero el IVC del trabajo en terreno con su grado de cumplimiento (pestaña «Terreno»).");
  if (!t.cerrado) f.push("Cierre primero el trabajo en terreno (pestaña «Terreno» › «Cerrar el trabajo en terreno»).");
  return f;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const TEXTO_RESULTADO: Record<string, string> = { cumple: "Cumple", no_cumple: "No cumple", no_aplica: "No aplica", pendiente: "Pendiente" };

/**
 * F083 · Tabla de resultados del informe de una OT en terreno: grado de cumplimiento
 * del IVC, resultado por sistema controlado y cada prueba de la lista de chequeo.
 */
export function bloqueResultadosTerreno(d: {
  lugar?: string | null;
  ivcNumero?: string | null;
  ivcGrado: string | null;
  conclusion?: string | null;
  pruebas: { sistema: string; prueba: string; requisito?: string | null; resultado: string | null; observacion?: string | null; unidad?: string | null }[];
}): string {
  const clase = (r: string | null | undefined) => (r === "cumple" ? "ok" : r === "no_cumple" ? "no" : "");
  const sistemas = resultadoPorSistema(d.pruebas.map((p) => ({ sistema: p.sistema, resultado: p.resultado })));
  const conUnidad = d.pruebas.some((p) => p.unidad);
  const cab =
    `<p><b>Trabajo en terreno</b>${d.lugar ? ` · ${esc(d.lugar)}` : ""}${d.ivcNumero ? ` · IVC N° ${esc(d.ivcNumero)}` : ""}. ` +
    `Grado de cumplimiento: <b>${esc(TEXTO_RESULTADO[d.ivcGrado ?? ""] ?? "Sin IVC")}</b>.</p>`;
  const porSistema =
    `<table class="rep"><thead><tr><th>Sistema controlado</th><th class="num">Pruebas</th><th>Resultado</th></tr></thead><tbody>` +
    sistemas.map((s) => `<tr><td>${esc(s.sistema)}</td><td class="num">${s.pruebas}</td><td class="${clase(s.resultado)}">${esc(TEXTO_RESULTADO[s.resultado])}</td></tr>`).join("") +
    `</tbody></table>`;
  const detalle = d.pruebas.length
    ? `<table class="rep"><thead><tr><th>Sistema</th>${conUnidad ? "<th>Unidad</th>" : ""}<th>Prueba</th><th>Requisito</th><th>Resultado</th><th>Observación</th></tr></thead><tbody>` +
      d.pruebas
        .map(
          (p) =>
            `<tr><td>${esc(p.sistema)}</td>${conUnidad ? `<td>${esc(p.unidad ?? "—")}</td>` : ""}<td>${esc(p.prueba)}</td><td>${esc(p.requisito || "—")}</td>` +
            `<td class="${clase(p.resultado)}">${esc(TEXTO_RESULTADO[p.resultado ?? "pendiente"] ?? p.resultado)}</td><td>${esc(p.observacion || "—")}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`
    : `<table class="rep"><tbody><tr><td class="vacio">Sin pruebas registradas en el trabajo en terreno.</td></tr></tbody></table>`;
  const concl = d.conclusion ? `<p>${esc(d.conclusion)}</p>` : "";
  return cab + porSistema + detalle + concl;
}
