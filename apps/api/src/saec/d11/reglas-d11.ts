/**
 * Delegación Nº 11 · certificación de armas internadas (EP-11, camino A).
 * Reglas PURAS (sin BD), probadas en reglas-d11.spec.ts. Contrato:
 * docs/FLUJO_D11_ARMAS.md.
 *
 *   11.1  listado de armas de la resolución (carga masiva)
 *   11.4  programar la recepción · 11.5 aviso de llegada · 11.6 acta y conteo
 *   11.8  registro de cada arma como muestra de la OT · 11.9 verificación
 *   11.11 clasificación IT05 · 11.12 camino CIP / prueba completa
 *   11.15 / 11.20 captura sin valores por defecto (BL-038)
 *   11.22 acuñación IT08 · 11.23 certificado por arma (vigencia) · 11.27 entrega
 */

/* ======================================================================== */
/* Datos del arma                                                            */
/* ======================================================================== */

export const TIPOS_ARMA = ["pistola", "revolver", "fusil", "carabina", "subfusil", "escopeta", "hechiza", "otro"] as const;
export type TipoArma = (typeof TIPOS_ARMA)[number];
export const NOMBRE_TIPO_ARMA: Record<TipoArma, string> = {
  pistola: "Pistola",
  revolver: "Revólver",
  fusil: "Fusil",
  carabina: "Carabina",
  subfusil: "Subfusil",
  escopeta: "Escopeta",
  hechiza: "Hechiza",
  otro: "Otro",
};

export const CLASES = ["arma", "accesorio", "maquina_recargadora"] as const;
export type Clase = (typeof CLASES)[number];
export const NOMBRE_CLASE: Record<Clase, string> = { arma: "Arma", accesorio: "Accesorio", maquina_recargadora: "Máquina recargadora" };

export const CAMINOS = ["cip", "completa"] as const;
export type Camino = (typeof CAMINOS)[number] | "directo";
export const NOMBRE_CAMINO: Record<Camino, string> = {
  cip: "Con cuño CIP · reconocimiento",
  completa: "Sin cuño CIP · prueba completa",
  directo: "Directo al certificado",
};

/** Serie normalizada (EP-11 §5): mayúsculas, solo A–Z y 0–9. Vacía → null. */
export function normalizarSerie(s: string | null | undefined): string | null {
  const n = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return n || null;
}

/**
 * Serie parcialmente oculta para vistas públicas (verificación del certificado):
 * se ocultan los últimos caracteres (al menos 2, un tercio en series largas).
 */
export function enmascararSerie(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!t) return "—";
  if (t.length <= 3) return `${t[0]}··`;
  const ocultos = Math.max(2, Math.floor(t.length / 3));
  return `${t.slice(0, t.length - ocultos)}··`;
}

