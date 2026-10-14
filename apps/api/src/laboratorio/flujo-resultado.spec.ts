import { clasificarParaAccion, motivoNoCapturable } from "./flujo-resultado";

describe("flujo del resultado · ¿se puede capturar?", () => {
  it("pendiente, capturado, devuelto y rechazado admiten (re)captura", () => {
    for (const e of ["pendiente", "capturado", "devuelto", "rechazado"]) expect(motivoNoCapturable(e)).toBeNull();
    expect(motivoNoCapturable(null)).toBeNull();
  });
  it("revisado_n1 no: hay que devolverlo antes", () => {
    expect(motivoNoCapturable("revisado_n1")).toMatch(/devolverlo/);
  });
  it("aprobado no se modifica", () => {
    expect(motivoNoCapturable("aprobado")).toMatch(/aprobado/);
  });
});

describe("flujo del resultado · acción sobre la OT completa", () => {
  const filas = [
    { id: "a", estado: "capturado", analistaId: "ana" },
    { id: "b", estado: "capturado", analistaId: "rev" },
    { id: "c", estado: "revisado_n1", analistaId: "ana" },
    { id: "d", estado: "pendiente", analistaId: null },
    { id: "e", estado: "capturado", analistaId: null },
  ];

  it("revisar: solo los capturados; omite los que capturó el propio revisor (segregación)", () => {
    const r = clasificarParaAccion(filas, "revisar", "rev");
    expect(r.aplicables).toEqual(["a", "e"]);
    expect(r.omitidos).toEqual([{ id: "b", motivo: expect.stringMatching(/otra persona/) }]);
  });

  it("aprobar: solo los revisados; el analista que los capturó no puede aprobarlos", () => {
    expect(clasificarParaAccion(filas, "aprobar", "jefe").aplicables).toEqual(["c"]);
    const r = clasificarParaAccion(filas, "aprobar", "ana");
    expect(r.aplicables).toEqual([]);
    expect(r.omitidos.map((o) => o.id)).toEqual(["c"]);
  });

  it("los pendientes (sin valor) nunca se revisan", () => {
    expect(clasificarParaAccion(filas, "revisar", "x").aplicables).not.toContain("d");
  });
});
