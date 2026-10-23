/**
 * Genera packages/db/seed_lp26_lista_precios_2026.sql e informe-carga.csv a
 * partir de la lista de precios oficial del IDIC 2026 (CSV del 22-10-2026,
 * LISTA_DE_PRECIO_2026_COSTOS_ENSAYOS.csv en esta carpeta).
 *
 *   pnpm --filter @lims-idic/db exec tsx ../../scripts/datos/lista-precios-2026/generar-seed.ts [ruta-al-csv]
 *
 * Reproducible: lee solo el CSV y los seeds del catálogo que ya están en el
 * repositorio (seed_catalogo_v2.sql y seed_r4a_servicios_calibracion.sql) para
 * enlazar cada código EN con su ensayo. Las reglas (lectura, fórmula, centro de
 * costo, enlace) están en apps/api/src/lista-precio/lista-precios-csv.ts.
 *
 * El CSV solo trae precios públicos de servicios: código, nombre, centro de
 * costo y la estructura del precio, que es una función fija del precio
 * particular (CI 20 %, recargo 30 %, IVA 19 %).
 */
import * as fs from "fs";
import * as path from "path";
import {
  CENTROS,
  comprobarFormula,
  decodificarCp1252,
  destinoCentro,
  enlazar,
  leerCsv,
  leerListaPrecios,
  separarDuplicados,
  type EnsayoCatalogo,
  type FilaLista,
} from "../../../apps/api/src/lista-precio/lista-precios-csv";

const AQUI = __dirname;
const RAIZ = path.resolve(AQUI, "..", "..", "..");
const DB = path.join(RAIZ, "packages", "db");
const CSV = process.argv[2] ? path.resolve(process.argv[2]) : path.join(AQUI, "LISTA_DE_PRECIO_2026_COSTOS_ENSAYOS.csv");
const SALIDA_SQL = path.join(DB, "seed_lp26_lista_precios_2026.sql");
const SALIDA_INFORME = path.join(AQUI, "informe-carga.csv");

export const LISTA = {
  codigo: "LP-2026",
  nombre: "Lista de precios 2026",
  desde: "2026-01-01",
  hasta: "2026-12-31",
  fuente: "IDIC · LISTA DE PRECIO 2026 (COSTOS ENSAYOS), 22-10-2026",
};

/* ------------------------------------------------------------- catálogo --- */

function catalogoDelRepo(): EnsayoCatalogo[] {
  const cat: EnsayoCatalogo[] = [];
  // 1 · seed_catalogo_v2.sql: bloque COPY stg_ens (CSV con «,»).
  const v2 = fs.readFileSync(path.join(DB, "seed_catalogo_v2.sql"), "utf8");
  const ini = v2.indexOf("COPY stg_ens (");
  if (ini < 0) throw new Error("seed_catalogo_v2.sql: no se encontró COPY stg_ens");
  const desde = v2.indexOf("\n", ini) + 1;
  const hasta = v2.indexOf("\n\\.", desde);
  for (const r of leerCsv(v2.slice(desde, hasta), ",")) {
    const [codigo, nombre, , codsucdel, agrupado] = r;
    if (codigo) cat.push({ codigo, nombre: nombre ?? "", familia: codsucdel || null, agrupado: agrupado || null });
  }
  // 2 · seed_r4a_servicios_calibracion.sql: servicios de calibración con código EN.
  const r4a = fs.readFileSync(path.join(DB, "seed_r4a_servicios_calibracion.sql"), "utf8");
  const re = /^\s*\('(EN[^']*)',\s*'((?:[^']|'')*)',\s*[\d.]+,\s*'([^']*)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r4a))) {
    if (!cat.some((c) => c.codigo === m![1])) cat.push({ codigo: m[1], nombre: m[2].replace(/''/g, "'"), familia: null, agrupado: m[3] });
  }
  return cat;
}

/* ------------------------------------------------------------------ SQL --- */

