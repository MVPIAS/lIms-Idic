import { aplanarVariables, diffLineas, motivoNoAprobable, motivoNoEditable } from "./plantilla-versiones";

describe("plantilla-versiones · aprobación", () => {
  const borrador = { estado: "BORRADOR", creadoPor: "u1", editores: ["u1", "u2"] };

  it("otra persona aprueba el borrador", () => {
    expect(motivoNoAprobable(borrador, "u3")).toBeNull();
  });
  it("quien lo redactó no lo aprueba", () => {
    expect(motivoNoAprobable(borrador, "u1")?.codigo).toBe(403);
  });
  it("quien lo modificó tampoco", () => {
    expect(motivoNoAprobable(borrador, "u2")?.codigo).toBe(403);
  });
  it("una vigente o retirada no se aprueba", () => {
    expect(motivoNoAprobable({ ...borrador, estado: "VIGENTE" }, "u3")?.codigo).toBe(409);
    expect(motivoNoAprobable({ ...borrador, estado: "RETIRADA" }, "u3")?.codigo).toBe(409);
  });
  it("sin usuario no se aprueba", () => {
    expect(motivoNoAprobable(borrador, undefined)?.codigo).toBe(403);
  });
  it("solo el borrador se edita", () => {
    expect(motivoNoEditable({ estado: "BORRADOR" })).toBeNull();
    expect(motivoNoEditable({ estado: "VIGENTE" })).toMatch(/borrador/);
  });
});

describe("plantilla-versiones · variables", () => {
  it("aplana rutas y trata fechas y arrays como hojas", () => {
    const v = aplanarVariables({ ot: { codigo: "X", fecha: new Date(), muestras: [1, 2], cliente: { rut: "1" } }, anio: "2026", vacio: {} });
    expect(v).toEqual(["ot.codigo", "ot.fecha", "ot.muestras", "ot.cliente.rut", "anio", "vacio"]);
  });
  it("ignora claves vetadas o con caracteres raros", () => {
    const o = JSON.parse('{"__proto__": {"x": 1}, "a-b": 1, "ok": 2}');
    expect(aplanarVariables(o)).toEqual(["ok"]);
  });
});

describe("plantilla-versiones · comparar", () => {
  it("marca líneas quitadas y agregadas", () => {
    const d = diffLineas("a\nb\nc", "a\nx\nc");
    expect(d).toEqual([
      { tipo: "igual", texto: "a" },
      { tipo: "quitada", texto: "b" },
      { tipo: "agregada", texto: "x" },
      { tipo: "igual", texto: "c" },
    ]);
  });
  it("tolera nulos", () => {
    expect(diffLineas(null, "a")).toEqual([
      { tipo: "quitada", texto: "" },
      { tipo: "agregada", texto: "a" },
    ]);
  });
});
