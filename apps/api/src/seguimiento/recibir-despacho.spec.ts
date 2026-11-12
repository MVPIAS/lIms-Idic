import { puedeRecibirDespacho } from "./recibir-despacho";

describe("F015 · quién da por recibido un despacho", () => {
  it("el despacho a DCO lo recibe Comercial, no el Jefe de Sucursal que remitió", () => {
    expect(puedeRecibirDespacho("DCO", { roles: ["JEFE_LAB"], unidades: ["SSTGO"] })).toBe(false);
    expect(puedeRecibirDespacho("DCO", { roles: ["COMERCIAL"], unidades: [] })).toBe(true);
    expect(puedeRecibirDespacho("DCO", { roles: ["JEFE_DEPTO"], unidades: ["DCO", "COM"] })).toBe(true);
    expect(puedeRecibirDespacho("DCO", { roles: ["SUPERADMIN"], unidades: [] })).toBe(true);
  });
  it("al BPCH lo recibe la SCC; al laboratorio solicitante, esa unidad", () => {
    expect(puedeRecibirDespacho("BPCH", { roles: ["JEFE_SECCION"], unidades: ["SCC"] })).toBe(true);
    expect(puedeRecibirDespacho("BPCH", { roles: ["JEFE_LAB"], unidades: ["LQC"] })).toBe(false);
    expect(puedeRecibirDespacho("LAB_SOLICITANTE", { roles: ["JEFE_LAB"], unidades: ["LQC"] }, "LQC")).toBe(true);
    expect(puedeRecibirDespacho("LAB_SOLICITANTE", { roles: ["JEFE_LAB"], unidades: ["LMT"] }, "LQC")).toBe(false);
  });
  it("otros destinos: quien entrega", () => {
    expect(puedeRecibirDespacho("CLIENTE", { roles: ["JEFE_LAB"], unidades: [] })).toBe(true);
  });
});
