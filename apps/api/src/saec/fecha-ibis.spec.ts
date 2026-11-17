import { fechaEsi } from "./fecha-ibis";
import { fechaHoraChile } from "../common/fecha-chile";

describe("F038 · fecha del XML de IBIS en hora de Chile", () => {
  it("una hora sin zona es hora de Chile (noviembre: UTC−3)", () => {
    const iso = fechaEsi("2026-11-12 10:15:00");
    expect(iso).toBe("2026-11-12T13:15:00.000Z");
    expect(fechaHoraChile(iso)).toMatch(/12-11-2026 10:15/);
  });
  it("en invierno (UTC−4) también", () => {
    expect(fechaEsi("2026-07-01T08:00")).toBe("2026-07-01T12:00:00.000Z");
  });
  it("si trae zona, se respeta", () => {
    expect(fechaEsi("2026-11-12T10:15:00Z")).toBe("2026-11-12T10:15:00.000Z");
    expect(fechaEsi("2026-11-12T10:15:00-03:00")).toBe("2026-11-12T13:15:00.000Z");
  });
  it("vacío o ilegible: null", () => {
    expect(fechaEsi("")).toBeNull();
    expect(fechaEsi("ayer")).toBeNull();
    expect(fechaEsi(null)).toBeNull();
  });
});
