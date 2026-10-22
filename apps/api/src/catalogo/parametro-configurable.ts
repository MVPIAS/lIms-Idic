/**
 * Parámetros de la entrega R1 que se editan desde «Parámetros del sistema» ·
 * reglas PURAS (sin BD), probadas en parametro-configurable.spec.ts.
 *
 * Cada parámetro tiene un TIPO y el valor se valida según él antes de guardarse
 * en `parametro_sistema` con la forma que leen sus lectores (circuito-config.ts,
 * numeracion-cotizacion.ts, recepcion.service.ts, metrologia-ot.datos.ts,
 * equipo-captura.ts y la función fn_encuesta_al_cerrar_ot). Igual que los
 * porcentajes de la tasa (parametro-porcentaje.ts): todo cambio exige motivo y
 * queda en `parametro_sistema_historial` (quién, cuándo, antes, después y por qué).
 *
 * Tipos:
 *   entero      número entero entre `min` y `max` (dígitos, meses, inicio…)
 *   porcentaje  0–100 con coma decimal (se guarda con punto)
 *   sino        Sí / No (se guarda «si» / «no»)
 *   opcion      una de `opciones`
 *   multiple    varias de `opciones` (se guarda separadas por coma)
 *   formato     plantilla de número con {AAAA} y {N}
 *   obligatorio Sí / No guardado en la columna `activo` (producto obligatorio por laboratorio)
 *   campo       definición JSON de un campo propio de la recepción
 *               {tipo, obligatorio, opciones, ayuda} + `activo`
 */
import { formatearNumeroCotizacion, configNumeracion } from "../cotizacion/numeracion-cotizacion";
import { CLASES_CUSTODIA, TIPOS_CAMPO, leerCampo, type TipoCampo } from "../recepcion/reglas-recepcion";
import { leerPorcentaje, valorGuardado } from "./parametro-porcentaje";

export type TipoValor = "entero" | "porcentaje" | "sino" | "opcion" | "multiple" | "formato" | "obligatorio" | "campo";

export interface Opcion {
  valor: string;
  etiqueta: string;
}

export interface DefValor {
  tipo: TipoValor;
  /** Nombre que se muestra (la etiqueta de la fila puede traer pistas técnicas). */
  nombre: string;
  ayuda?: string;
  min?: number;
  max?: number;
  /** Unidad del número («meses», «dígitos»). */
  unidad?: string;
  opciones?: Opcion[];
  /** Valor que rige si la fila falta o no se entiende (lo que hacen los lectores). */
  porDefecto?: string;
}

export interface GrupoConfig {
  categoria: string;
  titulo: string;
  /** Dónde surte efecto (pantalla o paso). */
  donde: string;
  /** Pregunta abierta al IDIC, si la hay. */
  porConfirmar?: string;
  /** Códigos fijos. */
  codigos?: Record<string, DefValor>;
  /** Cualquier código de la categoría (uno por laboratorio o por campo), con alta desde la pantalla. */
  patron?: DefValor & { alta: "laboratorio" | "campo" };
}

const SI_NO: Opcion[] = [
  { valor: "si", etiqueta: "Sí" },
  { valor: "no", etiqueta: "No" },
];

/** Orígenes de OT (reglas-ot.ts ORIGENES_OT + los de BPCH). */
export const ORIGENES_OT_ENCUESTA: Opcion[] = [
  { valor: "COTIZACION", etiqueta: "Cotización" },
  { valor: "DISPOSICION", etiqueta: "Disposición del Director" },
  { valor: "INTERLABORATORIO", etiqueta: "Interlaboratorio" },
  { valor: "OT_INTERNA", etiqueta: "OT interna" },
  { valor: "INTERNACION", etiqueta: "Internación (BPCH)" },
  { valor: "REINSPECCION", etiqueta: "Reinspección (BPCH)" },
  { valor: "PRODUCCION_NACIONAL", etiqueta: "Producción Nacional (BPCH)" },
  { valor: "PROTOTIPO", etiqueta: "Prototipo (BPCH)" },
];

const TIPO_CAMPO_ETIQUETA: Record<TipoCampo, string> = {
  texto: "Texto",
  numero: "Número",
  entero: "Número entero",
  fecha: "Fecha",
  lista: "Lista de opciones",
  casilla: "Casilla (sí / no)",
};
export const OPCIONES_TIPO_CAMPO: Opcion[] = TIPOS_CAMPO.map((t) => ({ valor: t, etiqueta: TIPO_CAMPO_ETIQUETA[t] }));

