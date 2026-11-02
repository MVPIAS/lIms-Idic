import { columna, crc32, libroXlsx, nombreHoja } from "./xlsx-escritura";
import { leerXlsx } from "./tabla-archivo";

describe("escritura de Excel (.xlsx)", () => {
  it("se vuelve a leer igual: textos, números, vacíos y caracteres especiales", () => {
    const b = libroXlsx([
      { nombre: "OT por estado", filas: [["Laboratorio", "Estado", "OT"], ["LQC", "cerrada", 3], ["LPN", "en análisis <&> «ñ»", 1.5], ["LME", null, 0]] },
      { nombre: "Otra", filas: [["x"]] },
    ]);
    expect(b.subarray(0, 2).toString()).toBe("PK");
    expect(leerXlsx(b)).toEqual([["Laboratorio", "Estado", "OT"], ["LQC", "cerrada", "3"], ["LPN", "en análisis <&> «ñ»", "1.5"], ["LME", "", "0"]]);
  });
  it("columnas A…Z, AA; nombres de hoja válidos y únicos", () => {
    expect([0, 25, 26, 27, 701].map(columna)).toEqual(["A", "Z", "AA", "AB", "ZZ"]);
    const u = new Set<string>();
    const a = nombreHoja("Facturación / centro de costo [2026]", u);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(a).not.toMatch(/[[\]:*?/\\]/);
    expect(nombreHoja(a, u)).toMatch(/ 2$/);
  });
  it("hoja con autofiltro, anchos y gráfico nativo: partes del paquete y referencias al rango", () => {
    const b = libroXlsx([
      {
        nombre: "Resumen d'OT",
        filas: [["Estado", "Cantidad"], ["abierta", 4], ["cerrada", 2]],
        anchos: [20, 10],
        grafico: { tipo: "columna", titulo: "OT por estado", desde: 1, hasta: 2, categorias: 0, series: [1] },
      },
      { nombre: "Datos", filas: [["a", "b"], [1, 2]], autoFiltro: true },
    ]);
    const s = b.toString("latin1");
    for (const parte of ["xl/charts/chart1.xml", "xl/drawings/drawing1.xml", "xl/drawings/_rels/drawing1.xml.rels", "xl/worksheets/_rels/sheet1.xml.rels"]) expect(s).toContain(parte);
    expect(s).not.toContain("sheet2.xml.rels");
    expect(s).toContain("drawingml.chart+xml");
    expect(s).toContain("'Resumen d''OT'!$A$2:$A$3");
    expect(s).toContain("'Resumen d''OT'!$B$2:$B$3");
    expect(s).toContain('<autoFilter ref="A1:B2"/>');
    expect(s).toContain('<col min="1" max="1" width="20" customWidth="1"/>');
    // El contenido sigue leyéndose igual.
    expect(leerXlsx(b)).toEqual([["Estado", "Cantidad"], ["abierta", "4"], ["cerrada", "2"]]);
  });
  it("torta, barras y líneas; sin series no se dibuja gráfico", () => {
    const base = { nombre: "R", filas: [["k", "v"], ["x", 1]] };
    expect(libroXlsx([{ ...base, grafico: { tipo: "torta", titulo: "T", desde: 1, hasta: 1, categorias: 0, series: [1] } }]).toString("latin1")).toContain("<c:pieChart>");
    expect(libroXlsx([{ ...base, grafico: { tipo: "barra", titulo: "T", desde: 1, hasta: 1, categorias: 0, series: [1] } }]).toString("latin1")).toContain('<c:barDir val="bar"/>');
    expect(libroXlsx([{ ...base, grafico: { tipo: "linea", titulo: "T", desde: 1, hasta: 1, categorias: 0, series: [1] } }]).toString("latin1")).toContain("<c:lineChart>");
    expect(libroXlsx([{ ...base, grafico: { tipo: "columna", titulo: "T", desde: 1, hasta: 1, categorias: 0, series: [] } }]).toString("latin1")).not.toContain("chart1.xml");
  });
  it("CRC-32 estándar", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
