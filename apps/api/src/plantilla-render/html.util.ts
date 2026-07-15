/**
 * Utilidades de escapado/formato del motor de informes.
 *
 * Estas funciones son la frontera anti-XSS del renderizador: TODO valor que
 * provenga de la base de datos (razón social, notas de la OT, nombre de analito,
 * unidad…) pasa por `escapeHtml` antes de entrar en el documento. El único HTML
 * crudo que se inyecta es el que genera el propio motor (tablas) — y sus celdas
 * también van escapadas.
 */

/**
 * Escapa los 5 metacaracteres de HTML.
 *
 * Cubre contexto de TEXTO y de ATRIBUTO entrecomillado (por eso `"` y `'`):
 * un valor como `" onload="alert(1)` no puede cerrar un atributo, y
 * `<script>` no puede abrir un elemento.
 *
 * `&` va primero, si no se re-escaparían las entidades ya emitidas
 * (`<` -> `&lt;` -> `&amp;lt;`).
 */
export function escapeHtml(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Decodifica las entidades que produce `escapeHtml` + las usadas en las plantillas. */
export function decodeEntities(texto: string): string {
  return texto
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&deg;/g, "°")
    .replace(/&plusmn;/g, "±")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    // `&amp;` al final: si no, `&amp;lt;` se convertiría en `<`.
    .replace(/&amp;/g, "&");
}

/**
 * Formatea un número (o Prisma.Decimal, que llega como objeto con toString).
 * Coma decimal (es-CL), hasta 4 decimales, sin ceros de relleno a la derecha.
 */
export function fmtNum(valor: unknown, decimales = 4): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const n = typeof valor === "number" ? valor : Number(String(valor));
  if (!Number.isFinite(n)) return String(valor);
  return n
    .toFixed(decimales)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

/** Fecha corta es-CL (dd-mm-aaaa) sin depender del locale del contenedor. */
export function fmtFecha(valor: unknown): string {
  if (!valor) return "";
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return String(valor);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Fecha + hora es-CL (dd-mm-aaaa HH:MM). */
export function fmtFechaHora(valor: unknown): string {
  if (!valor) return "";
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return String(valor);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fmtFecha(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