/** Registro de los parámetros R1 editables, en el orden de la pantalla. */
export const GRUPOS_CONFIG: GrupoConfig[] = [
  {
    categoria: "numeracion_cotizacion",
    titulo: "Numeración de la cotización",
    donde: "Comercial › Cotizaciones: el número se asigna al crear la cotización. Las ya numeradas no cambian.",
    porConfirmar: "Formato y si el correlativo es global o anual (EP-00 §10 P6).",
    codigos: {
      formato: {
        tipo: "formato",
        nombre: "Formato del número",
        ayuda: "{AAAA} = año de emisión, {N} = correlativo. Ejemplo: {AAAA}-{N} → 2026-14324.",
        porDefecto: "{AAAA}-{N}",
      },
      digitos: { tipo: "entero", nombre: "Dígitos mínimos del correlativo", min: 1, max: 10, unidad: "dígitos", ayuda: "Se rellena con ceros a la izquierda.", porDefecto: "5" },
      reinicio: {
        tipo: "opcion",
        nombre: "Reinicio del correlativo",
        opciones: [
          { valor: "global", etiqueta: "Nunca (correlativo continuo)" },
          { valor: "anual", etiqueta: "Cada año vuelve a 1" },
        ],
        porDefecto: "global",
      },
      inicio: {
        tipo: "entero",
        nombre: "Último número ya usado",
        min: 0,
        max: 999_999_999,
        ayuda: "El siguiente número será este + 1 (sirve para continuar la numeración del Sistema Comercial). Bajarlo no reutiliza números ya emitidos.",
        porDefecto: "0",
      },
    },
  },
  {
    categoria: "circuito_cotizacion",
    titulo: "Circuito de la cotización",
    donde: "Comercial › Cotización: costeo con el laboratorio, V°B°, firma del Jefe DCO y registro de la aceptación.",
    porConfirmar: "Niveles de V°B° y si la firma y la consulta al laboratorio son obligatorias (EP-00 §10 P1–P2).",
    codigos: {
      vb_niveles: {
        tipo: "opcion",
        nombre: "V°B° que exige la respuesta del laboratorio",
        opciones: [
          { valor: "lab_depto", etiqueta: "Laboratorio y departamento" },
          { valor: "lab", etiqueta: "Solo el laboratorio" },
          { valor: "ninguno", etiqueta: "Ninguno" },
        ],
        porDefecto: "lab_depto",
      },
      exigir_consulta_laboratorio: {
        tipo: "sino",
        nombre: "Exigir al menos una consulta al laboratorio antes de firmar",
        opciones: SI_NO,
        porDefecto: "no",
      },
      exigir_firma_para_aceptar: {
        tipo: "sino",
        nombre: "Exigir la firma del Jefe DCO antes de registrar la aceptación",
        opciones: SI_NO,
        ayuda: "Con «No», la cotización se puede aceptar sin firmar.",
        porDefecto: "si",
      },
      cfa_pct: { tipo: "porcentaje", nombre: "Costo fijo asociado (CFA) del Formulario de costeo", min: 0, max: 100, porDefecto: "12" },
      margen_particular_pct: { tipo: "porcentaje", nombre: "Recargo del precio particular sobre el costo total", min: 0, max: 100, porDefecto: "20" },
    },
  },
  {
    categoria: "encuesta",
    titulo: "Encuestas de satisfacción",
    donde: "Al cerrar o finalizar una OT nace su encuesta pendiente (Comercial › Encuestas), salvo para estos orígenes.",
    codigos: {
      excluir_origenes: {
        tipo: "multiple",
        nombre: "Orígenes de OT que NO generan encuesta",
        opciones: ORIGENES_OT_ENCUESTA,
        ayuda: "Marque los orígenes sin cliente externo. Sin ninguno marcado, toda OT cerrada genera encuesta.",
        porDefecto: "OT_INTERNA,INTERLABORATORIO",
      },
    },
  },
  {
    categoria: "metrologia",
    titulo: "Metrología · cierre de la OT de calibración",
    donde: "OT de Metrología › Cerrar OT y la lista «OT por cerrar».",
    codigos: {
      cierre_exige_devolucion: {
        tipo: "sino",
        nombre: "El cierre exige registrar la devolución de cada instrumento",
        opciones: SI_NO,
        porDefecto: "si",
      },
    },
  },
  {
    categoria: "recepcion_producto_obligatorio",
    titulo: "Recepción · producto obligatorio por laboratorio",
    donde: "OT › Muestras › Recepción: el laboratorio marcado no puede dar la muestra por recibida sin elegir el producto (matriz).",
    patron: {
      tipo: "obligatorio",
      nombre: "Producto obligatorio al recepcionar",
      opciones: SI_NO,
      alta: "laboratorio",
      porDefecto: "no",
    },
  },
  {
    categoria: "numeracion_muestra",
    titulo: "Recepción · Nº de muestra interno",
    donde: "OT › Muestras › «Asignar número».",
    codigos: {
      inicio: {
        tipo: "entero",
        nombre: "Primer Nº de muestra interno",
        min: 1,
        max: 999_999_999,
        ayuda: "Si se continúa la numeración del LIMS antiguo, ponga aquí el siguiente número. No reutiliza números ya asignados.",
        porDefecto: "1",
      },
    },
  },
  {
    categoria: "retencion_muestra",
    titulo: "Recepción · plazos de retención",
    donde: "Muestras › Custodia: antes de cumplirse el plazo no se puede registrar la destrucción. Vale para las muestras que se reciban desde el cambio.",
    codigos: {
      testigo: { tipo: "entero", nombre: "Muestra testigo · tiempo en bodega antes de destruirla", min: 1, max: 600, unidad: "meses", porDefecto: "1" },
      contramuestra: { tipo: "entero", nombre: "Contramuestra · tiempo de retención", min: 1, max: 600, unidad: "meses", porDefecto: "12" },
    },
  },
  {
    categoria: "recepcion_campo",
    titulo: "Recepción · campos propios de cada laboratorio",
    donde: "OT › Muestras › Recepción: campos adicionales que pide cada laboratorio (lote, fabricante, verificaciones…).",
    patron: { tipo: "campo", nombre: "Campo de recepción", alta: "campo" },
  },
  {
    categoria: "captura_equipo",
    titulo: "Captura · equipo usado",
    donde: "Captura y revisión por OT: cuándo es obligatorio indicar el equipo (contrato §4.4.2).",
    codigos: {
      obligatorio: {
        tipo: "opcion",
        nombre: "Equipo obligatorio al capturar",
        opciones: [
          { valor: "metodo", etiqueta: "Solo en los métodos marcados «exige equipo»" },
          { valor: "numerico", etiqueta: "En todo ensayo numérico y en los métodos marcados" },
          { valor: "siempre", etiqueta: "En todo ensayo" },
        ],
        porDefecto: "metodo",
      },
    },
  },
];

