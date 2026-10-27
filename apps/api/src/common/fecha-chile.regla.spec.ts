/**
 * Frente f8 · guardián de la regla única de fechas (docs/ZONA_HORARIA.md).
 *
 * Recorre el código de la API y de la web y falla si reaparece un patrón que corta
 * el día o el año en la zona del proceso o en UTC en lugar de en la de Chile:
 *   · `new Date().toISOString().slice(0, 10|7|4)` («hoy» en UTC);
 *   · `getFullYear()`, `getMonth()`, `getDate()`, `getHours()`, `setHours()`,
 *     `setDate()` (hora local del proceso o del navegador);
 *   · `toLocaleDateString(` / `toLocaleTimeString(` sin `timeZone`;
 *   · la zona escrita a mano ("America/Santiago") fuera de los dos ficheros de la regla.
 * Las excepciones van en PERMITIDOS con su motivo.
 */
import * as fs from "fs";
import * as path from "path";

const RAIZ_API = path.join(__dirname, "..");
const RAIZ_WEB = path.join(__dirname, "..", "..", "..", "web");

function ficheros(dir: string, salida: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, salida);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name)) salida.push(p);
  }
  return salida;
}

const REGLAS: { nombre: string; re: RegExp }[] = [
  { nombre: "«hoy» en UTC", re: /new Date\(\)\.toISOString\(\)\.(slice|substring)\(0,\s*(10|7|4)\)/ },
  { nombre: "fecha u hora local del proceso", re: /\.(getFullYear|getMonth|getDate|getHours|setHours|setDate)\(/ },
  { nombre: "toLocaleDateString/TimeString sin timeZone", re: /\.toLocale(Date|Time)String\((?![^)]*timeZone)/ },
  { nombre: "zona escrita a mano", re: /["'`]America\/Santiago["'`]/ },
];

/** fichero (relativo, con /) → reglas que se le permiten y por qué. */
const PERMITIDOS: Record<string, string[]> = {
  // Los dos ficheros de la regla: definen la zona por defecto.
  "api/src/common/fecha-chile.ts": ["zona escrita a mano"],
  "web/lib/fecha-chile.ts": ["zona escrita a mano"],
};

describe("regla única de fechas (frente f8)", () => {
  const todos = [...ficheros(RAIZ_API), ...ficheros(RAIZ_WEB)];

  it("encuentra el código de la API y de la web", () => {
    expect(todos.some((f) => f.endsWith(path.join("common", "fecha-chile.ts")))).toBe(true);
    expect(todos.some((f) => f.endsWith(path.join("lib", "fecha-chile.ts")))).toBe(true);
  });

  it("ningún fichero corta el día o el año fuera de la zona del IDIC", () => {
    const fallos: string[] = [];
    for (const f of todos) {
      const rel = path.relative(path.join(RAIZ_API, ".."), f).split(path.sep).join("/").replace(/^\.\.\//, "");
      const clave = rel.startsWith("web/") ? rel : `api/${rel.replace(/^api\//, "")}`;
      const permitidas = PERMITIDOS[clave] ?? [];
      const lineas = fs.readFileSync(f, "utf8").split("\n");
      lineas.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comentarios
        for (const r of REGLAS) if (r.re.test(l) && !permitidas.includes(r.nombre)) fallos.push(`${clave}:${i + 1} · ${r.nombre} · ${l.trim().slice(0, 120)}`);
      });
    }
    expect(fallos).toEqual([]);
  });
});
