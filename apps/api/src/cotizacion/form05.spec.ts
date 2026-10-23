import { calcularForm05, erroresForm05, erroresPrograma, montoViatico } from "./form05";

describe("Formulario de costeo FORM05 (EP-00 2.5)", () => {
  const p = { cfaPct: 12, margenParticularPct: 20 };

  it("viático = monto diario × % del grado × días (maqueta FORM-2026-14588: US$ 200 × 60 % × 5 = 600)", () => {
    expect(montoViatico({ ambito: "extranjero", zona: "Serbia", grado: "Oficial jefe", dias: 5, montoDiario: 200, porcentaje: 60 })).toBe(600);
  });

  it("suma las seis secciones en el CDT y calcula CFA, CT, precio Ejército y particular", () => {
    const r = calcularForm05(
      {
        viaticos: [{ ambito: "nacional", zona: "Santiago", grado: "Profesional civil", dias: 2, montoDiario: 50000, porcentaje: 40 }],
        horasHombre: [
          { tipo: "civil", categoria: "Analista", horas: 6, valorHora: 18500 },
          { tipo: "militar", categoria: "Oficial", horas: 1, valorHora: 25000 },
        ],
        servicios: [{ codigo: "EN1214", cantidad: 1, valorUnitario: 100000 }],
        horasMaquina: [{ equipo: "Cámara climática", horas: 4, valorHora: 24000 }],
        pasajes: [{ ambito: "nacional", tramo: "SCL-ANF", cantidad: 1, valorUnitario: 90000 }],
        otros: [{ descripcion: "Insumos", monto: 10, moneda: "USD" }],
        dolar: 950,
      },
      p,
    );
    expect(r.secciones).toEqual({ viaticos: 40000, horasHombre: 136000, servicios: 100000, horasMaquina: 96000, pasajes: 90000, otros: 9500 });
    expect(r.cdt).toBe(471500);
    expect(r.cfa).toBe(56580);
    expect(r.ct).toBe(528080);
    expect(r.precioEjercito).toBe(528080);
    expect(r.precioParticular).toBe(633696);
    expect(r.horasHombreTotal).toBe(7);
  });

  it("exige al menos una fila y el dólar si hay gastos en US$", () => {
    expect(erroresForm05({})).toHaveLength(1);
    expect(erroresForm05({ otros: [{ descripcion: "x", monto: 1, moneda: "USD" }] })[0]).toMatch(/dólar/);
    expect(erroresForm05({ otros: [{ descripcion: "x", monto: 1, moneda: "CLP" }] })).toEqual([]);
  });

  it("el programa de trabajo exige plazo entre 1 y 730 días y fechas en orden", () => {
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 0 })).toHaveLength(1);
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 15 })).toEqual([]);
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 15, fechaInicio: "2026-11-10", fechaTermino: "2026-11-01" })).toHaveLength(1);
    expect(erroresPrograma({ etapas: [{ actividad: "Ensayo", inicio: "2026-11-05", termino: "2026-11-04" }], plazoEntregaDias: 15 })[0]).toMatch(/Ensayo/);
  });
});

describe("Cotización del DSA · comisión, Programa de Trabajo LEM y reposición LRB (EP-05 0.2, BL-151)", () => {
  const { exigeCosteo, cantidadConReposicion, erroresPrograma } = require("./form05") as typeof import("./form05");
  it("la comisión, como el servicio no estandarizado, exige el formulario de costeo", () => {
    expect(exigeCosteo("comision")).toBe(true);
    expect(exigeCosteo("no_estandar")).toBe(true);
    expect(exigeCosteo("estandar")).toBe(false);
  });
  it("el lote del LRB se cotiza con las unidades de reposición", () => {
    expect(cantidadConReposicion(30, 4)).toBe(34);
    expect(cantidadConReposicion(30, 0)).toBe(30);
  });
  it("el Programa de Trabajo valida el número de ítems", () => {
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 10, numItems: 0 })).toContain("Programa de trabajo: el número de ítems debe ser un entero de 1 o más.");
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 10, numItems: 12, puntosEt: "4.1.1" })).toEqual([]);
  });
});
