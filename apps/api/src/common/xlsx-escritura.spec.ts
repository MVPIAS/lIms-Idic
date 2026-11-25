import { columna, crc32, libroXlsx, nombreHoja, type Celda, type Hoja } from "./xlsx-escritura";
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

  describe("tabla dinámica nativa (PivotTable)", () => {
    /** Partes del ZIP (el escritor usa STORE: el contenido va tal cual). */
    const partes = (b: Buffer) => {
      const m = new Map<string, string>();
      let o = 0;
      while (b.readUInt32LE(o) === 0x04034b50) {
        const tam = b.readUInt32LE(o + 18);
        const ln = b.readUInt16LE(o + 26);
        const lx = b.readUInt16LE(o + 28);
        const nombre = b.subarray(o + 30, o + 30 + ln).toString("utf8");
        m.set(nombre, b.subarray(o + 30 + ln + lx, o + 30 + ln + lx + tam).toString("utf8"));
        o += 30 + ln + lx + tam;
      }
      return m;
    };
    const datos: Celda[][] = [
      ["N° OT", "Laboratorio", "Estado", "Monto", "Cliente"],
      ["OT-PRUEBA-1", "LQC PRUEBA", "abierta", 100, "Cliente PRUEBA A"],
      ["OT-PRUEBA-2", "LPN PRUEBA", "cerrada", 50.5, "Cliente PRUEBA B"],
      ["OT-PRUEBA-3", "LQC PRUEBA", null, 30, "Cliente PRUEBA A"],
      ["OT-PRUEBA-4", "LME <&> PRUEBA", "abierta", null, "Cliente PRUEBA C"],
    ];
    const libro = (tabla: Hoja["tablaDinamica"], extra: Partial<Hoja> = {}) =>
      partes(
        libroXlsx([
          { nombre: "Resumen", filas: [["Laboratorio", "Cantidad"], ["LQC PRUEBA", 2]], grafico: { tipo: "columna", titulo: "PRUEBA", desde: 1, hasta: 1, categorias: 0, series: [1] } },
          { nombre: "Tabla dinámica", filas: [["Nota PRUEBA"]], tablaDinamica: tabla, ...extra },
          { nombre: "Datos", filas: datos, autoFiltro: true },
        ]),
      );

    it("paquete: partes, content types, relaciones del libro, la hoja, la tabla y la caché", () => {
      const p = libro({ origen: "Datos", filas: 1, columnas: 2, valor: 3, agregado: "suma" });
      for (const n of [
        "xl/pivotTables/pivotTable1.xml",
        "xl/pivotTables/_rels/pivotTable1.xml.rels",
        "xl/pivotCache/pivotCacheDefinition1.xml",
        "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels",
        "xl/pivotCache/pivotCacheRecords1.xml",
        "xl/worksheets/_rels/sheet2.xml.rels",
      ])
        expect(p.has(n)).toBe(true);
      const ct = p.get("[Content_Types].xml")!;
      expect(ct).toContain('<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>');
      expect(ct).toContain('<Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>');
      expect(ct).toContain('<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>');
      // workbook.xml → pivotCaches con el rId que apunta a la definición de la caché.
      expect(p.get("xl/workbook.xml")).toContain('<pivotCaches><pivotCache cacheId="1" r:id="rId5"/></pivotCaches>');
      expect(p.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"');
      expect(p.get("xl/_rels/workbook.xml.rels")).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
      // hoja → tabla → definición → registros.
      expect(p.get("xl/worksheets/_rels/sheet2.xml.rels")).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"');
      expect(p.get("xl/pivotTables/_rels/pivotTable1.xml.rels")).toContain('relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"');
      expect(p.get("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels")).toContain('relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"');
      // El gráfico de «Resumen» sigue igual y la hoja de datos no tiene relaciones.
      expect(p.get("xl/worksheets/_rels/sheet1.xml.rels")).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"');
      expect(p.has("xl/charts/chart1.xml")).toBe(true);
      expect(p.has("xl/worksheets/_rels/sheet3.xml.rels")).toBe(false);
    });

    it("caché: rango de la hoja de datos, actualización al abrir, elementos de los ejes y registros", () => {
      const p = libro({ origen: "Datos", filas: 1, columnas: 2, valor: 3, agregado: "suma" });
      const def = p.get("xl/pivotCache/pivotCacheDefinition1.xml")!;
      expect(def).toContain('r:id="rId1" refreshOnLoad="1"');
      expect(def).toContain('recordCount="4"');
      expect(def).toContain('<worksheetSource ref="A1:E5" sheet="Datos"/>');
      expect(def).toContain('<cacheFields count="5">');
      // Ejes con sus elementos ordenados (los vacíos al final); el resto sin elementos.
      expect(def).toContain('<cacheField name="Laboratorio" numFmtId="0"><sharedItems count="3"><s v="LME &lt;&amp;&gt; PRUEBA"/><s v="LPN PRUEBA"/><s v="LQC PRUEBA"/></sharedItems></cacheField>');
      expect(def).toContain('<cacheField name="Estado" numFmtId="0"><sharedItems containsBlank="1" count="3"><s v="abierta"/><s v="cerrada"/><m/></sharedItems></cacheField>');
      expect(def).toContain('<cacheField name="Monto" numFmtId="0"><sharedItems containsString="0" containsBlank="1" containsNumber="1" minValue="30" maxValue="100"/></cacheField>');
      const reg = p.get("xl/pivotCache/pivotCacheRecords1.xml")!;
      expect(reg).toContain('count="4"');
      expect(reg).toContain('<r><s v="OT-PRUEBA-1"/><x v="2"/><x v="0"/><n v="100"/><s v="Cliente PRUEBA A"/></r>');
      expect(reg).toContain('<r><s v="OT-PRUEBA-3"/><x v="2"/><x v="2"/><n v="30"/><s v="Cliente PRUEBA A"/></r>');
      expect(reg).toContain('<r><s v="OT-PRUEBA-4"/><x v="0"/><x v="0"/><m/><s v="Cliente PRUEBA C"/></r>');
    });

    it("tabla: filas, columnas, campo de datos con su subtotal y celdas ya calculadas", () => {
      const p = libro({ origen: "Datos", filas: 1, columnas: 2, valor: 3, agregado: "suma" });
      const t = p.get("xl/pivotTables/pivotTable1.xml")!;
      expect(t).toContain('cacheId="1"');
      expect(t).toContain('<location ref="A3:E8" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>');
      expect(t).toContain('<pivotField axis="axisRow" showAll="0"><items count="4"><item x="0"/><item x="1"/><item x="2"/><item t="default"/></items></pivotField>');
      expect(t).toContain('<pivotField axis="axisCol" showAll="0">');
      expect(t).toContain('<pivotField dataField="1" showAll="0"/>');
      expect(t).toContain('<rowFields count="1"><field x="1"/></rowFields>');
      expect(t).toContain('<colFields count="1"><field x="2"/></colFields>');
      expect(t).toContain('<dataFields count="1"><dataField name="Suma de Monto" fld="3" baseField="0" baseItem="0"/></dataFields>');
      // Valores en la hoja, como los deja Excel (fila 3 en adelante).
      const hoja = p.get("xl/worksheets/sheet2.xml")!;
      expect(hoja).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Suma de Monto</t></is></c>');
      expect(hoja).toContain('<c r="E4" t="inlineStr"><is><t xml:space="preserve">Total general</t></is></c>');
      expect(hoja).toContain('<c r="D4" t="inlineStr"><is><t xml:space="preserve">(en blanco)</t></is></c>');
      expect(hoja).toMatch(/<row r="7"><c r="A7" t="inlineStr"><is><t xml:space="preserve">LQC PRUEBA<\/t><\/is><\/c><c r="B7"><v>100<\/v><\/c><c r="D7"><v>30<\/v><\/c><c r="E7"><v>130<\/v><\/c><\/row>/);
      expect(hoja).toContain('<c r="E8"><v>180.5</v></c>');
      expect(hoja).not.toContain("<pane");
    });

    it("agregados: conteo/promedio/mínimo/máximo; texto con agregado numérico pasa a conteo", () => {
      const p2 = (tabla: Hoja["tablaDinamica"]) => libro(tabla).get("xl/pivotTables/pivotTable1.xml")!;
      const sub = (tabla: Hoja["tablaDinamica"]) => p2(tabla).match(/<dataField [^>]*\/>/)![0];
      expect(sub({ origen: "Datos", filas: 1, valor: 3, agregado: "promedio" })).toContain('name="Promedio de Monto" fld="3" subtotal="average"');
      expect(sub({ origen: "Datos", filas: 1, valor: 3, agregado: "minimo" })).toContain('subtotal="min"');
      expect(sub({ origen: "Datos", filas: 1, valor: 3, agregado: "maximo" })).toContain('subtotal="max"');
      expect(sub({ origen: "Datos", filas: 1, valor: 4, agregado: "suma" })).toContain('name="Cuenta de Cliente" fld="4" subtotal="count"');
      // Conteo sin campo de valor: cuenta un campo sin vacíos (N° OT).
      expect(sub({ origen: "Datos", filas: 2, agregado: "conteo" })).toContain('name="Cuenta de N° OT" fld="0" subtotal="count"');
      const sin = p2({ origen: "Datos", filas: 2 });
      expect(sin).toContain('<location ref="A3:B7" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/>');
      expect(sin).toContain('<colItems count="1"><i/></colItems>');
      expect(sin).not.toContain("<colFields");
    });

    it("sin filas de datos u origen inexistente no se crea la tabla dinámica", () => {
      const vacio = partes(libroXlsx([{ nombre: "TD", filas: [], tablaDinamica: { origen: "Datos", filas: 0 } }, { nombre: "Datos", filas: [["a"]] }]));
      expect([...vacio.keys()].some((k) => k.includes("pivot"))).toBe(false);
      expect(vacio.get("xl/workbook.xml")).not.toContain("pivotCaches");
      const sinOrigen = partes(libroXlsx([{ nombre: "TD", filas: [], tablaDinamica: { origen: "Otra", filas: 0 } }, { nombre: "Datos", filas: datos }]));
      expect([...sinOrigen.keys()].some((k) => k.includes("pivot"))).toBe(false);
    });
  });
});