const q = (s: string | null | undefined) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

function main() {
  const texto = decodificarCp1252(fs.readFileSync(CSV));
  const { encabezado, filas } = leerListaPrecios(texto);
  if (encabezado[0]?.toUpperCase() !== "CODIGO") throw new Error(`Encabezado inesperado: ${encabezado.join(" | ")}`);
  const ilegibles = filas.filter((f) => f.errores.length);
  if (ilegibles.length) throw new Error(`Filas ilegibles:\n${ilegibles.map((f) => `  ${f.n} ${f.codigoOriginal}: ${f.errores.join("; ")}`).join("\n")}`);

  const { unicas, duplicadas } = separarDuplicados(filas);
  const catalogo = catalogoDelRepo();
  const enlaces = enlazar(unicas, catalogo);
  const catPorCodigo = new Map(catalogo.map((c) => [c.codigo, c]));

  const largos = unicas.filter((f) => (f.nombre ?? "").length > 300);
  if (largos.length) throw new Error(`Nombres de más de 300 caracteres: ${largos.map((f) => f.codigo).join(", ")}`);

  const valores = unicas.map((f) => {
    const d = destinoCentro(f.centro);
    const e = enlaces.get(f.n)!;
    // Calibraciones del área eléctrica (catálogo LMTE): centro LMT · Área Eléctrica.
    const cat = e.catalogo ? catPorCodigo.get(e.catalogo) : null;
    const electrica = f.centro === "LMT" && cat?.agrupado === "LMTE";
    const cc = electrica ? "LMT-AE" : d.centroCosto;
    const un = electrica ? "LMTE" : d.unidad;
    const i = f.importes;
    const descripcion = f.nombre ?? "Sin nombre en la lista oficial (#N/D)";
    return `  (${q(f.codigo)}, ${q(descripcion)}, ${q(f.centroOriginal || null)}, ${q(cc)}, ${q(un)}, ${q(e.catalogo)}, ${q(e.tipo)}, ${i.costoDirecto}, ${i.costoIndirecto}, ${i.costoTotal}, ${i.recargo}, ${i.neto}, ${i.iva}, ${i.precioIvaIncluido})`;
  });

  const sql = `-- =============================================================================
-- seed_lp26_lista_precios_2026.sql · Lista de precios oficial del IDIC 2026
-- (frente lp26). GENERADO por scripts/datos/lista-precios-2026/generar-seed.ts
-- a partir de LISTA_DE_PRECIO_2026_COSTOS_ENSAYOS.csv (22-10-2026). NO editar a mano.
-- -----------------------------------------------------------------------------
-- ${filas.length} filas leídas · ${unicas.length} códigos cargados · ${duplicadas.length} repetidas no cargadas
-- Un ítem por código EN con su estructura de costos: costo directo, indirecto
-- (20 % del CD), total, recargo (30 % del CT), neto, IVA (19 %) y precio
-- particular con IVA. «precio» = neto (precio particular sin IVA): es el que
-- toma la cotización a un cliente particular.
-- Enlace con el catálogo (cat_ensayo) por código EN o por nombre del mismo
-- laboratorio con un único candidato; centro de costo y unidad por el centro
-- del CSV (alias y centros que no existen: informe-carga.csv).
-- Datos reales del IDIC (no de demostración): van en todas las instalaciones.
-- Idempotente: no pisa un ítem ya cargado (precio o enlace ajustados después a
-- mano se respetan); solo completa enlace, centro y unidad que sigan vacíos.
-- =============================================================================

BEGIN;

INSERT INTO lista_precio (tenant_id, codigo, nombre, moneda, vigente_desde, vigente_hasta, activa, fuente)
SELECT t.id, ${q(LISTA.codigo)}, ${q(LISTA.nombre)}, 'CLP', DATE ${q(LISTA.desde)}, DATE ${q(LISTA.hasta)}, TRUE, ${q(LISTA.fuente)}
  FROM tenant t WHERE t.codigo = 'IDIC'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

CREATE TEMP TABLE stg_lp26 (
  codigo text, descripcion text, centro_origen text, centro_costo text, unidad text,
  cat_codigo text, enlace text,
  costo_directo numeric, costo_indirecto numeric, costo_total numeric,
  recargo numeric, neto numeric, iva numeric, precio_iva_incluido numeric
) ON COMMIT DROP;

INSERT INTO stg_lp26 VALUES
${valores.join(",\n")};

INSERT INTO lista_precio_item (id, lista_id, lista_precio_id, codigo, descripcion, cc, tipo, precio,
                               costo_directo, costo_indirecto, costo_total, recargo, neto, iva, precio_iva_incluido,
                               cat_ensayo_id, enlace, centro_costo_id, unidad_id)
SELECT gen_random_uuid(), lp.id, lp.id, s.codigo, s.descripcion, s.centro_origen, 'servicio', s.neto,
       s.costo_directo, s.costo_indirecto, s.costo_total, s.recargo, s.neto, s.iva, s.precio_iva_incluido,
       ce.id, CASE WHEN ce.id IS NULL THEN NULL ELSE s.enlace END,
       (SELECT cc.id FROM centro_costo cc WHERE cc.tenant_id = t.id AND cc.codigo = s.centro_costo AND cc.deleted_at IS NULL LIMIT 1),
       (SELECT u.id FROM unidad u WHERE u.tenant_id = t.id AND u.codigo = s.unidad ORDER BY u.id LIMIT 1)
  FROM stg_lp26 s
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN lista_precio lp ON lp.tenant_id = t.id AND lp.codigo = ${q(LISTA.codigo)}
  LEFT JOIN cat_ensayo ce ON ce.tenant_id = t.id AND ce.codigo = s.cat_codigo AND ce.deleted_at IS NULL
ON CONFLICT (lista_precio_id, codigo) WHERE costo_directo IS NOT NULL DO NOTHING;

-- Completa lo que siga vacío (p. ej. un centro de costo o un ensayo dados de alta después).
UPDATE lista_precio_item i
   SET cat_ensayo_id = ce.id, enlace = s.enlace
  FROM stg_lp26 s
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN lista_precio lp ON lp.tenant_id = t.id AND lp.codigo = ${q(LISTA.codigo)}
  JOIN cat_ensayo ce ON ce.tenant_id = t.id AND ce.codigo = s.cat_codigo AND ce.deleted_at IS NULL
 WHERE i.lista_precio_id = lp.id AND i.codigo = s.codigo AND i.cat_ensayo_id IS NULL AND i.enlace IS NULL;

UPDATE lista_precio_item i
   SET centro_costo_id = cc.id
  FROM stg_lp26 s
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN lista_precio lp ON lp.tenant_id = t.id AND lp.codigo = ${q(LISTA.codigo)}
  JOIN centro_costo cc ON cc.tenant_id = t.id AND cc.codigo = s.centro_costo AND cc.deleted_at IS NULL
 WHERE i.lista_precio_id = lp.id AND i.codigo = s.codigo AND i.centro_costo_id IS NULL;

UPDATE lista_precio_item i
   SET unidad_id = u.id
  FROM stg_lp26 s
  JOIN tenant t ON t.codigo = 'IDIC'
  JOIN lista_precio lp ON lp.tenant_id = t.id AND lp.codigo = ${q(LISTA.codigo)}
  JOIN unidad u ON u.tenant_id = t.id AND u.codigo = s.unidad
 WHERE i.lista_precio_id = lp.id AND i.codigo = s.codigo AND i.unidad_id IS NULL;

COMMIT;
`;
  fs.writeFileSync(SALIDA_SQL, sql, "utf8");

  /* ---------------------------------------------------------------- informe --- */
  const lineas = [
    ["fila", "codigo", "codigo_original", "nombre", "centro_csv", "centro_costo_lims", "unidad_lims", "confianza_centro", "enlace", "ensayo_catalogo", "motivo_enlace", "cuadra_formula", "dif_desde_costo_directo", "observacion"].join(";"),
  ];
  const sinComillas = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  for (const f of filas) {
    const dup = duplicadas.includes(f);
    const d = destinoCentro(f.centro);
    const e = dup ? null : enlaces.get(f.n)!;
    const c = comprobarFormula(f);
    const dif = Object.entries(c.difDesdeCostoDirecto).map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${v}`).join(" ");
    const obs = [
      dup ? `código repetido: no se carga (ya se cargó la fila ${unicas.find((u) => u.codigo === f.codigo)?.n})` : "",
      f.codigoOriginal !== f.codigo ? `código con espacios en la lista («${f.codigoOriginal}»)` : "",
      !f.nombre ? "sin nombre (#N/D)" : "",
      !f.centro ? "sin centro de costo (#N/D)" : "",
      d.confianza !== "exacta" ? d.nota : "",
    ].filter(Boolean).join(" · ");
    lineas.push(
      [f.n, f.codigo, sinComillas(f.codigoOriginal), sinComillas(f.nombre ?? ""), f.centroOriginal, d.centroCosto ?? "", d.unidad ?? "", d.confianza, e?.tipo ?? "", e?.catalogo ?? "", sinComillas(e?.motivo ?? ""), c.cuadra ? "si" : "no", dif, sinComillas(obs)].join(";"),
    );
  }
  fs.writeFileSync(SALIDA_INFORME, "﻿" + lineas.join("\r\n") + "\r\n", "utf8");

  /* --------------------------------------------------------------- resumen --- */
  const porCentro = new Map<string, { filas: number; enlazadas: number; codigo: number; nombre: number; base: number }>();
  for (const f of unicas) {
    const k = f.centroOriginal || "(vacío)";
    const r = porCentro.get(k) ?? { filas: 0, enlazadas: 0, codigo: 0, nombre: 0, base: 0 };
    const e = enlaces.get(f.n)!;
    r.filas++;
    if (e.catalogo) r.enlazadas++;
    if (e.tipo === "codigo") r.codigo++;
    if (e.tipo === "nombre") r.nombre++;
    if (e.tipo === "nombre_base") r.base++;
    porCentro.set(k, r);
  }
  const noCuadran = filas.filter((f) => !comprobarFormula(f).cuadra);
  const exactasCd = filas.filter((f) => Object.keys(comprobarFormula(f).difDesdeCostoDirecto).length === 0).length;
  const exactasPrecio = filas.filter((f) => comprobarFormula(f).exactaDesdePrecio).length;
  console.log(`Filas leídas: ${filas.length} · cargadas: ${unicas.length} · repetidas: ${duplicadas.map((d) => `${d.codigo} (fila ${d.n})`).join(", ") || "ninguna"}`);
  console.log(`Fórmula: ${filas.length - noCuadran.length}/${filas.length} cuadran · exactas desde el precio particular ${exactasPrecio} · exactas desde el costo directo entero ${exactasCd}`);
  if (noCuadran.length) console.log(`No cuadran: ${noCuadran.map((f) => f.codigo).join(", ")}`);
  console.log("Centro      filas  enlazadas (código/nombre/sin método)");
  for (const [k, r] of [...porCentro].sort((a, b) => b[1].filas - a[1].filas))
    console.log(`  ${k.padEnd(10)} ${String(r.filas).padStart(4)}  ${String(r.enlazadas).padStart(4)} (${r.codigo}/${r.nombre}/${r.base})${CENTROS[k] && CENTROS[k].confianza !== "exacta" ? "  · " + CENTROS[k].confianza : !CENTROS[k] ? "  · desconocido" : ""}`);
  console.log(`Escrito: ${path.relative(RAIZ, SALIDA_SQL)} y ${path.relative(RAIZ, SALIDA_INFORME)}`);
}

main();
