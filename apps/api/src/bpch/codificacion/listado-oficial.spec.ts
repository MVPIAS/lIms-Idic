import { agruparListado, csvListado, entraEnListado, htmlListado, type ProductoListado } from "./listado-oficial";

const p = (x: Partial<ProductoListado>): ProductoListado => ({
  listado: "EXPLOSIVOS",
  estado: "VIGENTE",
  cnc: "E-I/21/1/2/3/4",
  fabricanteNombre: "Fabricante Prueba",
  fabricanteRut: "11.111.111-1",
  grupoListado: "21 Semigelatina granulada",
  elementoGenerico: "Familia Prueba",
  producto: "Producto Prueba",
  claseDivisionUn: "1.1D",
  numeroUn: "0081",
  eqDin60: 0.53,
  ptnPin: "PTN",
  ...x,
});

describe("EP-09 9.16 · listado oficial de Codificación Única", () => {
  it("vigentes por listado; en receso reúne los dos listados", () => {
    expect(entraEnListado({ listado: "EXPLOSIVOS", estado: "VIGENTE" }, "EXPLOSIVOS")).toBe(true);
    expect(entraEnListado({ listado: "EXPLOSIVOS", estado: "EN_RECESO" }, "EXPLOSIVOS")).toBe(false);
    expect(entraEnListado({ listado: "SUSTANCIAS_QUIMICAS", estado: "EN_RECESO" }, "EN_RECESO")).toBe(true);
    expect(entraEnListado({ listado: "SUSTANCIAS_QUIMICAS", estado: "VIGENTE" }, "EXPLOSIVOS")).toBe(false);
  });

  it("agrupa por fabricante, grupo y familia, con totales y en orden", () => {
    const s = agruparListado(
      [
        p({ cnc: "E-I/21/1/2/3/9", producto: "B" }),
        p({ cnc: "E-I/21/1/2/3/10", producto: "A" }),
        p({ grupoListado: "1 Dinamitas", elementoGenerico: "Otra" }),
        p({ grupoListado: null, elementoGenerico: null, producto: "Suelto" }),
        p({ fabricanteNombre: "Alfa Prueba", fabricanteRut: null }),
        p({ estado: "EN_RECESO" }),
      ],
      "EXPLOSIVOS",
    );
    expect(s.map((x) => x.fabricante)).toEqual(["Alfa Prueba", "Fabricante Prueba"]);
    const f = s[1];
    expect(f.total).toBe(4);
    expect(f.grupos.map((g) => g.grupo)).toEqual(["1 Dinamitas", "21 Semigelatina granulada", "Sin grupo asignado"]);
    expect(f.grupos[1].familias[0].productos.map((x) => x.cnc)).toEqual(["E-I/21/1/2/3/9", "E-I/21/1/2/3/10"]);
    expect(f.grupos[2].familias[0].familia).toBe("Suelto");
  });

  it("el documento lleva encabezado DGMN, título, fabricante, fecha de edición, columnas y las dos firmas", () => {
    const html = htmlListado(agruparListado([p({})], "EXPLOSIVOS"), "EXPLOSIVOS", "2026-10-22", {
      subdirector: "Subdirector del Banco de Pruebas de Chile",
      dgmn: "Jefe Depto. Control de Armas y Explosivos",
    });
    expect(html).toContain("REPÚBLICA DE CHILE · MINISTERIO DE DEFENSA NACIONAL");
    expect(html).toContain("LISTADO DE EXPLOSIVOS DE PRODUCCIÓN NACIONAL, CON CODIFICACIÓN ÚNICA");
    expect(html).toContain("Fecha de edición: 22-10-2026");
    expect(html).toContain("EQ.DIN 60 %");
    expect(html).toContain("0,53");
    expect(html).toContain("Jefe Depto. Control de Armas y Explosivos");
    expect(html).toContain("Total de elementos de la familia: 1");
  });

  it("sustancias químicas usan SQN; listado vacío lo dice; escapa el HTML", () => {
    const html = htmlListado(agruparListado([p({ listado: "SUSTANCIAS_QUIMICAS", producto: "<b>x</b>" })], "SUSTANCIAS_QUIMICAS"), "SUSTANCIAS_QUIMICAS", "2026-10-22", { subdirector: "S", dgmn: "D" });
    expect(html).toContain("SQN");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(htmlListado([], "EN_RECESO", "2026-10-22", { subdirector: "S", dgmn: "D" })).toContain("No hay productos");
  });

  it("Excel: BOM, punto y coma, coma decimal y comillas cuando hace falta", () => {
    const csv = csvListado(agruparListado([p({ producto: 'Tronex "Plus"; 1 x 8' })], "EXPLOSIVOS"));
    expect(csv.startsWith("﻿Fabricante;RUT;Grupo")).toBe(true);
    expect(csv).toContain('"Tronex ""Plus""; 1 x 8"');
    expect(csv).toContain(";0,53;PTN;");
  });
});

describe("B-077 · el listado oficial se exporta a .xlsx", () => {
  const { xlsxListado } = require("./listado-oficial");
  const { leerXlsx } = require("../../common/tabla-archivo");
  it("es un libro Excel con cabecera y una fila por producto", () => {
    const b: Buffer = xlsxListado(agruparListado([p({}), p({ producto: "Otro producto", cnc: "E-I/21/1/2/3/5" })], "EXPLOSIVOS"));
    expect(b.subarray(0, 2).toString("latin1")).toBe("PK");
    const filas = leerXlsx(b);
    expect(filas[0].slice(0, 3)).toEqual(["Fabricante", "RUT", "Grupo"]);
    expect(filas.length).toBe(3);
    expect(filas.some((f: string[]) => f.includes("Otro producto"))).toBe(true);
  });
});
