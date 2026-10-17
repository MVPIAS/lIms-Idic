import { celdaCsv, csvPlanilla, numeroCl, origenFormula, textoLecturas, textoValor, type EnsayoPlanilla } from "./planilla-calculos";
import { exigeMotivoCorreccion, teniaValor } from "./traza";

const ensayo: EnsayoPlanilla = {
  resultadoId: "r1", muestra: "OT-1-M1", muestraNombre: "Agua", ensayo: "Cobre", metodo: "EN247 · EAA", norma: "NCh 409", unidad: "mg/L",
  estado: "capturado", veredicto: "cumple", campos: [{ nombre: "ppm", unidad: "ppm" }, { nombre: "Fc", unidad: null }],
  lecturas: [{ C1: 0.134, C2: 10 }], replicas: [0.0134], variables: {}, formula: "C1 / C2", formulaOrigen: "catalogo",
  formulaCatalogo: "C1 / C2", formulaAplicada: "C1 / C2", factor: null, valorSinFactor: 0.0134, resultado: "0.0134",
  promedio: 0.0134, desviacion: 0, cv: 0, limiteInf: null, nominal: null, limiteSup: "1", requisito: null,
  analista: "A. P.", revisor: null, aprobador: null, fecha: "2026-10-16T12:00:00Z",
  historial: [
    { fecha: "2026-10-16T12:00:00Z", usuario: "A. P.", campo: "valor_numerico", anterior: 0.02, nuevo: 0.0134, motivo: "Error de digitación", origen: "correccion" },
  ],
};

describe("planilla de registros y cálculos", () => {
  it("números en formato chileno y valores del historial legibles", () => {
    expect(numeroCl(0.0134)).toBe("0,0134");
    expect(numeroCl(null)).toBe("");
    expect(textoValor([12.4, 12.6])).toBe("12,4; 12,6");
    expect(textoValor("7.200000")).toBe("7,2");
    expect(textoValor([{ C1: 1.5 }])).toBe("C1=1,5");
    expect(textoValor(null)).toBe("—");
    expect(textoLecturas([{ C1: 0.156, C2: 1 }, { C1: 0.2, C2: 1 }])).toBe("L1: C1=0,156 C2=1 | L2: C1=0,2 C2=1");
  });
  it("origen de la fórmula: orden si la jefatura la cambió, si no catálogo", () => {
    expect(origenFormula("C1 * 2", "orden", { formula: "C1" })).toBe("orden");
    expect(origenFormula("C1", "orden", { formula: "C1" })).toBe("catalogo");
    expect(origenFormula("C1", "catalogo", null)).toBe("catalogo");
    expect(origenFormula(null, "catalogo", null)).toBe("sin_formula");
  });
  it("celdas CSV seguras para Excel (comillas, punto y coma, fórmulas)", () => {
    expect(celdaCsv("a;b")).toBe('"a;b"');
    expect(celdaCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(celdaCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(celdaCsv("-0,5")).toBe("-0,5");
    expect(celdaCsv("-cmd")).toBe("'-cmd");
    expect(celdaCsv("-1+HYPERLINK(1)")).toBe("'-1+HYPERLINK(1)");
    expect(celdaCsv("-12.5")).toBe("-12.5");
  });
  it("CSV con cálculos e historial, BOM y punto y coma", () => {
    const csv = csvPlanilla("OT-1", [ensayo]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("OT-1-M1;Cobre;EN247 · EAA;NCh 409;mg/L;C1=ppm (ppm) C2=Fc;L1: C1=0,134 C2=10;0,0134");
    expect(csv).toContain("Historial de cambios");
    expect(csv).toContain(";Valor;0,02;0,0134;Error de digitación;Corrección");
  });
});

describe("traza: motivo de corrección", () => {
  it("corregir un valor ya capturado exige motivo; la primera captura y tras devolución no", () => {
    expect(exigeMotivoCorreccion("capturado", true)).toBe(true);
    expect(exigeMotivoCorreccion("pendiente", false)).toBe(false);
    expect(exigeMotivoCorreccion("devuelto", true)).toBe(false);
    expect(teniaValor({ valorNumerico: null, valorTexto: "" })).toBe(false);
    expect(teniaValor({ valorNumerico: "7.2" })).toBe(true);
  });
});
