/**
 * Motor de plantillas del LIMS IDIC.
 *
 * Sustituye en el CUERPO de la plantilla (`plantilla_informe.cuerpo_html`):
 *   · `{{ruta.punteada}}`      -> valor del contexto, SIEMPRE escapado
 *   · `{{tabla_resultados}}`   -> bloque HTML generado por el motor
 *   · `{{#si ruta}}…{{/si}}`   -> condicional (y su negado `{{#no ruta}}…{{/no}}`)
 *
 * ---------------------------------------------------------------------------
 * MODELO DE CONFIANZA (esto va a pentesting)
 * ---------------------------------------------------------------------------
 * · El CUERPO de la plantilla es contenido de confianza: lo siembra
 *   `align_certificado.sql` y solo lo edita quien tiene `plantilla.gestionar`.
 *   Por eso se emite tal cual (permite maquetar tablas, divs, clases).
 * · Los DATOS (cliente, OT, muestras, resultados) NO son de confianza: los
 *   teclea cualquiera con permiso de captura. Todo valor pasa por `escapeHtml`.
 * · Sustitución en UNA SOLA PASADA (`String.replace` con función): el texto
 *   inyectado NO se vuelve a escanear. Un cliente llamado
 *   `{{tabla_resultados}}` o `{{cliente.rut}}` se imprime literal, no se
 *   re-expande. El bucle de `replaceAll` que había antes sí era re-entrante.
 * · Los condicionales se resuelven ANTES de la sustitución y solo sobre el
 *   cuerpo (confiable), así que un dato no puede abrir/cerrar un bloque.
 * · Defensa adicional en la UI: la previsualización va en un <iframe sandbox>
 *   sin allow-scripts, así que ni un cuerpo malicioso ejecutaría JS.
 */
import { escapeHtml, fmtFecha, fmtFechaHora, fmtNum } from "./html.util";

/** Contexto de datos del expediente sobre el que se resuelven las rutas. */
export type ContextoInforme = Record<string, unknown>;

export type ResultadoRender = {
  html: string;
  /** Placeholders del cuerpo que no existen en el contexto (se emiten vacíos). */
  faltantes: string[];
};

/**
 * `{{ ruta.punteada }}`. Solo letras, dígitos, `_` y `.`: una ruta no puede
 * traer paréntesis ni espacios, así que no hay superficie de expresión.
 */
const TOKEN = /\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*\}\}/g;

