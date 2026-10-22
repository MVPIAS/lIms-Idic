/**
 * Formato de la hoja «Certificado» de cada libro de trabajo del LMT (respuesta del
 * laboratorio del 21-10-2026, observación 4: «mantener la información establecida en
 * los certificados de cada libro de trabajo», NCh 2451:2014).
 *
 * Lo que cambia de una instrucción a otra (rótulos de la identificación del
 * instrumento, presión atmosférica, condiciones propias de la IT, encabezado de las
 * hojas de resultados y frases habituales de OBSERVACIONES) sale de esta tabla y no
 * de la plantilla. Fuente: volcado de las hojas «Certificado» de V-5920, M-3947,
 * M-3859, M-3889, P-807, P-808, V-5878, V-5881, V-5885, F-1556, F-1563, T-2887,
 * T-2890, L-4351, L-4352, L-4359, L-4377 y PT-0090.
 */

/** Dato propio de la IT que se imprime en «Condiciones de calibración» (lo escribe el metrólogo). */
export interface CampoCertificado {
  clave: string;
  etiqueta: string;
  /** Valores habituales en los libros (la pantalla los ofrece; se puede escribir otro). */
  opciones?: string[];
  /** Dónde se imprime: identificación del instrumento o condiciones de calibración (por defecto). */
  seccion?: "instrumento" | "condiciones";
}

/** Dato del instrumento: clave en `calibracion.instrumento` y rótulo. */
type Dato = [clave: "item" | "rango" | "res" | "cap" | "clase", etiqueta: string];

export interface FormatoIT {
  /** Rótulo de la capacidad (`instrumento.cap`) en la hoja 1; null = no se imprime. */
  capacidad: string | null;
  /** Rótulo del rango calibrado en la hoja 1; null = no se imprime. */
  rango: string | null;
  /** Rótulo de la clase del ítem en la hoja 1; null = no se imprime. */
  clase: string | null;
  /** «Presión atmosférica promedio» en las condiciones. */
  presion: boolean;
  /** Condiciones propias de la IT (secuencia, medio, sentido…). */
  campos: CampoCertificado[];
  /** Datos del ítem que repite cada hoja de resultados, bajo la cabecera. */
  hojaResultados: Dato[];
  /** Frases habituales de OBSERVACIONES en el libro (se ofrecen al metrólogo). */
  frases: string[];
  /** Sujeto de la síntesis: «el instrumento» o «el calibrando» (isotermos). */
  sujeto: string;
}

const PUNTOS_CLIENTE = "Los puntos de calibración fueron requeridos por el cliente.";
const ACCESORIOS: CampoCertificado = { clave: "accesorios", etiqueta: "Accesorios usados en la calibración", opciones: ["No se utilizaron accesorios"] };

const BASE: FormatoIT = {
  capacidad: "Capacidad máxima", rango: "Rango calibrado", clase: null, presion: false, campos: [],
  hojaResultados: [["item", "Descripción del ítem"], ["rango", "Rango calibrado"], ["res", "Resolución"]],
  frases: [PUNTOS_CLIENTE], sujeto: "el instrumento",
};
const MASAS: FormatoIT = {
  ...BASE, capacidad: "Valor nominal", rango: null, clase: "Clase", presion: true,
  hojaResultados: [["item", "Descripción del ítem"], ["cap", "Valor nominal"]],
};
const PRESION: FormatoIT = {
  ...BASE, presion: true,
  campos: [
    { clave: "secuencia", etiqueta: "Secuencia de calibración", opciones: ["Secuencia de calibración A", "Secuencia de calibración B", "Secuencia de calibración C"] },
    { clave: "medio", etiqueta: "Medio de transmisión de presión", opciones: ["Nitrógeno", "Alcohol", "Aceite"] },
    { clave: "posicion", etiqueta: "Posición durante la calibración", opciones: ["Vertical", "Horizontal"] },
    { clave: "lineaReferencia", etiqueta: "Línea de referencia", opciones: ["Fondo línea de conexión"] },
  ],
};
const VOLUMEN: FormatoIT = {
  ...BASE, presion: true,
  campos: [{ clave: "condicion", etiqueta: "Condición de calibración", opciones: ["Para contener", "Para verter"] }],
};
const FUERZA: FormatoIT = {
  ...BASE,
  campos: [{ clave: "sentido", etiqueta: "Calibración efectuada en", opciones: ["TRACCIÓN", "COMPRESIÓN"] }],
  frases: [PUNTOS_CLIENTE, "No se efectuó determinación de error de reversibilidad.", "\"-.-\" = No aplica."],
};
const LONGITUD: FormatoIT = {
  ...BASE, campos: [ACCESORIOS],
  hojaResultados: [["item", "Descripción del ítem"], ["rango", "Rango nominal"], ["res", "Resolución"]],
};

/** Formato por código de proceso (ITV02a/g/c comparten el de ITV02). Sin entrada: el formato base. */
export const FORMATOS_IT: Record<string, FormatoIT> = {
  ITM01: MASAS,
  ITM03: MASAS,
  ITM02: { ...BASE, frases: [PUNTOS_CLIENTE, "Masas utilizadas: según detalle."] },
  ITP01: PRESION,
  ITP02: PRESION,
  ITV02: VOLUMEN,
  ITV05: { ...BASE, presion: true },
  ITF01: FUERZA,
  ITF03: FUERZA,
  ITT01: {
    ...BASE, capacidad: "Rango nominal",
    campos: [{ clave: "division", etiqueta: "Valor división de escala", seccion: "instrumento" }, { clave: "inmersion", etiqueta: "Inmersión y fuente de calor", opciones: ["Total · Calibración en baño generador de temperatura", "Parcial · Calibración en baño generador de temperatura"] }],
  },
  ITT02: {
    ...BASE, capacidad: "Rango total", rango: "Rango o puntos calibrados", sujeto: "el calibrando",
    campos: [{ clave: "condicion", etiqueta: "Condición de la calibración", opciones: ["Sin carga", "Con carga"] }],
    hojaResultados: [["item", "Descripción del ítem"], ["cap", "Rango total"], ["res", "Resolución"]],
    frases: [PUNTOS_CLIENTE, "Dimensiones de la cámara … × … × … mm · Volumen … litros · Espacio de trabajo … litros."],
  },
  ITL01: LONGITUD,
  ITL02: LONGITUD,
  ITL05: LONGITUD,
  ITL06: { ...LONGITUD, frases: [PUNTOS_CLIENTE, "Se usó como cero de referencia el borde extremo del inicio de la graduación."] },
  ITL07: LONGITUD,
  ITL10: LONGITUD,
  ITPT01: { ...BASE, clase: "Clasificación", campos: [ACCESORIOS] },
};

export function formatoDe(proceso: string | null | undefined): FormatoIT {
  const c = String(proceso ?? "");
  return FORMATOS_IT[c] ?? FORMATOS_IT[c.replace(/[a-z]$/, "")] ?? BASE;
}

/** Claves de condición admitidas para el proceso (las demás se rechazan al guardar). */
export function clavesCampos(proceso: string | null | undefined): string[] {
  return formatoDe(proceso).campos.map((c) => c.clave);
}
