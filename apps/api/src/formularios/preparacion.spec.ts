import { camposDefecto, evaluarPreparacion, normalizarCampoPrep } from "./preparacion";

const ctx = { hoy: "2026-10-23", equipos: new Map(), muestraCodigo: "OT-2026-0001-M1" };

describe("preparación · fecha y hora (B-030, EP-02 3.1)", () => {
  it("el LQA y el LMB registran fecha y hora, no solo la fecha", () => {
    expect(camposDefecto("LQA").find((c) => c.campo === "fecha")?.tipo).toBe("fechahora");
    expect(camposDefecto("LMB").find((c) => c.campo === "fecha")?.tipo).toBe("fechahora");
  });

  it("acepta «AAAA-MM-DDTHH:MM» y la guarda tal cual (hora de Chile)", () => {
    const r = evaluarPreparacion(camposDefecto("LQA"), { homogeneizacion: "Licuado", porcion_analitica: "10,5", fecha: "2026-10-23T09:40" }, ctx);
    expect(r.errores).toEqual([]);
    expect(r.datos.fecha).toBe("2026-10-23T09:40");
  });

  it("rechaza una fecha sin hora", () => {
    const r = evaluarPreparacion(camposDefecto("LQA"), { homogeneizacion: "Licuado", porcion_analitica: "10", fecha: "2026-10-23" }, ctx);
    expect(r.errores).toContain("Fecha y hora: indique la fecha y la hora.");
  });

  it("el administrador puede configurar un campo de fecha y hora", () => {
    expect(normalizarCampoPrep({ tipo: "fechahora", obligatorio: true }).errores).toEqual([]);
  });
});