export const CATEGORIAS_CONFIGURABLES = GRUPOS_CONFIG.map((g) => g.categoria);

export const grupoDe = (categoria: string) => GRUPOS_CONFIG.find((g) => g.categoria === categoria) ?? null;

/** Definición del valor de (categoría, código), o null si no es un parámetro configurable. */
export function defConfigurable(categoria: string, codigo: string): DefValor | null {
  const g = grupoDe(categoria);
  if (!g) return null;
  if (g.codigos) return g.codigos[codigo] ?? null;
  if (g.patron) return codigoValido(g.patron.alta, codigo) ? g.patron : null;
  return null;
}

/** Código válido de un parámetro por patrón: «LME» o «LME.lote». */
export function codigoValido(alta: "laboratorio" | "campo", codigo: string): boolean {
  if (alta === "laboratorio") return /^[A-Z][A-Z0-9]{1,11}$/.test(codigo);
  return /^[A-Z][A-Z0-9]{1,11}\.[a-z][a-z0-9_]{0,39}$/.test(codigo);
}

/** Laboratorio de un código por patrón («LME.lote» → «LME»). */
export const laboratorioDe = (codigo: string) => codigo.split(".")[0];

/* ------------------------------------------------------------- lectura --- */

export interface Fila {
  codigo: string;
  valor: string | null;
  activo: boolean;
}

export interface DefCampo {
  tipo: TipoCampo;
  obligatorio: boolean;
  opciones: Opcion[];
  ayuda: string;
  activo: boolean;
}

