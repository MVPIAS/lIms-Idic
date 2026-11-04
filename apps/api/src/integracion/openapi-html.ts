/**
 * Versión legible (HTML imprimible) de la especificación OpenAPI, para entregar
 * la documentación de la API como documento (contrato §4.7.4) · regla PURA,
 * probada en openapi.spec.ts. La genera `src/cli/exportar-openapi.ts`.
 */

const VERBOS = ["get", "post", "put", "patch", "delete"] as const;

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Convierte las marcas mínimas de las descripciones (`código`, **negrita**) a HTML. */
function marcas(texto: string): string {
  return esc(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, " ");
}

export interface OperacionPlana {
  modulo: string;
  verbo: string;
  ruta: string;
  resumen: string;
  permisos: string[];
  publica: boolean;
  parametros: { nombre: string; en: string; obligatorio: boolean }[];
  tieneCuerpo: boolean;
}

/** Operaciones del documento agrupadas por módulo, en el orden de `tags`. */
export function operacionesPorModulo(doc: any): { modulo: string; descripcion: string; operaciones: OperacionPlana[] }[] {
  const grupos = new Map<string, OperacionPlana[]>();
  for (const [ruta, item] of Object.entries<any>(doc?.paths ?? {})) {
    for (const verbo of VERBOS) {
      const op = item?.[verbo];
      if (!op) continue;
      const modulo = op.tags?.[0] ?? "Otros";
      const lista = grupos.get(modulo) ?? [];
      lista.push({
        modulo,
        verbo: verbo.toUpperCase(),
        ruta,
        resumen: op.summary ?? "",
        permisos: Array.isArray(op["x-permisos"]) ? op["x-permisos"] : [],
        publica: Array.isArray(op.security) && op.security.length === 0,
        parametros: (op.parameters ?? []).map((p: any) => ({ nombre: p.name, en: p.in, obligatorio: !!p.required })),
        tieneCuerpo: !!op.requestBody,
      });
      grupos.set(modulo, lista);
    }
  }
  const orden: { name: string; description?: string }[] = doc?.tags ?? [];
  const nombres = [...orden.map((t) => t.name), ...[...grupos.keys()].filter((k) => !orden.some((t) => t.name === k))];
  return nombres
    .filter((n) => grupos.has(n))
    .map((n) => ({
      modulo: n,
      descripcion: orden.find((t) => t.name === n)?.description ?? "",
      operaciones: grupos.get(n)!.sort((a, b) => a.ruta.localeCompare(b.ruta) || a.verbo.localeCompare(b.verbo)),
    }));
}

const EN: Record<string, string> = { path: "ruta", query: "consulta", header: "cabecera" };

/** Documento HTML completo (autocontenido, sin recursos externos). */
export function documentoHtml(doc: any, generado: string): string {
  const modulos = operacionesPorModulo(doc);
  const total = modulos.reduce((s, m) => s + m.operaciones.length, 0);
  const indice = modulos
    .map((m, i) => `<li><a href="#m${i}">${esc(m.modulo)}</a> <span class="n">(${m.operaciones.length})</span></li>`)
    .join("");
  const cuerpo = modulos
    .map((m, i) => {
      const filas = m.operaciones
        .map((o) => {
          const params = o.parametros.length
            ? o.parametros.map((p) => `<code>${esc(p.nombre)}</code> <small>${esc(EN[p.en] ?? p.en)}${p.obligatorio ? ", obligatorio" : ""}</small>`).join("<br>")
            : "—";
          const permiso = o.publica ? "<i>Público</i>" : o.permisos.length ? o.permisos.map((p) => `<code>${esc(p)}</code>`).join(" ") : "<i>Solo autenticación</i>";
          return `<tr><td class="v v-${o.verbo.toLowerCase()}">${o.verbo}</td><td><code>${esc(o.ruta)}</code><div class="r">${esc(o.resumen)}</div></td><td>${params}${o.tieneCuerpo ? "<br><small>Cuerpo JSON</small>" : ""}</td><td>${permiso}</td></tr>`;
        })
        .join("");
      return `<section id="m${i}"><h2>${esc(m.modulo)}</h2>${m.descripcion ? `<p class="d">${esc(m.descripcion)}</p>` : ""}<table><thead><tr><th>Método</th><th>Ruta y descripción</th><th>Parámetros</th><th>Permiso</th></tr></thead><tbody>${filas}</tbody></table></section>`;
    })
    .join("");
  const titulo = esc(doc?.info?.title ?? "API");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
body{font-family:Inter,'Segoe UI',Arial,sans-serif;color:#18212f;margin:0 auto;max-width:1100px;padding:24px 16px;font-size:13px;line-height:1.5}
h1{font-size:22px;margin:0 0 4px;color:#12343f}h2{font-size:16px;margin:26px 0 4px;color:#12343f;border-bottom:2px solid #008c9e;padding-bottom:3px}
.meta{color:#5f6b7a;font-size:12px}.d{color:#5f6b7a;margin:2px 0 8px}.n{color:#5f6b7a}
table{width:100%;border-collapse:collapse;font-size:12px}th{background:#eef3f7;text-align:left;padding:6px 8px;font-size:10.5px;text-transform:uppercase;color:#5f6b7a}
td{padding:6px 8px;border-bottom:1px solid #e3e9ee;vertical-align:top}.r{color:#5f6b7a;margin-top:2px}
code{font-family:Consolas,monospace;font-size:11.5px;color:#12343f}
.v{font-weight:700;font-family:Consolas,monospace;width:58px}.v-get{color:#1c4ba6}.v-post{color:#155e3d}.v-put,.v-patch{color:#7a4b00}.v-delete{color:#7d1f1f}
ul.indice{columns:3;font-size:12px}@media(max-width:700px){ul.indice{columns:1}}
@media print{h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>${titulo}</h1>
<div class="meta">Versión ${esc(doc?.info?.version ?? "")} · ${total} operaciones · generado el ${esc(generado)}</div>
<p>${marcas(doc?.info?.description ?? "")}</p>
<h2>Índice de módulos</h2><ul class="indice">${indice}</ul>
${cuerpo}
</body></html>
`;
}