/** Texto comparable: sin tildes, en mayúsculas, sin espacios repetidos. */
export function comparable(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ======================================================================== */
/* 11.1 / 11.8 · Carga masiva desde la planilla del importador               */
/* ======================================================================== */

export type CampoPlanilla = "tipo" | "marca" | "modelo" | "calibre" | "serie" | "accesorios" | "cantidad" | "pais" | "lote";

/** Cómo se reconoce cada columna en la cabecera (sin tildes, en minúsculas). */
const ALIAS: Record<CampoPlanilla, RegExp> = {
  tipo: /^(tipo|tipo de arma|clase de arma|arma)$/,
  marca: /^(marca|fabricante)$/,
  modelo: /^modelo$/,
  calibre: /^calibre$/,
  serie: /^(serie|n[ºo°]? ?(de )?serie|numero de serie|nro\.? (de )?serie|n serie)$/,
  accesorios: /^(accesorios?|observaciones de accesorios)$/,
  cantidad: /^(cantidad|cant\.?|unidades)$/,
  pais: /^(pais|pais de origen|origen|procedencia)$/,
  lote: /^lote$/,
};

export interface FilaPlanilla {
  fila: number;
  tipo: TipoArma | null;
  tipoTexto: string;
  marca: string;
  modelo: string;
  calibre: string;
  serie: string;
  accesorios: string;
  cantidad: number;
  pais: string;
  lote: string;
}

function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Tipo de arma desde el texto del importador («Pistola», «REVOLVER», «revólver 38»…). */
export function tipoDesdeTexto(t: string): TipoArma | null {
  const s = sinTildes(t);
  if (!s) return null;
  return (TIPOS_ARMA as readonly string[]).find((x) => s === x || s.startsWith(`${x} `)) as TipoArma | undefined ?? null;
}

/**
 * Convierte las filas de la planilla (primera = cabecera) en armas. Columnas
 * obligatorias: tipo y marca. Las filas con error no se descartan en silencio:
 * vuelven en `errores` con su número de fila.
 */
export function mapearPlanilla(filas: string[][]): { filas: FilaPlanilla[]; errores: string[]; columnas: CampoPlanilla[] } {
  if (!filas.length) return { filas: [], errores: ["La planilla está vacía."], columnas: [] };
  const cabecera = filas[0].map(sinTildes);
  const idx = {} as Partial<Record<CampoPlanilla, number>>;
  for (const campo of Object.keys(ALIAS) as CampoPlanilla[]) {
    const i = cabecera.findIndex((c) => ALIAS[campo].test(c));
    if (i >= 0) idx[campo] = i;
  }
  const columnas = (Object.keys(idx) as CampoPlanilla[]).sort((a, b) => idx[a]! - idx[b]!);
  const faltan = (["tipo", "marca"] as CampoPlanilla[]).filter((c) => idx[c] === undefined);
  if (faltan.length)
    return {
      filas: [],
      errores: [`La primera fila debe ser la cabecera, con al menos las columnas ${faltan.map((f) => `«${f}»`).join(" y ")} (y si las tiene: modelo, calibre, serie, accesorios, cantidad, país, lote).`],
      columnas,
    };
  const valor = (f: string[], c: CampoPlanilla) => (idx[c] === undefined ? "" : (f[idx[c]!] ?? "").trim());
  const out: FilaPlanilla[] = [];
  const errores: string[] = [];
  filas.slice(1).forEach((f, i) => {
    const n = i + 2;
    const tipoTexto = valor(f, "tipo");
    const tipo = tipoDesdeTexto(tipoTexto);
    const marca = valor(f, "marca");
    const cantTexto = valor(f, "cantidad");
    const cantidad = cantTexto ? Number(cantTexto.replace(",", ".")) : 1;
    const e: string[] = [];
    if (!tipo) e.push(tipoTexto ? `tipo «${tipoTexto}» no reconocido (${TIPOS_ARMA.join(", ")})` : "falta el tipo");
    if (!marca) e.push("falta la marca");
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10_000) e.push(`cantidad «${cantTexto}» no válida`);
    const serie = valor(f, "serie");
    if (serie && cantidad > 1) e.push("una fila con nº de serie es un arma: la cantidad debe ser 1");
    if (e.length) {
      errores.push(`Fila ${n}: ${e.join("; ")}.`);
      return;
    }
    out.push({
      fila: n,
      tipo,
      tipoTexto,
      marca,
      modelo: valor(f, "modelo"),
      calibre: valor(f, "calibre"),
      serie,
      accesorios: valor(f, "accesorios"),
      cantidad,
      pais: valor(f, "pais"),
      lote: valor(f, "lote"),
    });
  });
  // Series repetidas dentro de la misma planilla.
  const vistas = new Map<string, number>();
  for (const x of out) {
    const s = normalizarSerie(x.serie);
    if (!s) continue;
    if (vistas.has(s)) errores.push(`Fila ${x.fila}: el nº de serie ${x.serie} se repite (fila ${vistas.get(s)}).`);
    else vistas.set(s, x.fila);
  }
  return { filas: out, errores, columnas };
}