const siNoDe = (v: string | null | undefined, def: boolean): boolean => {
  const t = String(v ?? "").trim().toLowerCase();
  if (["si", "sí", "true", "1", "s"].includes(t)) return true;
  if (["no", "false", "0", "n"].includes(t)) return false;
  return def;
};

function campoDe(valor: string | null, activo: boolean): DefCampo {
  let d: any = {};
  try {
    d = valor ? JSON.parse(valor) : {};
  } catch {
    d = {};
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
  return {
    tipo: (TIPOS_CAMPO as readonly string[]).includes(d.tipo) ? d.tipo : "texto",
    obligatorio: d.obligatorio === true,
    opciones: Array.isArray(d.opciones)
      ? d.opciones
          .map((o: any) =>
            typeof o === "string" ? { valor: o.trim(), etiqueta: o.trim() } : { valor: String(o?.valor ?? "").trim(), etiqueta: String(o?.etiqueta ?? o?.valor ?? "").trim() },
          )
          .filter((o: Opcion) => o.valor)
      : [],
    ayuda: typeof d.ayuda === "string" ? d.ayuda : "",
    activo,
  };
}

/** Valor tipado para el formulario de la pantalla (lo que rige hoy). */
export function valorFormulario(def: DefValor, f: Fila): unknown {
  const v = f.valor;
  switch (def.tipo) {
    case "entero": {
      const n = Number(String(v ?? "").trim());
      return Number.isSafeInteger(n) ? n : null;
    }
    case "porcentaje": {
      const n = Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "sino":
      return siNoDe(v, siNoDe(def.porDefecto, true));
    case "opcion": {
      const t = String(v ?? "").trim().toLowerCase();
      return def.opciones?.some((o) => o.valor === t) ? t : def.porDefecto ?? null;
    }
    case "multiple": {
      const marcados = String(v ?? "").toUpperCase().replace(/\s/g, "").split(",").filter(Boolean);
      return (def.opciones ?? []).filter((o) => marcados.includes(o.valor)).map((o) => o.valor);
    }
    case "formato":
      return String(v ?? "");
    case "obligatorio":
      return f.activo;
    case "campo":
      return campoDe(v, f.activo);
  }
}

/* ---------------------------------------------------------- validación --- */

export interface ValorNormalizado {
  /** Nuevo `valor` de la fila (undefined = no cambia). */
  valor?: string | null;
  /** Nuevo `activo` de la fila. */
  activo: boolean;
  /** Representación para el historial. */
  historial: string;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const esSiNo = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "si" || v === "sí" ? true : v === "no" ? false : null);

/** Valida un formato de número: solo {AAAA} y {N} (este una vez), letras, dígitos y - _ / . espacio. */
export function erroresFormato(formato: string): string[] {
  const e: string[] = [];
  if (!formato) return ["Escriba el formato del número (debe contener {N})."];
  if (formato.length > 40) e.push("El formato admite como máximo 40 caracteres.");
  if ((formato.match(/\{N\}/g) ?? []).length !== 1) e.push("El formato debe contener {N} (el correlativo) exactamente una vez.");
  const resto = formato.replace(/\{AAAA\}|\{N\}/g, "");
  if (/[{}]/.test(resto)) e.push("Solo se admiten las marcas {AAAA} y {N}.");
  else if (!/^[A-Za-z0-9\-_/. ]*$/.test(resto)) e.push("Use solo letras, dígitos, guion, guion bajo, barra, punto o espacio además de {AAAA} y {N}.");
  return e;
}

/** Ejemplo de número con un formato (para la pantalla). */
export function ejemploFormato(formato: string, digitos: number, anio: number, n: number): string {
  return formatearNumeroCotizacion(configNumeracion({ formato, digitos: String(digitos) }), anio, n);
}

/** Normaliza y valida la definición de un campo de recepción. */
export function normalizarCampo(codigo: string, etiqueta: string, entrada: unknown): { errores: string[]; def?: Omit<DefCampo, "activo">; activo: boolean } {
  const e: string[] = [];
  const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const tipo = texto(d.tipo) as TipoCampo;
  if (!(TIPOS_CAMPO as readonly string[]).includes(tipo)) e.push(`Elija el tipo del campo (${TIPOS_CAMPO.join(", ")}).`);
  const obligatorio = esSiNo(d.obligatorio ?? false);
  if (obligatorio === null) e.push("«Obligatorio» debe ser sí o no.");
  const activo = esSiNo(d.activo ?? true);
  if (activo === null) e.push("«Activo» debe ser sí o no.");
  const ayuda = texto(d.ayuda);
  if (ayuda.length > 300) e.push("La ayuda admite como máximo 300 caracteres.");
  let opciones: Opcion[] = [];
  if (tipo === "lista") {
    if (!Array.isArray(d.opciones)) e.push("Indique las opciones de la lista.");
    else {
      opciones = d.opciones.map((o: any) => ({ valor: texto(o?.valor), etiqueta: texto(o?.etiqueta) || texto(o?.valor) }));
      if (!opciones.length) e.push("Una lista necesita al menos una opción.");
      if (opciones.length > 30) e.push("Como máximo 30 opciones.");
      if (opciones.some((o) => !o.valor)) e.push("Cada opción necesita su valor.");
      if (opciones.some((o) => o.valor.length > 60 || o.etiqueta.length > 120)) e.push("El valor de una opción admite 60 caracteres y su texto 120.");
      if (new Set(opciones.map((o) => o.valor)).size !== opciones.length) e.push("Hay opciones con el mismo valor.");
    }
  }
  const campo = codigo.split(".")[1] ?? "";
  if (campo === "clase_custodia" && (tipo !== "lista" || opciones.some((o) => !(CLASES_CUSTODIA as readonly string[]).includes(o.valor))))
    e.push(`El destino de la muestra (clase_custodia) es una lista cuyos valores solo pueden ser: ${CLASES_CUSTODIA.join(", ")}.`);
  if (e.length) return { errores: e, activo: activo ?? true };
  const def = { tipo, obligatorio: obligatorio!, opciones, ayuda };
  // La recepción debe entender lo que se guarda (mismo lector que usa al recibir).
  const json = jsonCampo(def);
  if (!leerCampo({ codigo, etiqueta, valor: json, activo: true }, laboratorioDe(codigo)))
    return { errores: ["La recepción no podría usar esta definición: revise el tipo y las opciones."], activo: activo! };
  return { errores: [], def, activo: activo! };
}

/** JSON con que se guarda un campo (sin claves vacías). */
export function jsonCampo(def: Omit<DefCampo, "activo">): string {
  const o: Record<string, unknown> = { tipo: def.tipo };
  if (def.obligatorio) o.obligatorio = true;
  if (def.tipo === "lista") o.opciones = def.opciones;
  if (def.ayuda) o.ayuda = def.ayuda;
  return JSON.stringify(o);
}

/**
 * Valida el nuevo valor según el tipo y devuelve cómo se guarda. Lista de
 * errores vacía = válido. `fila` es la fila actual (código, etiqueta).
 */
export function normalizarValor(
  def: DefValor,
  fila: { codigo: string; etiqueta: string },
  entrada: unknown,
): { errores: string[]; valor?: ValorNormalizado } {
  switch (def.tipo) {
    case "entero": {
      const t = typeof entrada === "number" ? String(entrada) : texto(entrada);
      const n = Number(t);
      if (!/^-?\d+$/.test(t) || !Number.isSafeInteger(n)) return { errores: ["Escriba un número entero, sin decimales."] };
      if ((def.min != null && n < def.min) || (def.max != null && n > def.max))
        return { errores: [`El valor debe estar entre ${def.min ?? "—"} y ${def.max?.toLocaleString("es-CL") ?? "—"}${def.unidad ? ` ${def.unidad}` : ""}.`] };
      return { errores: [], valor: { valor: String(n), activo: true, historial: String(n) } };
    }
    case "porcentaje": {
      const n = leerPorcentaje(entrada);
      if (!Number.isFinite(n)) return { errores: ["Escriba el porcentaje como número, con coma decimal (p. ej. 12,5)."] };
      if (n < (def.min ?? 0) || n > (def.max ?? 100)) return { errores: [`El porcentaje debe estar entre ${def.min ?? 0} y ${def.max ?? 100}.`] };
      if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) return { errores: ["Como máximo 4 decimales."] };
      const g = valorGuardado(n);
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "sino": {
      const b = esSiNo(entrada);
      if (b === null) return { errores: ["Elija Sí o No."] };
      const g = b ? "si" : "no";
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "opcion": {
      const t = texto(entrada);
      if (!def.opciones?.some((o) => o.valor === t)) return { errores: [`Elija una de las opciones: ${(def.opciones ?? []).map((o) => o.etiqueta).join(" · ")}.`] };
      return { errores: [], valor: { valor: t, activo: true, historial: t } };
    }
    case "multiple": {
      if (!Array.isArray(entrada) || entrada.some((x) => typeof x !== "string")) return { errores: ["Marque las opciones como una lista."] };
      const validas = new Set((def.opciones ?? []).map((o) => o.valor));
      const malas = entrada.filter((x) => !validas.has(x));
      if (malas.length) return { errores: [`Opciones desconocidas: ${malas.join(", ")}.`] };
      const g = (def.opciones ?? []).filter((o) => entrada.includes(o.valor)).map((o) => o.valor).join(",");
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "formato": {
      const t = texto(entrada);
      const e = erroresFormato(t);
      if (e.length) return { errores: e };
      return { errores: [], valor: { valor: t, activo: true, historial: t } };
    }
    case "obligatorio": {
      const b = esSiNo(entrada);
      if (b === null) return { errores: ["Elija Sí o No."] };
      return { errores: [], valor: { activo: b, historial: b ? "si" : "no" } };
    }
    case "campo": {
      const r = normalizarCampo(fila.codigo, fila.etiqueta, entrada);
      if (r.errores.length || !r.def) return { errores: r.errores };
      const json = jsonCampo(r.def);
      return { errores: [], valor: { valor: json, activo: r.activo, historial: historialCampo(json, r.activo) } };
    }
  }
}

/** Representación de un campo en el historial: su JSON con «activo». */
export function historialCampo(valor: string | null, activo: boolean): string {
  let d: Record<string, unknown> = {};
  try {
    d = valor ? JSON.parse(valor) : {};
  } catch {
    d = {};
  }
  return JSON.stringify({ ...d, activo });
}

/** Representación actual de una fila para el historial (para comparar y registrar «antes»). */
export function historialDeFila(def: DefValor, f: Fila): string {
  if (def.tipo === "obligatorio") return f.activo ? "si" : "no";
  if (def.tipo === "campo") return historialCampo(f.valor, f.activo);
  return f.valor ?? "";
}

/** Errores del motivo (mismo criterio que los porcentajes de la tasa). */
export function erroresMotivo(motivo: unknown): string[] {
  const m = typeof motivo === "string" ? motivo.trim() : "";
  if (m.length < 5) return ["Indique el motivo del cambio (mínimo 5 caracteres)."];
  if (m.length > 500) return ["El motivo admite como máximo 500 caracteres."];
  return [];
}

/* ------------------------------------------------------- texto legible --- */

/** Texto legible de un valor guardado (tabla y historial). */
export function textoValor(def: DefValor, guardado: string | null | undefined): string {
  const v = guardado ?? "";
  switch (def.tipo) {
    case "entero":
      return v === "" ? "—" : `${Number(v).toLocaleString("es-CL")}${def.unidad && def.unidad !== "dígitos" ? ` ${def.unidad}` : ""}`;
    case "porcentaje": {
      const n = Number(v.replace(",", "."));
      return v === "" || !Number.isFinite(n) ? "—" : `${n.toLocaleString("es-CL", { maximumFractionDigits: 4 })} %`;
    }
    case "sino":
    case "obligatorio":
      return siNoDe(v, false) ? "Sí" : "No";
    case "opcion":
      return def.opciones?.find((o) => o.valor === v.trim())?.etiqueta ?? (v || "—");
    case "multiple": {
      const marcados = v.toUpperCase().replace(/\s/g, "").split(",").filter(Boolean);
      return marcados.length ? marcados.map((m) => def.opciones?.find((o) => o.valor === m)?.etiqueta ?? m).join(", ") : "Ninguno";
    }
    case "formato":
      return v || "—";
    case "campo": {
      let d: any = {};
      try {
        d = v ? JSON.parse(v) : {};
      } catch {
        return v || "—";
      }
      const tipo = TIPO_CAMPO_ETIQUETA[d?.tipo as TipoCampo] ?? "Texto";
      const partes = [tipo + (d?.tipo === "lista" && Array.isArray(d?.opciones) ? `: ${d.opciones.map((o: any) => o?.etiqueta ?? o?.valor ?? o).join(" / ")}` : "")];
      partes.push(d?.obligatorio ? "obligatorio" : "opcional");
      if (d?.activo === false) partes.push("inactivo");
      return partes.join(" · ");
    }
  }
}
