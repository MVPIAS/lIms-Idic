import { INFORMES, armarConsulta, informePorClave, totales, validarFiltros, LIMITE_FILAS } from "./catalogo";
import { DOCUMENTOS_LEGADO } from "./legado-documentos";

const T = "00000000-0000-0000-0000-000000000001";
const LAB = "11111111-2222-3333-4444-555555555555";

describe("Zona de informes · catálogo", () => {
  it("claves únicas, columnas con alias en el SELECT y archivos del sistema anterior", () => {
    const claves = INFORMES.map((i) => i.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const i of INFORMES) {
      // Reemplaza un informe Crystal o responde a un pedido escrito (documento Z26).
      expect(i.legado.length > 0 || !!i.pedido).toBe(true);
      for (const c of i.columnas) expect(i.select).toMatch(new RegExp(`AS ${c.clave}\\b`));
    }
  });

  it("cubre los documentos por OT del sistema anterior por tipo", () => {
    expect(Object.keys(DOCUMENTOS_LEGADO)).toEqual(expect.arrayContaining(["CERTIFICADO", "I.ENSAYO", "IVC", "BOLETIN"]));
  });
});

describe("Zona de informes · filtros", () => {
  const ot = informePorClave("ot-listado")!;
  it("acepta filtros válidos y rechaza formatos inválidos", () => {
    expect(validarFiltros(ot, { desde: "2026-01-01", hasta: "2026-12-31", laboratorio: LAB, estado: "cerrada", texto: "ACME" })).toEqual({
      filtros: { desde: "2026-01-01", hasta: "2026-12-31", laboratorio: LAB, estado: "cerrada", texto: "ACME" },
    });
    expect(validarFiltros(ot, { desde: "01-01-2026" })).toHaveProperty("error");
    expect(validarFiltros(ot, { desde: "2026-02-01", hasta: "2026-01-01" })).toHaveProperty("error");
    expect(validarFiltros(ot, { laboratorio: "1; DROP TABLE x" })).toHaveProperty("error");
    expect(validarFiltros(ot, { estado: "cerrada' OR 1=1" })).toHaveProperty("error");
  });
  it("rechaza filtros que el informe no admite", () => {
    expect(validarFiltros(informePorClave("catalogo-ensayos")!, { desde: "2026-01-01" })).toHaveProperty("error");
  });
});

describe("Zona de informes · consulta", () => {
  it("la entrada del usuario va siempre como parámetro", () => {
    const def = informePorClave("ot-listado")!;
    const { sql, args } = armarConsulta(def, { desde: "2026-01-01", texto: "x' OR '1'='1", laboratorio: LAB }, T, null);
    expect(sql).not.toContain("x' OR");
    expect(sql).not.toContain(LAB);
    expect(args).toEqual([T, "2026-01-01", LAB, "%x' OR '1'='1%"]);
    expect(sql).toContain(`LIMIT ${LIMITE_FILAS + 1}`);
  });
  it("escapa comodines del texto buscado", () => {
    const { args } = armarConsulta(informePorClave("ot-listado")!, { texto: "50%_a" }, T, null);
    expect(args[1]).toBe("%50\\%\\_a%");
  });
  it("aplica el alcance por laboratorio salvo a perfiles globales y al catálogo común", () => {
    const def = informePorClave("facturas")!;
    expect(armarConsulta(def, {}, T, null).sql).not.toContain("ANY(");
    const r = armarConsulta(def, {}, T, [LAB]);
    expect(r.sql).toContain("o.unidad_principal = ANY($2::uuid[])");
    expect(r.args[1]).toEqual([LAB]);
    expect(armarConsulta(informePorClave("catalogo-ensayos")!, {}, T, [LAB]).sql).not.toContain("ANY(");
  });
  it("todas las consultas se arman con todos sus filtros", () => {
    for (const def of INFORMES) {
      const f = validarFiltros(def, {
        ...(def.filtros.includes("fecha") ? { desde: "2026-01-01", hasta: "2026-12-31" } : {}),
        ...(def.filtros.includes("laboratorio") ? { laboratorio: LAB } : {}),
        ...(def.filtros.includes("estado") ? { estado: "cerrada" } : {}),
        ...(def.filtros.includes("texto") ? { texto: "a" } : {}),
      });
      expect(f).toHaveProperty("filtros");
      const { sql } = armarConsulta(def, (f as any).filtros, T, [LAB]);
      expect(sql).toMatch(/^SELECT .* FROM .* WHERE /s);
    }
  });
});

describe("Zona de informes · bases del documento Z26 (frente S4)", () => {
  const z26 = ["z26-cotizaciones", "z26-ot-externas", "z26-ot-internas", "z26-ensayos", "z26-ensayos-por-ot", "z26-costo-cotizado-real",
    "z26-recursos-ot", "z26-equipos", "z26-personal", "z26-insumos", "z26-vehiculos", "inventario-bodega", "consumos-valorizados"];
  it("están todas en el catálogo, en su área", () => {
    for (const c of z26) expect(informePorClave(c)?.area).toBe("Bases de datos y costos (Z26)");
  });
  it("cubren los campos de la planilla «Filtros para exportar información»", () => {
    const titulos = (c: string) => informePorClave(c)!.columnas.map((x) => x.titulo).join(" | ");
    for (const t of ["N° cotización", "Requirente", "Tipo de requirente", "Laboratorio o sucursal", "Fecha de creación", "Plazo", "Estado de la OT",
      "Ensayo o detalle del trabajo", "Precio cotizado", "Considera OT internas", "N° factura", "Fecha factura", "Monto factura", "Analista responsable SVT"])
      expect(titulos("z26-cotizaciones")).toContain(t);
    for (const t of ["N° OT", "Fecha de solicitud", "Fecha de aceptación", "Estado cotización", "Clasificación", "OT internas asociadas"])
      expect(titulos("z26-ot-externas")).toContain(t);
    for (const t of ["N° OT interna", "Laboratorio o sucursal requirente", "Costo real", "N° factura"]) expect(titulos("z26-ot-internas")).toContain(t);
    for (const t of ["Código ensayo", "Nombre ensayo", "Laboratorio asociado", "Equipos y maquinarias", "Personal requerido", "Insumos y accesorios", "Vehículos requeridos"])
      expect(titulos("z26-ensayos")).toContain(t);
  });
  it("el costo cotizado frente al real trae semáforo y queda acotado a los laboratorios del usuario", () => {
    const def = informePorClave("z26-costo-cotizado-real")!;
    expect(def.permiso).toBe("costo_real.ver");
    expect(def.select).toMatch(/'rojo'/);
    const { sql, args } = armarConsulta(def, { estado: "cerrada" }, T, [LAB]);
    expect(sql).toContain("o.unidad_principal = ANY($3::uuid[])");
    expect(sql).toContain("parametro_sistema");
    expect(args).toEqual([T, "cerrada", [LAB]]);
  });
  it("la bodega central se ve desde cualquier laboratorio; las sub-bodegas, solo desde el suyo", () => {
    const { sql } = armarConsulta(informePorClave("inventario-bodega")!, {}, T, [LAB]);
    expect(sql).toContain("b.unidad_id = ANY($2::uuid[]) OR b.tipo = 'central'");
  });
});

describe("Zona de informes · totales", () => {
  it("suma solo las columnas con total", () => {
    const def = informePorClave("ot-cc-estado")!;
    expect(totales(def, [{ cantidad: 2, monto: "1000.5" }, { cantidad: 3, monto: null }])).toEqual({ cantidad: 5, monto: 1000.5 });
  });
});
