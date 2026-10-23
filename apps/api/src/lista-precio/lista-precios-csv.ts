/**
 * Lista de precios oficial del IDIC (CSV «LISTA DE PRECIO 2026 (COSTOS ENSAYOS)»):
 * lectura, comprobación de la fórmula, centro de costo y enlace con el catálogo.
 * Reglas PURAS (lista-precios-csv.spec.ts). Las usa el generador del seed
 * (scripts/datos/lista-precios-2026/generar-seed.ts), que escribe
 * packages/db/seed_lp26_lista_precios_2026.sql.
 *
 * El CSV viene en Windows-1252, separado por «;», con importes «$329.820» y
 * nombres entre comillas que pueden llevar «;» o saltos de línea: se lee con un
 * lector CSV que respeta las comillas, nunca partiendo por líneas.
 */
import { cuadraConFormula, desdeCostoDirecto, desdePrecioParticular, diferencias, type Estructura, type PctEstructura, PCT_OFICIAL_2026 } from "../cotizacion/estructura-precio";

/* ------------------------------------------------------------- lector CSV --- */

/** Lector CSV (RFC 4180) con separador configurable: comillas dobles, «""» escapada, saltos de línea dentro de comillas. */
export function leerCsv(texto: string, sep = ";"): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  let i = 0;
  if (texto.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  // Líneas totalmente vacías (p. ej. al final del fichero) no son filas.
  return filas.filter((f) => !(f.length === 1 && f[0].trim() === ""));
}

/** Decodifica el CSV del IDIC (Windows-1252). */
export function decodificarCp1252(buf: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(buf);
}

