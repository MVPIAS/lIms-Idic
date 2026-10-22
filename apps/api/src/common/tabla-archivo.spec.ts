import { deflateRawSync } from "node:zlib";
import { TablaError, leerTabla, leerTexto } from "./tabla-archivo";

/** ZIP mínimo (sin CRC: el lector no lo comprueba) para armar un .xlsx de prueba. */
function zip(archivos: Record<string, string>, comprimir = true): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const datos = Buffer.from(texto, "utf8");
    const cuerpo = comprimir ? deflateRawSync(datos) : datos;
    const n = Buffer.from(nombre, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(comprimir ? 8 : 0, 8);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(comprimir ? 8 : 0, 10);
    central.writeUInt32LE(cuerpo.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locales.push(local, n, cuerpo);
    centrales.push(central, n);
    offset += 30 + n.length + cuerpo.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 8);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dir.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dir, fin]);
}

const SHARED =
  '<sst><si><t>Tipo</t></si><si><t>Marca</t></si><si><r><t>Nº de </t></r><r><t>serie</t></r></si>' +
  '<si><t>Pistola</t></si><si><t>Marca Prueba &amp; Cía</t></si></sst>';
const HOJA =
  '<worksheet><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
  '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="D2"><v>2</v></c>' +
  '<c r="C2" t="inlineStr"><is><t>PRUEBA0001</t></is></c></row>' +
  '<row r="3"/>' +
  '</sheetData></worksheet>';

describe("leerTabla · Excel .xlsx", () => {
  it("lee la primera hoja con textos compartidos, en línea y números", () => {
    const b = zip({ "xl/sharedStrings.xml": SHARED, "xl/worksheets/sheet1.xml": HOJA, "xl/worksheets/sheet2.xml": "<worksheet/>" });
    expect(leerTabla("armas.xlsx", b)).toEqual([
      ["Tipo", "Marca", "Nº de serie"],
      ["Pistola", "Marca Prueba & Cía", "PRUEBA0001", "2"],
    ]);
  });

  it("acepta entradas sin comprimir y detecta el ZIP aunque el nombre no sea .xlsx", () => {
    const b = zip({ "xl/sharedStrings.xml": SHARED, "xl/worksheets/sheet1.xml": HOJA }, false);
    expect(leerTabla("subido.bin", b)[1][0]).toBe("Pistola");
  });

  it("rechaza un .xlsx que no es ZIP, un .xls antiguo y un archivo enorme", () => {
    expect(() => leerTabla("x.xlsx", Buffer.from("hola"))).toThrow(TablaError);
    expect(() => leerTabla("x.xls", Buffer.from("hola"))).toThrow(/97-2003/);
    expect(() => leerTabla("x.csv", Buffer.alloc(5_000_001, 65))).toThrow(/5 MB/);
  });
});

describe("leerTabla · texto", () => {
  it("detecta tabulador (pegado desde Excel), punto y coma y coma", () => {
    expect(leerTexto("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(leerTexto("a;b\r\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(leerTexto("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("respeta comillas, separadores dentro de comillas y el BOM", () => {
    expect(leerTexto('﻿marca;modelo\n"Marca; Prueba";"Mod ""X"""')).toEqual([
      ["marca", "modelo"],
      ["Marca; Prueba", 'Mod "X"'],
    ]);
  });

  it("descarta filas vacías y recorta espacios", () => {
    expect(leerTabla("a.csv", Buffer.from("a;b\n\n ; \n  x ; y  \n"))).toEqual([["a", "b"], ["x", "y"]]);
  });
});
