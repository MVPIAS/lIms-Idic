import {
  erroresApertura,
  erroresIvc,
  erroresSeleccion,
  erroresUnidades,
  gradoPropuesto,
  laboratorioDeTerreno,
  pasosTerreno,
  resultadoPorSistema,
} from "./reglas-terreno";
import { mimeAdjunto } from "./terreno.module";

describe("Trabajo en terreno (R10) · apertura", () => {
  it("exige lugar, inicio y tipo de control", () => {
    const e = erroresApertura({});
    expect(e.join(" ")).toMatch(/lugar/);
    expect(e.join(" ")).toMatch(/inicio/);
    expect(e.join(" ")).toMatch(/100 %/);
  });
  it("al 100 % basta con lugar y fecha", () => {
    expect(erroresApertura({ lugar: "PRUEBA · Regimiento", fechaInicio: "2026-11-10", modalidad: "total" })).toEqual([]);
  });
  it("por muestreo exige letra código A–R y número de muestras no mayor que el lote", () => {
    expect(erroresApertura({ lugar: "x", fechaInicio: "2026-11-10", modalidad: "muestreo" })).toHaveLength(2);
    expect(erroresApertura({ lugar: "x", fechaInicio: "2026-11-10", modalidad: "muestreo", letraCodigo: "Z", nMuestras: 3 }).join(" ")).toMatch(/A a la R/);
    expect(erroresApertura({ lugar: "x", fechaInicio: "2026-11-10", modalidad: "muestreo", letraCodigo: "C", nMuestras: 8, tamanoLote: 5 }).join(" ")).toMatch(/superar/);
    expect(erroresApertura({ lugar: "x", fechaInicio: "2026-11-10", modalidad: "muestreo", letraCodigo: "C", nMuestras: 5, tamanoLote: 20 })).toEqual([]);
  });
  it("la fecha de término no es anterior al inicio", () => {
    expect(erroresApertura({ lugar: "x", fechaInicio: "2026-11-10", fechaTermino: "2026-11-09", modalidad: "total" }).join(" ")).toMatch(/término/);
  });
});

describe("Trabajo en terreno · unidades y selección", () => {
  it("vehículo con chasis, motor y año válidos; chasis repetido y año imposible se rechazan", () => {
    expect(erroresUnidades([{ chasis: "PRUEBA-CH1", motor: "M1", anioFabricacion: 2025 }], 2026)).toEqual([]);
    expect(erroresUnidades([{ chasis: "a" }, { chasis: "A" }], 2026).join(" ")).toMatch(/repetido/);
    expect(erroresUnidades([{ chasis: "a", anioFabricacion: 2030 }], 2026).join(" ")).toMatch(/año/);
    expect(erroresUnidades([{}], 2026).join(" ")).toMatch(/chasis, la serie/);
  });
  it("al 100 % todas; por muestreo exactamente n", () => {
    const u = [{ seleccionada: true }, { seleccionada: false }, { seleccionada: true }];
    expect(erroresSeleccion("total", null, u)).toHaveLength(1);
    expect(erroresSeleccion("muestreo", 2, u)).toEqual([]);
    expect(erroresSeleccion("muestreo", 3, u)).toHaveLength(1);
  });
});

describe("Trabajo en terreno · resultado por sistema e IVC", () => {
  const pruebas = [
    { sistema: "Motor", resultado: "cumple" },
    { sistema: "Motor", resultado: "no_aplica" },
    { sistema: "Frenos", resultado: "no_cumple" },
    { sistema: "Dirección", resultado: null },
  ];
  it("resultado por sistema: no cumple si alguna no cumple; pendiente si falta", () => {
    const r = Object.fromEntries(resultadoPorSistema(pruebas).map((x) => [x.sistema, x.resultado]));
    expect(r).toEqual({ Motor: "cumple", Frenos: "no_cumple", "Dirección": "pendiente" });
  });
  it("grado propuesto", () => {
    expect(gradoPropuesto([])).toBeNull();
    expect(gradoPropuesto(pruebas)).toBe("no_cumple");
    expect(gradoPropuesto([{ sistema: "A", resultado: "cumple" }, { sistema: "A", resultado: null }])).toBeNull();
    expect(gradoPropuesto([{ sistema: "A", resultado: "cumple" }])).toBe("cumple");
  });
  it("IVC: todas registradas, grado coherente y hoja de control e IVC adjuntos", () => {
    const e = erroresIvc({ grado: "cumple" }, pruebas, { hoja_control: 0, ivc: 0 }).join(" ");
    expect(e).toMatch(/Faltan 1/);
    expect(e).toMatch(/no puede ser «cumple»/);
    expect(e).toMatch(/hoja de control/);
    expect(e).toMatch(/IVC/);
    expect(erroresIvc({ grado: "no_cumple" }, pruebas.slice(0, 3), { hoja_control: 1, ivc: 1 })).toEqual([]);
  });
});

describe("Trabajo en terreno · pasos", () => {
  const base = { abierto: true, analistas: 0, pruebas: 0, registradas: 0, adjuntos: { protocolo: 0, hoja_control: 0, ivc: 0 }, ivcGrado: null, cerrado: false };
  it("recién abierto: toca asignar", () => {
    const a = pasosTerreno(base);
    expect(a.actual).toBe(2);
    expect(a.pasos[0].estado).toBe("hecho");
  });
  it("lista de chequeo hecha exige la hoja de control adjunta", () => {
    const a = pasosTerreno({ ...base, analistas: 1, pruebas: 3, registradas: 3 });
    expect(a.pasos[3].estado).not.toBe("hecho");
    expect(pasosTerreno({ ...base, analistas: 1, pruebas: 3, registradas: 3, adjuntos: { protocolo: 0, hoja_control: 1, ivc: 0 } }).actual).toBe(5);
  });
  it("completo con IVC y cierre", () => {
    const a = pasosTerreno({ ...base, analistas: 1, pruebas: 1, registradas: 1, adjuntos: { protocolo: 1, hoja_control: 1, ivc: 1 }, ivcGrado: "cumple", cerrado: true });
    expect(a.completo).toBe(true);
  });
});

describe("Trabajo en terreno · laboratorios y adjuntos", () => {
  it("laboratorios por defecto SVM, LAM y SEO", () => {
    expect(laboratorioDeTerreno(null, "svm")).toBe(true);
    expect(laboratorioDeTerreno(null, "LQC")).toBe(false);
    expect(laboratorioDeTerreno("SVM", "LAM")).toBe(false);
  });
  it("tipo del adjunto por su firma", () => {
    expect(mimeAdjunto(Buffer.from("%PDF-1.7"), "x.pdf")).toBe("application/pdf");
    expect(mimeAdjunto(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), "hoja.xlsx")).toMatch(/spreadsheetml/);
    expect(mimeAdjunto(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), "otro.zip")).toBeNull();
    expect(mimeAdjunto(Buffer.from("hola"), "x.pdf")).toBeNull();
  });
});
