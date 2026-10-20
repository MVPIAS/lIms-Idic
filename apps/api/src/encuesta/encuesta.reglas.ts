/**
 * Encuesta de satisfacción · reglas PURAS (encuesta.reglas.spec.ts).
 * Contrato: docs/FLUJO_COTIZACION_ENCUESTAS.md · EP-00 9.1 con la decisión del
 * usuario del 20-10-2026: toda OT que se cierra genera una encuesta pendiente
 * (trigger en align_cotizacion_circuito.sql); no se publica a internet ni la
 * llena el cliente: Comercial la registra a mano con lo que contesta el cliente.
 *
 * Preguntas por defecto = formulario de evaluación del Sistema Comercial
 * (criterios 01–04, escala 1/3/5/7). Son editables (encuesta_pregunta).
 */

export interface Pregunta {
  codigo: string;
  texto: string;
  escala: number[];
  obligatoria: boolean;
}

export interface RespuestaEntrada {
  codigo: string;
  valor?: number | null;
}

export interface RespuestaGuardada {
  codigo: string;
  texto: string;
  valor: number | null;
  escala: number[];
}

export const ESTADOS_ENCUESTA = ["pendiente", "registrada", "sin_respuesta"] as const;
export const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "Pendiente de registrar",
  registrada: "Registrada",
  sin_respuesta: "Cerrada sin respuesta",
};
export const MEDIOS = ["telefono", "correo", "presencial", "formulario_fisico"] as const;

/**
 * Valida las respuestas contra las preguntas activas y devuelve la copia que se
 * guarda (con el texto de la pregunta) y el promedio de las respondidas.
 */
export function validarRespuestas(
  preguntas: Pregunta[],
  respuestas: RespuestaEntrada[],
): { errores: string[]; guardadas: RespuestaGuardada[]; promedio: number | null } {
  const errores: string[] = [];
  const porCodigo = new Map(respuestas.map((r) => [r.codigo, r.valor]));
  for (const r of respuestas)
    if (!preguntas.some((p) => p.codigo === r.codigo)) errores.push(`La pregunta ${r.codigo} no existe o está desactivada.`);
  const guardadas: RespuestaGuardada[] = preguntas.map((p) => {
    const v = porCodigo.get(p.codigo);
    const valor = v === null || v === undefined ? null : Number(v);
    if (valor === null) {
      if (p.obligatoria) errores.push(`Falta la respuesta de «${p.texto}».`);
    } else if (!p.escala.includes(valor)) {
      errores.push(`«${p.texto}»: la respuesta debe ser una de ${p.escala.join(", ")}.`);
    }
    return { codigo: p.codigo, texto: p.texto, valor, escala: p.escala };
  });
  return { errores, guardadas, promedio: promedioDe(guardadas.map((g) => g.valor)) };
}

/** Promedio con dos decimales de los valores informados (null si no hay ninguno). */
export function promedioDe(valores: (number | null)[]): number | null {
  const v = valores.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
}

/** ¿Se puede registrar o cerrar? Solo una encuesta pendiente. */
export function motivoNoRegistrable(estado: string): string | null {
  if (estado === "pendiente") return null;
  return `La encuesta ya está ${ETIQUETA_ESTADO[estado]?.toLowerCase() ?? estado}: no se vuelve a registrar.`;
}

/** Valida la configuración de una pregunta (pantalla de preguntas). */
export function erroresPregunta(p: { codigo: string; texto: string; escala: number[] }): string[] {
  const e: string[] = [];
  if (!/^[A-Z0-9_]{1,20}$/.test(p.codigo)) e.push(`Código «${p.codigo}»: solo mayúsculas, números y _ (máx. 20).`);
  if (!p.texto.trim()) e.push(`La pregunta ${p.codigo} no tiene texto.`);
  if (p.escala.length < 2) e.push(`La pregunta ${p.codigo} necesita al menos dos valores en la escala.`);
  if (new Set(p.escala).size !== p.escala.length) e.push(`La escala de ${p.codigo} tiene valores repetidos.`);
  return e;
}

/** Reporte por laboratorio: cuántas hay en cada estado y el promedio de las registradas. */
export function reportePorLaboratorio(
  filas: { unidad: string | null; estado: string; promedio: number | null; respuestas: RespuestaGuardada[] | null }[],
) {
  const grupos = new Map<string, typeof filas>();
  for (const f of filas) {
    const k = f.unidad ?? "Sin laboratorio";
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const resumir = (fs: typeof filas) => {
    const reg = fs.filter((f) => f.estado === "registrada");
    const porPregunta = new Map<string, { texto: string; valores: (number | null)[] }>();
    for (const f of reg)
      for (const r of f.respuestas ?? []) {
        const x = porPregunta.get(r.codigo) ?? { texto: r.texto, valores: [] };
        x.valores.push(r.valor);
        porPregunta.set(r.codigo, x);
      }
    return {
      total: fs.length,
      pendientes: fs.filter((f) => f.estado === "pendiente").length,
      registradas: reg.length,
      sinRespuesta: fs.filter((f) => f.estado === "sin_respuesta").length,
      tasaRespuesta: fs.length ? Math.round((reg.length / fs.length) * 1000) / 10 : null,
      promedio: promedioDe(reg.map((f) => (f.promedio === null ? null : Number(f.promedio)))),
      porPregunta: [...porPregunta].map(([codigo, x]) => ({ codigo, texto: x.texto, promedio: promedioDe(x.valores) })).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    };
  };
  return {
    total: resumir(filas),
    laboratorios: [...grupos].map(([unidad, fs]) => ({ unidad, ...resumir(fs) })).sort((a, b) => a.unidad.localeCompare(b.unidad)),
  };
}