/** `{{#si ruta}}…{{/si}}` / `{{#no ruta}}…{{/no}}`. Sin anidado en la misma pasada. */
const CONDICIONAL = /\{\{#(si|no)\s+([A-Za-z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\/\1\}\}/;

/** Claves prohibidas: cierran el paso a un prototype-pollution vía plantilla. */
const CLAVES_VETADAS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Resuelve `a.b.c` sobre el contexto. Devuelve `undefined` si el camino se corta
 * o si toca una clave vetada. No invoca funciones ni getters de prototipo:
 * solo lee propiedades propias de objetos planos.
 */
export function resolverRuta(ctx: ContextoInforme, ruta: string): unknown {
  let actual: unknown = ctx;
  for (const parte of ruta.split(".")) {
    if (CLAVES_VETADAS.has(parte)) return undefined;
    if (actual === null || actual === undefined) return undefined;
    if (typeof actual !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(actual, parte)) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/**
 * Convierte un valor del contexto a texto imprimible.
 * Date -> dd-mm-aaaa; Prisma.Decimal (objeto con toString) -> número es-CL.
 * Un objeto/array NO se imprime (evita el clásico "[object Object]" en un
 * documento con valor legal): se devuelve cadena vacía.
 */
function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return fmtFecha(valor);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "number") return fmtNum(valor);
  if (typeof valor === "object") {
    // Prisma.Decimal y similares: objeto con toString propio y no el de Object.
    const s = Object.prototype.toString.call(valor);
    if (s === "[object Object]" && typeof (valor as any).toFixed === "function") {
      return fmtNum(String(valor));
    }
    if (s === "[object Object]" && (valor as any).constructor?.name === "Decimal") {
      return fmtNum(String(valor));
    }
    return "";
  }
  return String(valor);
}

/** ¿La ruta cuenta como "presente" para `{{#si}}`? */
function esVerdadero(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === false) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  if (typeof valor === "number") return !Number.isNaN(valor);
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

/**
 * Expande `{{#si}}` / `{{#no}}` de dentro hacia fuera.
 * El límite de iteraciones evita un bucle infinito si una plantilla llegara a
 * construir un condicional patológico.
 */
function expandirCondicionales(cuerpo: string, ctx: ContextoInforme): string {
  let out = cuerpo;
  for (let i = 0; i < 100; i++) {
    const m = CONDICIONAL.exec(out);
    if (!m) break;
    const [completo, tipo, ruta, interior] = m;
    const presente = esVerdadero(resolverRuta(ctx, ruta));
    const conservar = tipo === "si" ? presente : !presente;
    out = out.replace(completo, conservar ? interior : "");
  }
  return out;
}

/**
 * Renderiza el cuerpo de la plantilla contra el contexto.
 *
 * @param cuerpo   HTML de la plantilla (confiable).
 * @param ctx      Datos del expediente (NO confiables -> escapados).
 * @param bloques  HTML crudo generado por el motor (tablas). Sus celdas ya van
 *                 escapadas; se inyecta sin escapar a propósito.
 */
export function renderizar(
  cuerpo: string,
  ctx: ContextoInforme,
  bloques: Record<string, string> = {},
): ResultadoRender {
  const faltantes = new Set<string>();
  const conCondicionales = expandirCondicionales(cuerpo, ctx);

  // UNA sola pasada: lo sustituido no se re-escanea.
  const html = conCondicionales.replace(TOKEN, (_m, ruta: string) => {
    if (Object.prototype.hasOwnProperty.call(bloques, ruta)) return bloques[ruta];
    const valor = resolverRuta(ctx, ruta);
    if (valor === undefined) {
      faltantes.add(ruta);
      return "";
    }
    return escapeHtml(aTexto(valor));
  });

  return { html, faltantes: [...faltantes] };
}

/* ========================================================================== */
/* Bloques generados: tablas                                                   */
/* ========================================================================== */

/** Fila de resultado ya normalizada para la tabla del informe. */
export type FilaResultado = {
  analito: string;
  muestra: string;
  unidad: string;
  promedio: string;
  desviacion: string;
  cv: string;
  limite: string;
  veredicto: string;
};

const GUION = "—";

/** Celda: escapa y sustituye el vacío por un guion (una celda en blanco es ambigua). */
function celda(v: string, clase = ""): string {
  const texto = v && v.trim() !== "" ? escapeHtml(v) : GUION;
  return `<td${clase ? ` class="${clase}"` : ""}>${texto}</td>`;
}

/**
 * `{{tabla_resultados}}`: analito, muestra, unidad, promedio, DE, CV, límite y
 * veredicto. El veredicto se pinta como pastilla para que se lea de un vistazo
 * en el PDF impreso.
 */
export function tablaResultados(filas: FilaResultado[]): string {
  if (filas.length === 0) {
    return `<table class="rep"><tbody><tr><td class="vacio">Sin resultados registrados para esta orden de trabajo.</td></tr></tbody></table>`;
  }
  const cuerpo = filas
    .map((f) => {
      const v = (f.veredicto ?? "").toLowerCase();
      const clase = v.startsWith("cumple") ? "ok" : v ? "no" : "";
      return (
        "<tr>" +
        celda(f.analito) +
        celda(f.muestra) +
        celda(f.unidad) +
        celda(f.promedio, "num") +
        celda(f.desviacion, "num") +
        celda(f.cv, "num") +
        celda(f.limite) +
        `<td class="${clase}">${f.veredicto ? escapeHtml(f.veredicto) : GUION}</td>` +
        "</tr>"
      );
    })
    .join("");
  return (
    `<table class="rep"><thead><tr>` +
    `<th>Analito / Ensayo</th><th>Muestra</th><th>Unidad</th>` +
    `<th class="num">Promedio</th><th class="num">DE</th><th class="num">CV %</th>` +
    `<th>Límite</th><th>Veredicto</th>` +
    `</tr></thead><tbody>${cuerpo}</tbody></table>`
  );
}

export type FilaMuestra = {
  codigo: string;
  nombre: string;
  tipo: string;
  estado: string;
};

/** `{{tabla_muestras}}`: identificación de las muestras del expediente. */
export function tablaMuestras(filas: FilaMuestra[]): string {
  if (filas.length === 0) {
    return `<table class="rep"><tbody><tr><td class="vacio">Sin muestras asociadas a esta orden de trabajo.</td></tr></tbody></table>`;
  }
  const cuerpo = filas
    .map(
      (f) =>
        "<tr>" + celda(f.codigo) + celda(f.nombre) + celda(f.tipo) + celda(f.estado) + "</tr>",
    )
    .join("");
  return (
    `<table class="rep"><thead><tr>` +
    `<th>Código</th><th>Descripción</th><th>Tipo</th><th>Estado</th>` +
    `</tr></thead><tbody>${cuerpo}</tbody></table>`
  );
}

export { escapeHtml, fmtFecha, fmtFechaHora, fmtNum };