/** «$1.186.651» → 1186651. Vacío o ilegible → null. */
export function monto(s: string | null | undefined): number | null {
  const t = String(s ?? "").replace(/[$\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** «EN 1238 », «en1238» → «EN1238» (los códigos del catálogo van sin espacios). */
export const normalizarCodigo = (s: string) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

/** Texto de la planilla: sin espacios repetidos ni saltos de línea. */
export const limpiarTexto = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Valor de error de Excel (#N/D, #N/A, #¡REF!…): no es un dato. */
export const esErrorExcel = (s: string) => /^#(N\/[DA]|¡?REF!|¡?VALOR!|VALUE!|DIV\/0!|NOMBRE\?|NAME\?)$/i.test(limpiarTexto(s));

export interface FilaLista {
  /** Nº de fila de datos (1 = la primera después del encabezado). */
  n: number;
  codigoOriginal: string;
  codigo: string;
  nombre: string | null;
  centro: string | null;
  centroOriginal: string;
  importes: Estructura;
  /** Fallos de lectura de la fila (columnas que faltan o importes ilegibles). */
  errores: string[];
}

export const COLUMNAS_CSV = 10;

/**
 * Filas de datos del CSV. No descarta nada: lo que no se puede leer queda con
 * sus `errores` para el informe.
 */
export function leerListaPrecios(texto: string): { encabezado: string[]; filas: FilaLista[] } {
  const [encabezado = [], ...datos] = leerCsv(texto, ";");
  const filas = datos.map((r, idx): FilaLista => {
    const errores: string[] = [];
    if (r.length !== COLUMNAS_CSV) errores.push(`tiene ${r.length} columnas (se esperaban ${COLUMNAS_CSV})`);
    const m = r.slice(3, 10).map(monto);
    const nombres = ["costo directo", "costo indirecto", "costo total", "recargo", "neto", "IVA", "precio particular"];
    m.forEach((v, i) => {
      if (v == null) errores.push(`importe ilegible en «${nombres[i]}» (${JSON.stringify(r[3 + i] ?? "")})`);
    });
    const v = (i: number) => m[i] ?? 0;
    const codigo = normalizarCodigo(r[0] ?? "");
    if (!codigo) errores.push("sin código");
    const nombre = limpiarTexto(r[1] ?? "");
    const centro = limpiarTexto(r[2] ?? "");
    return {
      n: idx + 1,
      codigoOriginal: r[0] ?? "",
      codigo,
      nombre: nombre && !esErrorExcel(nombre) ? nombre : null,
      centro: centro && !esErrorExcel(centro) ? centro.toUpperCase() : null,
      centroOriginal: centro,
      importes: {
        costoDirecto: v(0),
        costoIndirecto: v(1),
        costoTotal: v(2),
        recargo: v(3),
        neto: v(4),
        iva: v(5),
        precioIvaIncluido: v(6),
      },
      errores,
    };
  });
  return { encabezado: encabezado.map(limpiarTexto), filas };
}

/* --------------------------------------------------------- comprobaciones --- */

export interface ComprobacionFormula {
  /** Los siete importes salen de un costo directo real con la fórmula (redondeo al peso). */
  cuadra: boolean;
  /** Recalculada desde el precio particular (como se armó la lista): coincide en todo. */
  exactaDesdePrecio: boolean;
  /** Recalculada desde el costo directo entero que se ve: diferencias por columna (± 1 peso por los decimales ocultos). */
  difDesdeCostoDirecto: Partial<Record<keyof Estructura, number>>;
}

export function comprobarFormula(f: FilaLista, p: PctEstructura = PCT_OFICIAL_2026): ComprobacionFormula {
  const e = f.importes;
  return {
    cuadra: cuadraConFormula(e, p),
    exactaDesdePrecio: Object.keys(diferencias(e, desdePrecioParticular(e.precioIvaIncluido, p))).length === 0,
    difDesdeCostoDirecto: diferencias(e, desdeCostoDirecto(e.costoDirecto, p)),
  };
}

/* ------------------------------------------------------ centros de costo --- */

export type Confianza = "exacta" | "alias_por_confirmar" | "sin_centro";

export interface DestinoCentro {
  /** centro_costo.codigo (null: no existe en el LIMS). */
  centroCosto: string | null;
  /** unidad.codigo. */
  unidad: string | null;
  /** Familias del catálogo (cat_familia.codsucdel) en que se busca el ensayo por nombre. */
  familias: string[];
  confianza: Confianza;
  nota: string;
}

/**
 * Centro de costo del CSV → centro de costo y unidad del LIMS. Los alias y los
 * centros que no existen van «por confirmar» en el informe de la carga.
 */
export const CENTROS: Record<string, DestinoCentro> = {
  LPN: { centroCosto: "LPN-001", unidad: "LPN", familias: ["7004"], confianza: "exacta", nota: "Laboratorio de Pinturas" },
  LTX: { centroCosto: "LTX-001", unidad: "LTX", familias: ["7011"], confianza: "exacta", nota: "Laboratorio Textil" },
  LMT: { centroCosto: "LMT-001", unidad: "LMT", familias: ["400450130", "400450140", "400450120"], confianza: "exacta", nota: "Laboratorio de Metrología (las calibraciones del área eléctrica van a LMT · Área Eléctrica)" },
  LQC: { centroCosto: "LQC-001", unidad: "LQC", familias: ["7003"], confianza: "exacta", nota: "Laboratorio Químico Central" },
  LCC: { centroCosto: "LCC-001", unidad: "LCC", familias: ["7006"], confianza: "exacta", nota: "Laboratorio de Cuero y Calzado" },
  LME: { centroCosto: "LME-001", unidad: "LME", familias: ["7005"], confianza: "exacta", nota: "Laboratorio de Material Energético" },
  LEM: { centroCosto: "LEM-001", unidad: "LEM", familias: ["4006", "4003", "4004"], confianza: "exacta", nota: "Laboratorio de Ensayos Mecánicos (incluye Metalografía y END, cuyos métodos son LEM-PG01)" },
  LRB: { centroCosto: "LRB-001", unidad: "LRB", familias: ["4009"], confianza: "exacta", nota: "Laboratorio de Resistencia Balística" },
  LES: { centroCosto: "LES-001", unidad: "LES", familias: ["7008", "7012"], confianza: "exacta", nota: "Laboratorio de Evaluación Sensorial" },
  LCNF: { centroCosto: "LNF-001", unidad: "LNF", familias: ["400450150"], confianza: "exacta", nota: "Laboratorio Custodio de Patrones Nacionales de Fuerza (LNF)" },
  LVM: { centroCosto: "SVM-001", unidad: "SVM", familias: ["4007"], confianza: "alias_por_confirmar", nota: "LVM (Vehículos Motorizados) se asocia a SVM · Laboratorio de Vehículos Militares" },
  LMI: { centroCosto: "LMB-001", unidad: "LMB", familias: ["7010"], confianza: "alias_por_confirmar", nota: "LMI se asocia a LMB · Laboratorio de Microbiología" },
  CDOSECALI: { centroCosto: null, unidad: "SAL", familias: ["7007", "7008", "7009", "7010", "7012"], confianza: "sin_centro", nota: "No hay centro de costo CDOSECALI: se asocia a la unidad SAL · Sección Alimentos" },
  CDOSECAYM: { centroCosto: null, unidad: "DSA", familias: ["4008"], confianza: "sin_centro", nota: "No hay centro de costo CDOSECAYM: se asocia a la unidad DSA · Departamento Armamento y Munición" },
  DCO: { centroCosto: null, unidad: "DCO", familias: [], confianza: "sin_centro", nota: "No hay centro de costo DCO: se asocia a la unidad DCO · Departamento Comercial" },
  SMU: { centroCosto: null, unidad: "MUE", familias: [], confianza: "sin_centro", nota: "No hay centro de costo SMU: se asocia a la unidad MUE · Sección Muestreo" },
};

export function destinoCentro(centro: string | null): DestinoCentro {
  if (centro && CENTROS[centro]) return CENTROS[centro];
  return { centroCosto: null, unidad: null, familias: [], confianza: "sin_centro", nota: centro ? `Centro «${centro}» desconocido` : "Sin centro de costo en la lista (#N/D)" };
}

/* ------------------------------------------------- enlace con el catálogo --- */

/** Clave de comparación: minúsculas, sin tildes, solo letras y dígitos separados por un espacio. */
export const normalizarNombre = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Nombre sin el calificador de método o norma («Humedad NORMA BPCH» → «humedad»,
 * «Microdureza Vickers. Método LEM-…» → «microdureza vickers»). Null si no lo hay.
 */
export function nombreBase(s: string): string | null {
  const m = /^(.*?)[\s.,;:(]*\b(m[eé]todo|metodo|norma)\b/i.exec(String(s ?? "").normalize("NFC"));
  if (!m) return null;
  const b = normalizarNombre(m[1]);
  return b || null;
}

export interface EnsayoCatalogo {
  codigo: string;
  nombre: string;
  /** cat_familia.codsucdel del ensayo. */
  familia: string | null;
  agrupado: string | null;
}

export type TipoEnlace = "codigo" | "nombre" | "nombre_base";

export interface Enlace {
  catalogo: string | null;
  tipo: TipoEnlace | null;
  motivo: string;
}

/**
 * Enlace de cada fila con un ensayo del catálogo, solo si es SEGURO:
 *  1. mismo código EN en el catálogo;
 *  2. si no, mismo nombre (normalizado) entre los ensayos de las familias del
 *     laboratorio, con un único candidato;
 *  3. si no, el nombre sin el calificador de método o norma, con un único candidato.
 * Un ensayo del catálogo solo se enlaza con UNA fila: si dos filas lo reclaman,
 * ninguna se enlaza (ambiguo) y van al informe.
 */
export function enlazar(filas: FilaLista[], catalogo: EnsayoCatalogo[]): Map<number, Enlace> {
  const porCodigo = new Map(catalogo.map((c) => [normalizarCodigo(c.codigo), c]));
  const usados = new Set<string>();
  const res = new Map<number, Enlace>();
  const propuestas = new Map<number, { cat: EnsayoCatalogo; tipo: TipoEnlace }>();

  for (const f of filas) {
    const c = porCodigo.get(f.codigo);
    if (c) {
      res.set(f.n, { catalogo: c.codigo, tipo: "codigo", motivo: "mismo código EN en el catálogo" });
      usados.add(c.codigo);
    }
  }
  const porFamilia = new Map<string, EnsayoCatalogo[]>();
  for (const c of catalogo) {
    if (!c.familia) continue;
    const xs = porFamilia.get(c.familia) ?? [];
    xs.push(c);
    porFamilia.set(c.familia, xs);
  }
  for (const f of filas) {
    if (res.has(f.n)) continue;
    const d = destinoCentro(f.centro);
    if (!f.nombre) {
      res.set(f.n, { catalogo: null, tipo: null, motivo: "la fila no tiene nombre (#N/D)" });
      continue;
    }
    if (!d.familias.length) {
      res.set(f.n, { catalogo: null, tipo: null, motivo: "el centro de costo no corresponde a un laboratorio del catálogo" });
      continue;
    }
    const cands = d.familias.flatMap((fa) => porFamilia.get(fa) ?? []).filter((c) => !usados.has(c.codigo));
    const clave = normalizarNombre(f.nombre);
    const exactos = cands.filter((c) => normalizarNombre(c.nombre) === clave);
    if (exactos.length === 1) {
      propuestas.set(f.n, { cat: exactos[0], tipo: "nombre" });
      continue;
    }
    if (exactos.length > 1) {
      res.set(f.n, { catalogo: null, tipo: null, motivo: `${exactos.length} ensayos del laboratorio con el mismo nombre` });
      continue;
    }
    const base = nombreBase(f.nombre);
    const bases = base ? cands.filter((c) => normalizarNombre(c.nombre) === base) : [];
    if (bases.length === 1) propuestas.set(f.n, { cat: bases[0], tipo: "nombre_base" });
    else
      res.set(f.n, {
        catalogo: null,
        tipo: null,
        motivo: bases.length > 1 ? `${bases.length} ensayos del laboratorio con el nombre «${base}»` : "sin ensayo del catálogo con ese código ni con ese nombre en el laboratorio",
      });
  }
  // Un ensayo del catálogo reclamado por varias filas no se enlaza con ninguna.
  const reclamos = new Map<string, number>();
  for (const p of propuestas.values()) reclamos.set(p.cat.codigo, (reclamos.get(p.cat.codigo) ?? 0) + 1);
  for (const [n, p] of propuestas) {
    const k = reclamos.get(p.cat.codigo) ?? 0;
    if (k > 1) res.set(n, { catalogo: null, tipo: null, motivo: `ambiguo: ${k} filas de la lista coinciden con el ensayo ${p.cat.codigo} «${p.cat.nombre}»` });
    else res.set(n, { catalogo: p.cat.codigo, tipo: p.tipo, motivo: p.tipo === "nombre" ? `mismo nombre en el laboratorio («${p.cat.nombre}»)` : `mismo nombre sin el método o la norma («${p.cat.nombre}»)` });
  }
  return res;
}

/* ------------------------------------------------------- filas duplicadas --- */

/** Primera aparición de cada código; las repeticiones no se cargan (van al informe). */
export function separarDuplicados(filas: FilaLista[]): { unicas: FilaLista[]; duplicadas: FilaLista[] } {
  const vistos = new Set<string>();
  const unicas: FilaLista[] = [];
  const duplicadas: FilaLista[] = [];
  for (const f of filas) {
    if (vistos.has(f.codigo)) duplicadas.push(f);
    else {
      vistos.add(f.codigo);
      unicas.push(f);
    }
  }
  return { unicas, duplicadas };
}
