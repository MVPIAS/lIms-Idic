import { descripcionOt, erroresRequerimiento, motivoNoValidable } from "./reglas-requerimiento";

const base = {
  docOrigenTipo: "oficio" as const,
  docOrigenNumero: "1234",
  docOrigenFecha: "2026-11-05",
  conCobro: true,
  plantaIds: [] as string[],
  plantasEmpresa: ["p1"],
};

describe("Requerimiento BPCH (OT sin cotización)", () => {
  it("válido con documento de origen y cobro", () => {
    expect(erroresRequerimiento(base, "2026-11-11")).toEqual([]);
  });
  it("sin cobro exige la comunicación y su número", () => {
    const e = erroresRequerimiento({ ...base, conCobro: false }, "2026-11-11").join(" ");
    expect(e).toMatch(/número de la comunicación/);
    expect(e).toMatch(/resuma la comunicación/);
  });
  it("fecha futura, número vacío y planta ajena", () => {
    const e = erroresRequerimiento({ ...base, docOrigenTipo: "rpi", docOrigenNumero: " ", docOrigenFecha: "2026-12-01", plantaIds: ["p9"] }, "2026-11-11");
    expect(e).toHaveLength(3);
    expect(e[0]).toMatch(/RPI/);
  });
  it("quien lo elabora no lo valida; un validado no se valida otra vez", () => {
    expect(motivoNoValidable({ estado: "borrador", createdBy: "u1" }, "u1")).toMatch(/otra jefatura/);
    expect(motivoNoValidable({ estado: "borrador", createdBy: "u1" }, "u2")).toBeNull();
    expect(motivoNoValidable({ estado: "validado", createdBy: "u1" }, "u2")).toMatch(/ya está validado/);
  });
  it("descripción de la OT con documento, técnico e instrucciones", () => {
    const t = descripcionOt({ numero: "REQ-2026-0001", escalon: "internaciones", docOrigenTipo: "rpi", docOrigenNumero: "0471", docOrigenFecha: "2026-11-05", asistenciaTecnica: true, tecnico: "PRUEBA Técnico", instrucciones: "Inspeccionar lote" });
    expect(t).toBe("Requerimiento REQ-2026-0001 · Escalón Internaciones · RPI 0471 del 2026-11-05 · Con asistencia técnica · Técnico: PRUEBA Técnico · Instrucciones: Inspeccionar lote");
  });
});
