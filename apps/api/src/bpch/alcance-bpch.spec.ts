import { expedienteVisible, filtroExpedientesBpch, puedeOperarEnUnidad } from "./alcance-bpch";

describe("alcance BPCH · expedientes con unidad (prototipos, clasificaciones)", () => {
  it("global o con la SCC en el alcance: ve todo", () => {
    expect(filtroExpedientesBpch(null, "SCC")).toBeNull();
    expect(filtroExpedientesBpch(["SCC", "SANTOF"], "SCC")).toBeNull();
  });

  it("una sucursal o la Delegación Nº 11: solo lo suyo", () => {
    expect(filtroExpedientesBpch(["SANTOF"], "SCC")).toEqual(["SANTOF"]);
    expect(expedienteVisible(["SANTOF"], "SANTOF")).toBe(true);
    expect(expedienteVisible(["SANTOF"], "SSTGO")).toBe(false);
    expect(expedienteVisible(["D11"], "SANTOF")).toBe(false);
  });

  it("expediente aún sin unidad: solo quien ve todo", () => {
    expect(expedienteVisible(["SANTOF"], null)).toBe(false);
    expect(expedienteVisible(null, null)).toBe(true);
  });

  it("operar en una unidad (regla previa) no cambia", () => {
    expect(puedeOperarEnUnidad(["SANTOF"], "SANTOF", "SCC")).toBe(true);
    expect(puedeOperarEnUnidad(["SANTOF"], "SSTGO", "SCC")).toBe(false);
    expect(puedeOperarEnUnidad(["SCC"], "SSTGO", "SCC")).toBe(true);
  });
});