/** Errores del listado de la resolución (11.1) antes de guardarlo. */
export function erroresListado(items: { tipo: string; marca: string; serie?: string | null; cantidad: number }[]): string[] {
  const errores: string[] = [];
  const series = new Map<string, number>();
  items.forEach((it, i) => {
    const n = i + 1;
    if (!(TIPOS_ARMA as readonly string[]).includes(it.tipo)) errores.push(`Arma ${n}: tipo no válido.`);
    if (!it.marca?.trim()) errores.push(`Arma ${n}: indique la marca.`);
    if (!Number.isInteger(it.cantidad) || it.cantidad < 1) errores.push(`Arma ${n}: la cantidad debe ser un entero mayor que 0.`);
    const s = normalizarSerie(it.serie);
    if (s && it.cantidad !== 1) errores.push(`Arma ${n}: con nº de serie la cantidad es 1.`);
    if (s) {
      if (series.has(s)) errores.push(`Arma ${n}: el nº de serie se repite (arma ${series.get(s)}).`);
      else series.set(s, n);
    }
  });
  return errores;
}

/* ======================================================================== */
/* 11.6 / 11.9 · Conteo y verificación contra la resolución                  */
/* ======================================================================== */

export interface ArmaListado {
  tipo: string;
  marca: string;
  modelo?: string | null;
  calibre?: string | null;
  serie?: string | null;
  accesorios?: string | null;
  cantidad: number;
}
export interface ArmaRecibida {
  tipo: string;
  marca: string;
  modelo?: string | null;
  calibre?: string | null;
  serie?: string | null;
  accesorios?: string | null;
}

export const totalSegunResolucion = (l: ArmaListado[]) => l.reduce((s, x) => s + (x.cantidad || 0), 0);

/** Acta (11.6): «Concuerda» si las contadas son las de la resolución; si no, «Diferencia → NC». */
export function resultadoActa(segunResolucion: number, recibidas: number): "concuerda" | "diferencia" {
  return segunResolucion === recibidas ? "concuerda" : "diferencia";
}

export interface Verificacion {
  segunResolucion: number;
  registradas: number;
  concuerda: boolean;
  diferencias: { tipo: "cantidad" | "falta" | "sobra" | "caracteristicas" | "accesorios"; detalle: string }[];
}

const clave = (x: ArmaRecibida | ArmaListado) =>
  [x.tipo, x.marca, x.modelo, x.calibre].map(comparable).join("|");
const descripcion = (x: ArmaRecibida | ArmaListado) =>
  [x.marca, x.modelo, x.calibre].filter((v) => v && String(v).trim()).join(" ") || x.tipo;

/**
 * 11.9 · Compara lo registrado con la resolución (Bizagi paso 8): cantidad,
 * características (tipo, marca, modelo, calibre) y accesorios. Las armas con
 * serie se emparejan por serie normalizada; las demás, por características.
 */
export function verificarContraResolucion(listado: ArmaListado[], armas: ArmaRecibida[]): Verificacion {
  const diferencias: Verificacion["diferencias"] = [];
  const segun = totalSegunResolucion(listado);
  if (segun !== armas.length)
    diferencias.push({ tipo: "cantidad", detalle: `La resolución autoriza ${segun} arma(s) y se registraron ${armas.length}.` });

  const conSerie = new Map<string, ArmaListado>();
  const sinSerie = new Map<string, number>();
  for (const l of listado) {
    const s = normalizarSerie(l.serie);
    if (s) conSerie.set(s, l);
    else sinSerie.set(clave(l), (sinSerie.get(clave(l)) ?? 0) + l.cantidad);
  }
  for (const a of armas) {
    const s = normalizarSerie(a.serie);
    const l = s ? conSerie.get(s) : undefined;
    if (l) {
      conSerie.delete(s!);
      if (clave(l) !== clave(a))
        diferencias.push({
          tipo: "caracteristicas",
          detalle: `Serie ${a.serie}: la resolución dice «${descripcion(l)}» y se recibió «${descripcion(a)}».`,
        });
      if (comparable(l.accesorios) !== comparable(a.accesorios))
        diferencias.push({
          tipo: "accesorios",
          detalle: `Serie ${a.serie}: accesorios «${l.accesorios || "ninguno"}» según la resolución y «${a.accesorios || "ninguno"}» recibidos.`,
        });
      continue;
    }
    const k = clave(a);
    const disponibles = sinSerie.get(k) ?? 0;
    if (disponibles > 0) sinSerie.set(k, disponibles - 1);
    else diferencias.push({ tipo: "sobra", detalle: `${descripcion(a)}${a.serie ? ` serie ${a.serie}` : ""}: no figura en la resolución.` });
  }
  for (const l of conSerie.values()) diferencias.push({ tipo: "falta", detalle: `${descripcion(l)} serie ${l.serie}: está en la resolución y no se registró.` });
  for (const [k, n] of sinSerie) {
    if (n <= 0) continue;
    const l = listado.find((x) => clave(x) === k)!;
    diferencias.push({ tipo: "falta", detalle: `${descripcion(l)}: faltan ${n} según la resolución.` });
  }
  return { segunResolucion: segun, registradas: armas.length, concuerda: diferencias.length === 0, diferencias };
}

