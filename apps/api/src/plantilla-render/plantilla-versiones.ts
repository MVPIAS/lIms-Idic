/**
 * Repositorio de plantillas con versiones · reglas PURAS (probadas en
 * plantilla-versiones.spec.ts). DDL: packages/db/align_plantilla_versiones.sql.
 *
 *  · Editar nunca pisa la versión VIGENTE: escribe en el BORRADOR (uno por
 *    plantilla), que se crea copiando la vigente.
 *  · Aprobar el borrador lo deja VIGENTE y la anterior RETIRADA (se conserva).
 *  · Segregación: quien redactó o modificó el borrador no lo aprueba.
 *  · Volver a una versión anterior = nuevo borrador copia de aquella.
 *  · El cuerpo y el formato (config_informe) se versionan JUNTOS.
 */

export const ESTADOS_VERSION = ["BORRADOR", "VIGENTE", "RETIRADA"] as const;
export type EstadoVersion = (typeof ESTADOS_VERSION)[number];

export interface VersionMin {
  estado: string;
  creadoPor: string | null;
  /** Todos los que escribieron el borrador. */
  editores: string[] | null;
}

/** Por qué `usuarioId` no puede aprobar el borrador (null = puede). */
export function motivoNoAprobable(v: VersionMin, usuarioId: string | null | undefined): { codigo: 403 | 409; mensaje: string } | null {
  if (v.estado !== "BORRADOR") return { codigo: 409, mensaje: `Solo se aprueba un borrador (esta versión está ${v.estado}).` };
  if (!usuarioId) return { codigo: 403, mensaje: "No se pudo identificar a quien aprueba." };
  if (usuarioId === v.creadoPor || (v.editores ?? []).includes(usuarioId))
    return { codigo: 403, mensaje: "Quien redacta o modifica un borrador no puede aprobarlo: debe aprobarlo otra persona." };
  return null;
}

/** Por qué no se puede editar o descartar la versión (null = se puede). */
export function motivoNoEditable(v: { estado: string }): string | null {
  return v.estado === "BORRADOR" ? null : `La versión ${v.estado.toLowerCase()} no se edita: cree un borrador.`;
}

/* --------------------------------------------------------------- variables --- */

/**
 * Bloques HTML que genera el motor (`{{nombre}}` en el cuerpo). Lista fija de los
 * que arma `PlantillaRenderService.render`; los módulos pueden añadir otros
 * (SAEC, BPCH…), que aparecen al consultar las variables con una OT concreta.
 */
export const BLOQUES_MOTOR: Record<string, string> = {
  tabla_resultados: "Tabla de resultados según el formato de la plantilla",
  tabla_muestras: "Tabla de muestras de la OT",
  referencias: "Normas y métodos citados",
  anexo_fotografico: "Fotos de la OT marcadas para el informe",
  conclusion: "Conclusión con título",
  conclusion_texto: "Conclusión sin título",
  producto_terminado: "Verificación del producto terminado (IVC)",
  portada: "Portada del IVC",
  tabla_inspeccion: "Tabla de inspección (mínimo, máximo, resultado, condición)",
  tabla_metodos: "Métodos usados",
  termograma: "Termogramas de la OT",
  identificacion_muestras: "Identificación de las muestras",
};

/**
 * Rutas `a.b.c` de un objeto de datos, para la lista de variables del editor.
 * Las hojas son escalares, fechas o arrays (no se recorren). Profundidad máxima
 * 4; ignora claves vetadas del motor.
 */
export function aplanarVariables(obj: unknown, prefijo = "", profundidad = 0, salida: string[] = []): string[] {
  if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj) || obj instanceof Date) {
    if (prefijo) salida.push(prefijo);
    return salida;
  }
  const claves = Object.keys(obj as Record<string, unknown>);
  if (profundidad >= 4 || claves.length === 0) {
    if (prefijo) salida.push(prefijo);
    return salida;
  }
  for (const k of claves) {
    if (k === "__proto__" || k === "constructor" || k === "prototype" || !/^[A-Za-z0-9_]+$/.test(k)) continue;
    aplanarVariables((obj as Record<string, unknown>)[k], prefijo ? `${prefijo}.${k}` : k, profundidad + 1, salida);
  }
  return salida;
}

/* ----------------------------------------------------------------- comparar --- */

export type LineaDiff = { tipo: "igual" | "quitada" | "agregada"; texto: string };

/**
 * Diferencia por líneas (LCS) entre dos textos. Para cuerpos muy largos
 * (más de 4.000 líneas por lado) devuelve un diff burdo: todo quitado y agregado.
 */
export function diffLineas(a: string | null | undefined, b: string | null | undefined): LineaDiff[] {
  const x = (a ?? "").split(/\r?\n/);
  const y = (b ?? "").split(/\r?\n/);
  if (x.length > 4000 || y.length > 4000)
    return [...x.map((t) => ({ tipo: "quitada" as const, texto: t })), ...y.map((t) => ({ tipo: "agregada" as const, texto: t }))];
  const n = x.length;
  const m = y.length;
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const r: LineaDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      r.push({ tipo: "igual", texto: x[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) r.push({ tipo: "quitada", texto: x[i++] });
    else r.push({ tipo: "agregada", texto: y[j++] });
  }
  while (i < n) r.push({ tipo: "quitada", texto: x[i++] });
  while (j < m) r.push({ tipo: "agregada", texto: y[j++] });
  return r;
}
