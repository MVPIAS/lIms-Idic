#!/usr/bin/env node
/**
 * Lista las rutas duplicadas de la API (mismo método HTTP y misma ruta en dos
 * manejadores), leyendo los decoradores de Nest en apps/api/src.
 *
 *   node scripts/rutas-duplicadas.js
 *
 * La ruta se compone del prefijo de @Controller y del de @Get/@Post/… Los
 * parámetros se comparan sin su nombre (/ot/:id y /ot/:otId chocan igual).
 * Sale con código 1 si encuentra alguna.
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..", "apps", "api", "src");
const METODOS = ["Get", "Post", "Put", "Patch", "Delete", "All", "Options", "Head"];

function ficheros(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ficheros(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")) out.push(p);
  }
  return out;
}

/** Primer argumento literal de un decorador: "x", 'x', `x` o vacío. */
function literal(args) {
  const m = /^\s*(["'`])([^"'`]*)\1/.exec(args);
  return m ? m[2] : "";
}

function unir(...partes) {
  const r = "/" + partes.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return r;
}

const rutas = new Map(); // clave → [{ fichero, linea, ruta }]
let total = 0;
for (const f of ficheros(RAIZ)) {
  // Sin comentarios (los JSDoc citan decoradores); se conservan los saltos de línea.
  const src = fs
    .readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");
  if (!src.includes("@Controller(")) continue;
  const re = new RegExp(`@(Controller|${METODOS.join("|")})\\(([^)]*)\\)`, "g");
  let prefijo = null;
  let m;
  while ((m = re.exec(src))) {
    const [, dec, args] = m;
    if (dec === "Controller") { prefijo = literal(args); continue; }
    if (prefijo === null) continue; // decorador fuera de un controlador
    const ruta = unir(prefijo, literal(args));
    const clave = `${dec.toUpperCase()} ${ruta.replace(/:[A-Za-z0-9_]+/g, ":*")}`;
    const linea = src.slice(0, m.index).split("\n").length;
    if (!rutas.has(clave)) rutas.set(clave, []);
    rutas.get(clave).push({ fichero: path.relative(path.join(__dirname, ".."), f).replace(/\\/g, "/"), linea, ruta });
    total++;
  }
}

const dup = [...rutas.entries()].filter(([, v]) => v.length > 1);
console.log(`Rutas de la API: ${total} manejadores, ${rutas.size} rutas distintas.`);
if (!dup.length) {
  console.log("Sin rutas duplicadas.");
  process.exit(0);
}
console.log(`Rutas duplicadas: ${dup.length}`);
for (const [clave, v] of dup) {
  console.log(`  ✗ ${clave}`);
  for (const x of v) console.log(`      ${x.fichero}:${x.linea}  (${x.ruta})`);
}
process.exit(1);