/* ======================================================================== */
/* Parámetros de la operación (categoría d11)                                */
/* ======================================================================== */

export interface ConfigD11 {
  metodosRegistro: string[];
  metodosCip: string[];
  metodosCompleta: string[];
  metodosAccesorio: string[];
  metodosMaquina: string[];
  /** Ensayos con fuego real (IT04): gastan munición de prueba del inventario (11.17). */
  metodosFuego: string[];
  /** ¿Un arma con cuño CIP también se acuña? (EP-11 P4) */
  acunacionCip: boolean;
  vigenciaAnios: number;
}

export const CONFIG_D11_DEFECTO: ConfigD11 = {
  metodosRegistro: ["1292"],
  metodosCip: ["1291", "3500"],
  metodosCompleta: ["1213", "1202", "1203", "3500"],
  metodosAccesorio: ["2322"],
  metodosMaquina: ["3706"],
  metodosFuego: ["1203"],
  acunacionCip: false,
  vigenciaAnios: 4,
};

const lista = (v: string | null | undefined, porDefecto: string[]) => {
  const l = (v ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return l.length ? l : porDefecto;
};

/** Lee las filas de parametro_sistema (categoría d11); lo que falta o no se entiende rige por defecto. */
export function configD11(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigD11 {
  const v = (c: string) => filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? null;
  const anios = Number(v("vigencia_anios"));
  return {
    metodosRegistro: lista(v("metodos_registro"), CONFIG_D11_DEFECTO.metodosRegistro),
    metodosCip: lista(v("metodos_cip"), CONFIG_D11_DEFECTO.metodosCip),
    metodosCompleta: lista(v("metodos_completa"), CONFIG_D11_DEFECTO.metodosCompleta),
    metodosAccesorio: lista(v("metodos_accesorio"), CONFIG_D11_DEFECTO.metodosAccesorio),
    metodosMaquina: lista(v("metodos_maquina"), CONFIG_D11_DEFECTO.metodosMaquina),
    metodosFuego: lista(v("metodos_fuego"), CONFIG_D11_DEFECTO.metodosFuego),
    acunacionCip: v("acunacion_cip") === "si",
    vigenciaAnios: Number.isInteger(anios) && anios >= 1 && anios <= 10 ? anios : CONFIG_D11_DEFECTO.vigenciaAnios,
  };
}

/* ======================================================================== */
/* 11.11 / 11.12 · Clasificación y camino                                    */
/* ======================================================================== */

export interface Clasificacion {
  clase: Clase;
  permisibilidad: "permitida" | "prohibida";
  camino?: "cip" | "completa" | null;
}

/**
 * Camino efectivo y métodos que se cargan (11.12): el arma permitida va por
 * cuño CIP o por prueba completa; el accesorio (IT10) y la máquina recargadora
 * (IT12) van directo al certificado; la prohibida no sigue (informe de
 * incumplimiento a DGMN, 11.24).
 */
export function caminoDe(c: Clasificacion, cfg: ConfigD11): { camino: Camino | null; metodos: string[]; errores: string[] } {
  if (!(CLASES as readonly string[]).includes(c.clase)) return { camino: null, metodos: [], errores: ["Indique la clase (arma, accesorio o máquina recargadora)."] };
  if (c.permisibilidad !== "permitida" && c.permisibilidad !== "prohibida")
    return { camino: null, metodos: [], errores: ["Indique si es permitida o prohibida."] };
  if (c.permisibilidad === "prohibida") return { camino: null, metodos: [], errores: [] };
  if (c.clase === "accesorio") return { camino: "directo", metodos: cfg.metodosAccesorio, errores: [] };
  if (c.clase === "maquina_recargadora") return { camino: "directo", metodos: cfg.metodosMaquina, errores: [] };
  if (c.camino === "cip") return { camino: "cip", metodos: cfg.metodosCip, errores: [] };
  if (c.camino === "completa") return { camino: "completa", metodos: cfg.metodosCompleta, errores: [] };
  return { camino: null, metodos: [], errores: ["Elija el camino del arma: con cuño CIP (reconocimiento) o sin cuño CIP (prueba completa)."] };
}

/* ======================================================================== */
/* 11.15 / 11.20 · Captura sin valores por defecto (BL-038)                  */
/* ======================================================================== */

export type TipoEntrada = "defecto" | "valor" | "texto" | "atributo";

export interface EnsayoArma {
  resultadoId: string;
  estado: string;
  analito: string;
  metodoCodigo: string | null;
  tipoDato: string | null;
  limiteInf: string | null;
  limiteSup: string | null;
}

/** Métodos que se capturan como valor medido y no como defecto 0/1 (tensión del disparador IT03). */
export const METODOS_VALOR = new Set(["1202", "10733"]);

/**
 * Qué control pinta la pantalla: un defecto (0 = sin defecto, 1 = defecto) cuando
 * el requisito es exactamente 0; un valor medido en la tensión del disparador;
 * texto cuando no hay requisito (identificador IBIS de la evidencia balística).
 */
export function tipoEntrada(e: Pick<EnsayoArma, "tipoDato" | "limiteInf" | "limiteSup" | "metodoCodigo">): TipoEntrada {
  if (e.tipoDato === "atributo") return "atributo";
  if (e.metodoCodigo && METODOS_VALOR.has(e.metodoCodigo)) return "valor";
  const cero = (v: string | null) => v != null && v.trim() !== "" && Number(v.replace(",", ".")) === 0;
  if (cero(e.limiteInf) && cero(e.limiteSup)) return "defecto";
  if ((e.limiteInf ?? "").trim() === "" && (e.limiteSup ?? "").trim() === "") return "texto";
  return "valor";
}

/** Grupo de captura: inspección antes del disparo (AD-), después (DD-) o el método. */
export function grupoEnsayo(e: Pick<EnsayoArma, "analito" | "metodoCodigo">): string {
  const m = /^(AD|DD)\s*-/i.exec(e.analito.trim());
  return `${e.metodoCodigo ?? "?"}${m ? `:${m[1].toUpperCase()}` : ""}`;
}

export const NOMBRE_GRUPO: Record<string, string> = { AD: "Inspección ocular antes del disparo", DD: "Inspección ocular después del disparo" };

export interface ValorEnviado {
  resultadoId: string;
  valor?: string | number | null;
  atributo?: "cumple" | "no_cumple" | null;
}

/**
 * BL-038 · el armero toca cada fila: si captura un grupo (p. ej. la inspección
 * antes del disparo), todas sus filas pendientes deben venir con un valor
 * explícito; un defecto solo admite 0 o 1; nada se rellena solo.
 */
export function erroresCapturaExplicita(ensayos: EnsayoArma[], enviados: ValorEnviado[]): string[] {
  const errores: string[] = [];
  const porId = new Map(ensayos.map((e) => [e.resultadoId, e]));
  const vistos = new Set<string>();
  const grupos = new Set<string>();
  for (const v of enviados) {
    const e = porId.get(v.resultadoId);
    if (!e) {
      errores.push("Uno de los ensayos enviados no es de esta arma.");
      continue;
    }
    if (vistos.has(v.resultadoId)) errores.push(`«${e.analito}» viene dos veces.`);
    vistos.add(v.resultadoId);
    grupos.add(grupoEnsayo(e));
    const t = tipoEntrada(e);
    const texto = v.valor == null ? "" : String(v.valor).trim();
    if (t === "atributo") {
      if (v.atributo !== "cumple" && v.atributo !== "no_cumple") errores.push(`«${e.analito}»: marque Cumple o No cumple.`);
    } else if (t === "defecto") {
      if (texto !== "0" && texto !== "1") errores.push(`«${e.analito}»: marque 0 (sin defecto) o 1 (defecto).`);
    } else if (t === "valor") {
      if (!/^-?\d+([.,]\d+)?$/.test(texto)) errores.push(`«${e.analito}»: indique el valor medido (número).`);
    } else if (!texto) errores.push(`«${e.analito}»: indique el dato (no se deja en blanco).`);
    if (["revisado_n1", "aprobado"].includes(e.estado)) errores.push(`«${e.analito}» ya está ${e.estado === "aprobado" ? "aprobado" : "revisado"}: no se vuelve a capturar aquí.`);
  }
  for (const e of ensayos) {
    if (e.estado !== "pendiente" || vistos.has(e.resultadoId) || !grupos.has(grupoEnsayo(e))) continue;
    errores.push(`Falta marcar «${e.analito}»: cada fila se captura explícitamente (sin valor por defecto).`);
  }
  if (!enviados.length) errores.push("No hay valores que registrar.");
  return errores;
}

/* ======================================================================== */
/* 11.21 – 11.23 · Acuñación y certificado                                   */
/* ======================================================================== */

export interface EstadoArma {
  clase: Clase | null;
  permisibilidad: "permitida" | "prohibida" | null;
  camino: Camino | null;
  /** Ensayos de la muestra por estado. */
  ensayos: number;
  pendientes: number;
  aprobados: number;
  veredicto: string | null;
  acunada: boolean;
  /** Certificado vigente (en firma u oficial). */
  certificado: { estado: string } | null;
  entregada: boolean;
}

/** ¿Se acuña con el cuño BPCH (IT08)? Armas que cumplen por prueba completa (y las CIP si así se configura). */
export function requiereAcunacion(a: Pick<EstadoArma, "clase" | "permisibilidad" | "camino">, cfg: Pick<ConfigD11, "acunacionCip">): boolean {
  if (a.clase !== "arma" || a.permisibilidad !== "permitida") return false;
  return a.camino === "completa" || (a.camino === "cip" && cfg.acunacionCip);
}

export const todoAprobado = (a: Pick<EstadoArma, "ensayos" | "aprobados">) => a.ensayos > 0 && a.aprobados === a.ensayos;

/** Por qué no se puede acuñar (vacío = se puede). */
export function erroresAcunacion(a: EstadoArma, cfg: Pick<ConfigD11, "acunacionCip">): string[] {
  if (a.acunada) return ["ya está acuñada"];
  if (!requiereAcunacion(a, cfg))
    return [a.permisibilidad === "prohibida" ? "es prohibida" : a.clase !== "arma" ? "no es un arma (accesorio o máquina)" : "su camino no lleva acuñación"];
  if (!todoAprobado(a)) return ["faltan ensayos por aprobar (Revisión por OT)"];
  if (a.veredicto !== "cumple") return ["no cumple: solo se acuñan las armas que cumplen"];
  return [];
}

/** Por qué no se puede emitir el certificado del arma (vacío = se puede). */
export function erroresCertificado(a: EstadoArma, cfg: Pick<ConfigD11, "acunacionCip">): string[] {
  if (a.certificado) return [`ya tiene certificado (${a.certificado.estado === "en_firma" ? "en firma" : a.certificado.estado})`];
  if (a.permisibilidad === "prohibida") return ["es prohibida: corresponde informe de incumplimiento a DGMN"];
  if (!a.clase || (!a.camino && a.clase === "arma")) return ["falta clasificarla y elegir su camino"];
  if (!todoAprobado(a)) return ["faltan ensayos por aprobar (Revisión por OT)"];
  if (a.veredicto !== "cumple") return ["no cumple"];
  if (requiereAcunacion(a, cfg) && !a.acunada) return ["falta la acuñación BPCH (IT08)"];
  return [];
}

/** Vigencia (11.23): desde la emisión, N años menos un día (25-05-2026 → 24-05-2030). */
export function vigenciaHasta(desde: string, anios: number): string {
  const [a, m, d] = desde.split("-").map(Number);
  const f = new Date(Date.UTC(a + anios, m - 1, d));
  // 29-feb en un año no bisiesto: Date pasa al 1-mar; se queda en el 28-feb.
  if (f.getUTCMonth() !== m - 1) f.setUTCDate(0);
  f.setUTCDate(f.getUTCDate() - 1);
  return f.toISOString().slice(0, 10);
}

/** ¿Está vigente hoy? (fechas AAAA-MM-DD en hora de Chile). */
export const certificadoVigente = (hasta: string, hoy: string) => hoy <= hasta;

/** Rango de una emisión en bloque: primer y último número y cantidad. */
export function rangoEmision(numeros: string[]): { desde: string; hasta: string; cantidad: number } | null {
  if (!numeros.length) return null;
  const orden = [...numeros].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  return { desde: orden[0], hasta: orden[orden.length - 1], cantidad: numeros.length };
}

/* ======================================================================== */
/* Estado del arma y avance del expediente                                   */
/* ======================================================================== */

export type EtapaArma =
  | "registrada"
  | "prohibida"
  | "en_ensayo"
  | "por_revisar"
  | "no_cumple"
  | "por_acunar"
  | "por_certificar"
  | "certificado_en_firma"
  | "certificada"
  | "entregada";

export const NOMBRE_ETAPA_ARMA: Record<EtapaArma, string> = {
  registrada: "Por clasificar",
  prohibida: "Prohibida · informe a DGMN",
  en_ensayo: "En ensayo",
  por_revisar: "Por revisar y aprobar",
  no_cumple: "No cumple",
  por_acunar: "Por acuñar",
  por_certificar: "Por certificar",
  certificado_en_firma: "Certificado en firma",
  certificada: "Certificada",
  entregada: "Entregada",
};

export function etapaArma(a: EstadoArma, cfg: Pick<ConfigD11, "acunacionCip">): EtapaArma {
  if (a.entregada) return "entregada";
  if (!a.clase || !a.permisibilidad) return "registrada";
  if (a.permisibilidad === "prohibida") return "prohibida";
  if (a.certificado) return a.certificado.estado === "en_firma" ? "certificado_en_firma" : "certificada";
  if (a.pendientes > 0) return "en_ensayo";
  if (!todoAprobado(a)) return "por_revisar";
  if (a.veredicto !== "cumple") return "no_cumple";
  if (requiereAcunacion(a, cfg) && !a.acunada) return "por_acunar";
  return "por_certificar";
}

export interface HechosExpediente {
  programada: boolean;
  llegada: boolean;
  actaFirmada: boolean;
  /** Recibidas y contadas según el acta. */
  recibidas: number | null;
  armas: EstadoArma[];
}

export type EstadoPaso = "hecho" | "en_curso" | "pendiente";
export interface PasoD11 {
  clave: string;
  titulo: string;
  boton: string;
  leToca: string;
  estado: EstadoPaso;
  detalle: string;
}

/**
 * Barra de pasos del expediente D11 (patrón de las maquetas: pasos numerados,
 * «Verbo → siguiente», a quién le toca). El paso actual es el primero no hecho.
 */
export function avanceD11(h: HechosExpediente, cfg: Pick<ConfigD11, "acunacionCip">): { pasos: PasoD11[]; actual: number; completo: boolean } {
  const n = h.armas.length;
  const etapas = h.armas.map((a) => etapaArma(a, cfg));
  const cuenta = (f: (e: EtapaArma, a: EstadoArma) => boolean) => h.armas.filter((a, i) => f(etapas[i], a)).length;
  const activas = h.armas.filter((a) => a.permisibilidad !== "prohibida");
  const clasificadas = cuenta((e) => e !== "registrada");
  const sinPendientes = cuenta((_e, a) => a.clase != null && a.pendientes === 0);
  const aprobadas = cuenta((_e, a) => a.permisibilidad === "prohibida" || todoAprobado(a));
  const porAcunar = h.armas.filter((a) => requiereAcunacion(a, cfg) && a.veredicto === "cumple");
  const acunadas = porAcunar.filter((a) => a.acunada).length;
  const certificables = activas.filter((a) => a.veredicto === "cumple");
  const certificadas = certificables.filter((a) => a.certificado).length;
  const oficiales = certificables.filter((a) => a.certificado && a.certificado.estado !== "en_firma").length;
  const entregadas = cuenta((e) => e === "entregada");
  const registroCompleto = h.recibidas != null && h.recibidas > 0 && n >= h.recibidas;

  const p = (clave: string, titulo: string, boton: string, leToca: string, hecho: boolean, enCurso: boolean, detalle: string): PasoD11 => ({
    clave,
    titulo,
    boton,
    leToca,
    estado: hecho ? "hecho" : enCurso ? "en_curso" : "pendiente",
    detalle,
  });
  const pasos: PasoD11[] = [
    p("programacion", "Programar la recepción", "Programar → esperar llegada", "Jefe D11", h.programada, false, h.programada ? "Programada" : "Fecha, lugar y responsable"),
    p("llegada", "Aviso de llegada", "Confirmar llegada → recepción", "D11", h.llegada, false, h.llegada ? "Llegada confirmada" : "Fecha, transportista y bultos"),
    p("acta", "Acta de recepción", "Firmar acta → registrar armas", "Armero", h.actaFirmada, false, h.actaFirmada ? `${h.recibidas ?? 0} recibidas` : "Conteo contra la resolución"),
    p("registro", "Registro de armas", "Registrar armas → verificar", "Armero", registroCompleto, n > 0, `${n} de ${h.recibidas ?? "—"} registradas`),
    p("clasificacion", "Clasificación y camino", "Clasificar → camino", "Armero", n > 0 && clasificadas === n && registroCompleto, clasificadas > 0, `${clasificadas} de ${n}`),
    p("ensayos", "Ensayos por arma", "Registrar ensayos → revisión", "Armero", n > 0 && sinPendientes === n && clasificadas === n, sinPendientes > 0, `${sinPendientes} de ${n} capturadas`),
    p("revision", "Revisión y aprobación", "Aprobar → acuñar y certificar", "Jefe D11", n > 0 && aprobadas === n && sinPendientes === n, aprobadas > 0, `${aprobadas} de ${n} aprobadas`),
    p("acunacion", "Acuñación BPCH (IT08)", "Acuñar → certificar", "Armero", n > 0 && aprobadas === n && acunadas === porAcunar.length, acunadas > 0, porAcunar.length ? `${acunadas} de ${porAcunar.length}` : "No aplica"),
    p("certificados", "Certificados por arma", "Emitir certificados → firma", "Jefe D11", n > 0 && aprobadas === n && certificables.length > 0 && oficiales === certificables.length, certificadas > 0, `${oficiales} oficiales de ${certificables.length}`),
    p("entrega", "Entrega al importador", "Registrar entrega → cierre", "D11 / Comercial", n > 0 && entregadas === n, entregadas > 0, `${entregadas} de ${n} entregadas`),
  ];
  // Un paso solo cuenta como hecho si los anteriores lo están (la barra no salta).
  let corte = pasos.findIndex((x) => x.estado !== "hecho");
  if (corte < 0) corte = pasos.length;
  pasos.forEach((x, i) => {
    if (i > corte && x.estado === "hecho") x.estado = "en_curso";
  });
  return { pasos, actual: Math.min(corte, pasos.length - 1) + 1, completo: corte === pasos.length };
}

/** 11.27 · qué falta para cerrar la OT de armas: armas entregadas o con destino. */
export function faltantesCierreD11(armas: { muestra: string; entregada: boolean; prohibida: boolean }[]): string[] {
  const sin = armas.filter((a) => !a.entregada && !a.prohibida).map((a) => a.muestra);
  if (!sin.length) return [];
  return [`Faltan ${sin.length} arma(s) por entregar al importador (${sin.slice(0, 5).join(", ")}${sin.length > 5 ? "…" : ""}): regístrelo en Certificación de armas › Entrega.`];
}
