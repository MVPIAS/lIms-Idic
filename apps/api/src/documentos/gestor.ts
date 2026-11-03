/**
 * Gestor documental · reglas puras (contrato §4.6.1–§4.6.3), probadas en
 * gestor.spec.ts: tipos de archivo admitidos con su firma real, árbol de
 * carpetas con ruta y unidad heredada, y detección de ciclos al mover.
 */

export const MAX_DOCUMENTO_BYTES = 20 * 1024 * 1024;

/** Tipos admitidos: extensión → MIME y firma de los primeros bytes (hex). */
const TIPOS: Record<string, { mime: string; firma: string[] | "texto" }> = {
  pdf: { mime: "application/pdf", firma: ["25504446"] },
  png: { mime: "image/png", firma: ["89504e47"] },
  jpg: { mime: "image/jpeg", firma: ["ffd8ff"] },
  jpeg: { mime: "image/jpeg", firma: ["ffd8ff"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", firma: ["504b0304"] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", firma: ["504b0304"] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", firma: ["504b0304"] },
  doc: { mime: "application/msword", firma: ["d0cf11e0"] },
  xls: { mime: "application/vnd.ms-excel", firma: ["d0cf11e0"] },
  txt: { mime: "text/plain; charset=utf-8", firma: "texto" },
  csv: { mime: "text/csv; charset=utf-8", firma: "texto" },
};

export const EXTENSIONES_ADMITIDAS = Object.keys(TIPOS);

/** Nombre de archivo seguro (letras, números, espacio, punto, guion y guion bajo). */
export function nombreSeguro(nombre: string | undefined): string {
  const n = (nombre ?? "documento").normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/^\.+/, "").slice(0, 200);
  return n || "documento";
}

/**
 * Valida el archivo por extensión Y por contenido (no basta la extensión ni el
 * MIME que manda el navegador). Devuelve el MIME con que se servirá, o un
 * mensaje de error para el usuario.
 */
export function tipoArchivo(nombre: string, datos: Buffer): { mime: string } | { error: string } {
  if (!datos?.length) return { error: "El archivo está vacío." };
  if (datos.length > MAX_DOCUMENTO_BYTES) return { error: "El archivo no puede superar 20 MB." };
  const ext = (nombre.split(".").pop() ?? "").toLowerCase();
  const t = TIPOS[ext];
  if (!t || !nombre.includes(".")) return { error: `Tipo de archivo no admitido. Se admiten: ${EXTENSIONES_ADMITIDAS.join(", ")}.` };
  if (t.firma === "texto") {
    // Texto: sin bytes nulos en los primeros 8 KB.
    if (datos.subarray(0, 8192).includes(0)) return { error: "El contenido no es texto." };
    return { mime: t.mime };
  }
  const cabeza = datos.subarray(0, 4).toString("hex");
  if (!t.firma.some((f) => cabeza.startsWith(f))) return { error: "El contenido del archivo no corresponde a su extensión." };
  return { mime: t.mime };
}

export interface CarpetaFila {
  id: string;
  padreId: string | null;
  nombre: string;
  unidadId: string | null;
}
export interface CarpetaNodo extends CarpetaFila {
  ruta: string;
  nivel: number;
  /** Unidad propia o la heredada del ancestro más cercano que la tenga. */
  unidadEfectiva: string | null;
}

/**
 * Árbol plano ordenado por ruta: cada carpeta con su ruta «A / B / C», su nivel
 * y la unidad efectiva. Una carpeta cuyo padre no existe (borrado o fuera del
 * árbol) se trata como raíz; un ciclo en los datos se corta.
 */
export function arbolCarpetas(filas: CarpetaFila[]): CarpetaNodo[] {
  const por = new Map(filas.map((f) => [f.id, f]));
  const memo = new Map<string, CarpetaNodo>();
  const nodo = (f: CarpetaFila, visto: Set<string>): CarpetaNodo => {
    const m = memo.get(f.id);
    if (m) return m;
    const padre = f.padreId ? por.get(f.padreId) : undefined;
    let n: CarpetaNodo;
    if (!padre || visto.has(padre.id)) {
      n = { ...f, padreId: padre ? f.padreId : null, ruta: f.nombre, nivel: 0, unidadEfectiva: f.unidadId };
    } else {
      visto.add(f.id);
      const p = nodo(padre, visto);
      n = { ...f, ruta: `${p.ruta} / ${f.nombre}`, nivel: p.nivel + 1, unidadEfectiva: f.unidadId ?? p.unidadEfectiva };
    }
    memo.set(f.id, n);
    return n;
  };
  return filas
    .map((f) => nodo(f, new Set([f.id])))
    .sort((a, b) => a.ruta.localeCompare(b.ruta, "es", { sensitivity: "base" }));
}

/** ¿`candidato` es `id` o está debajo de `id`? (para no mover una carpeta dentro de sí misma). */
export function esDescendiente(filas: CarpetaFila[], id: string, candidato: string): boolean {
  const por = new Map(filas.map((f) => [f.id, f]));
  let actual: string | null | undefined = candidato;
  const visto = new Set<string>();
  while (actual && !visto.has(actual)) {
    if (actual === id) return true;
    visto.add(actual);
    actual = por.get(actual)?.padreId;
  }
  return false;
}

/** Ids de la carpeta y todo su subárbol. */
export function subarbol(filas: CarpetaFila[], id: string): string[] {
  return filas.filter((f) => esDescendiente(filas, id, f.id)).map((f) => f.id);
}

/**
 * Qué puede hacer una persona con UN documento que ya ve.
 *   · edita: subir versión, publicar y cambiar título, descripción y vínculos.
 *     La tienen quienes gestionan documentos (si el documento es restringido,
 *     solo el perfil global y quien lo creó) y quien figura en sus permisos con
 *     «Ver y editar», aunque no tenga documento.gestionar.
 *   · administra: además mover de carpeta, cambiar permisos y eliminar. Solo
 *     quien gestiona documentos y edita.
 */
export function derechosDocumento(p: {
  gestiona: boolean;
  global: boolean;
  restringido: boolean;
  esCreador: boolean;
  nivelAcceso: "ver" | "editar" | null;
}): { edita: boolean; administra: boolean } {
  const porGestion = p.gestiona && (p.global || !p.restringido || p.esCreador || p.nivelAcceso === "editar");
  return { edita: porGestion || p.nivelAcceso === "editar", administra: porGestion };
}
