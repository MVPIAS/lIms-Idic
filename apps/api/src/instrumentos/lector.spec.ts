import { decodificar, detectarSeparador, dividirLinea, LecturaError, leerArchivo, normalizarValor, registrosXml } from "./lector";

describe("instrumentos · lector de archivos (§4.4.7)", () => {
  it("CSV con punto y coma, cabecera, comillas y decimal coma (exportación típica en Windows de Chile)", () => {
    const csv = [
      "Equipo;ICP-OES PRUEBA",
      "Muestra;Elemento;Concentración;Unidad;Fecha",
      'OT-2026-0013-M1;"Fe";1,234;mg/L;02-11-2026 10:15',
      "OT-2026-0013-M2;Cu;< 0,05;mg/L;02-11-2026 10:16",
      "",
      "Fin del informe;;;;",
    ].join("\r\n");
    const f = leerArchivo(csv, { formato: "CSV", separador: "auto", decimal: ",", filaCabecera: 2, colMuestra: "Muestra", colEnsayo: "elemento", colValor: "Concentracion", colUnidad: "Unidad", colFecha: "Fecha" });
    expect(f).toEqual([
      { fila: 3, muestra: "OT-2026-0013-M1", ensayo: "Fe", ensayoArchivo: "Fe", valor: "1,234", unidad: "mg/L", fecha: "02-11-2026 10:15", error: null },
      { fila: 4, muestra: "OT-2026-0013-M2", ensayo: "Cu", ensayoArchivo: "Cu", valor: "< 0,05", unidad: "mg/L", fecha: "02-11-2026 10:16", error: null },
      { fila: 6, muestra: "Fin del informe", ensayo: "", ensayoArchivo: "", valor: "", unidad: null, fecha: null, error: "Sin ensayo." },
    ]);
  });

  it("CSV en inglés con coma y decimal punto, columnas por número y equivalencias de nombres", () => {
    const csv = 'Sample ID,Analyte,Result\nM-1,"Moisture, %",12.40\nM-2,Protein,1,234.5\n';
    const f = leerArchivo(csv, {
      formato: "CSV", separador: ",", decimal: ".", filaCabecera: 1, colMuestra: "1", colEnsayo: "2", colValor: "3",
      equivalencias: { "moisture, %": "Humedad", protein: "Proteína cruda" },
    });
    expect(f.map((x) => [x.muestra, x.ensayo, x.valor])).toEqual([["M-1", "Humedad", "12,40"], ["M-2", "Proteína cruda", "1"]]);
    expect(f[0].ensayoArchivo).toBe("Moisture, %");
  });

  it("TXT por columnas con espacios y ensayo fijo del instrumento", () => {
    const txt = "MUESTRA        PH\nOT-1-M1        7.12\nOT-1-M2        6.98\n";
    const f = leerArchivo(txt, { formato: "TXT", separador: "espacios", decimal: ".", filaCabecera: 1, colMuestra: "muestra", colValor: "ph", ensayoFijo: "pH" });
    expect(f.map((x) => [x.muestra, x.ensayo, x.valor])).toEqual([["OT-1-M1", "pH", "7,12"], ["OT-1-M2", "pH", "6,98"]]);
  });

  it("XML con atributos, hijos, espacio de nombres y entidades", () => {
    const xml = `<?xml version="1.0"?><!-- PRUEBA --><ns:Results xmlns:ns="urn:x">
      <ns:Result sample="OT-1-M1"><Analyte>Pb</Analyte><Value>0.012</Value><Unit>mg/kg</Unit></ns:Result>
      <ns:Result sample="OT-1-M2"><Analyte>Cd &amp; Zn</Analyte><Value><![CDATA[< 0.001]]></Value></ns:Result>
      <ns:Result sample="OT-1-M3" analyte="As" value="1.5"/>
    </ns:Results>`;
    expect(registrosXml(xml, "Result")).toHaveLength(3);
    const f = leerArchivo(xml, { formato: "XML", decimal: ".", elementoRegistro: "Result", colMuestra: "@sample", colEnsayo: "Analyte", colValor: "value", colUnidad: "Unit" });
    expect(f.map((x) => [x.muestra, x.ensayo, x.valor, x.unidad])).toEqual([
      ["OT-1-M1", "Pb", "0,012", "mg/kg"],
      ["OT-1-M2", "Cd & Zn", "< 0,001", null],
      ["OT-1-M3", "As", "1,5", null],
    ]);
  });

  it("errores claros cuando el archivo no encaja con el perfil", () => {
    expect(() => leerArchivo("A;B\n1;2", { formato: "CSV", colMuestra: "Muestra", colValor: "B", ensayoFijo: "x" })).toThrow(LecturaError);
    expect(() => leerArchivo("A;B\n1;2", { formato: "CSV", colMuestra: "Muestra", colValor: "B", ensayoFijo: "x" })).toThrow(/Muestra.*A · B/);
    expect(() => leerArchivo("<a/>", { formato: "XML", elementoRegistro: "Result", colMuestra: "s", colValor: "v" })).toThrow(/<Result>/);
  });

  it("separador, comillas, decimales y codificación", () => {
    expect(detectarSeparador("a\tb\tc;d")).toBe("\t");
    expect(detectarSeparador("a b")).toBe("espacios");
    expect(dividirLinea('x;"a;""b""";z', ";")).toEqual(["x", 'a;"b"', "z"]);
    expect(normalizarValor("1.234,5", ",")).toBe("1234,5");
    expect(normalizarValor(">2400", ".")).toBe("> 2400");
    expect(normalizarValor("Ausente", ".")).toBe("Ausente");
    expect(decodificar(Buffer.from([0x43, 0xf3, 0x64]))).toBe("Cód");
    expect(decodificar(Buffer.from("﻿hola", "utf8"))).toBe("hola");
  });
});
