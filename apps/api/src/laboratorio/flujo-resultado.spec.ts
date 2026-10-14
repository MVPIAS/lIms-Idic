import { clasificarParaAccion, motivoNoCapturable, planReapertura } from "./flujo-resultado";

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

describe("reapertura de un resultado aprobado", () => {
  const ot = { estado: "en_analisis", codigo: "OT-1" };

  it("solo se reabre lo aprobado", () => {
    expect(planReapertura("revisado_n1", ot, []).error).toMatch(/devuélvalo/);
    expect(planReapertura("capturado", ot, []).error).toBeTruthy();
    expect(planReapertura("aprobado", ot, []).error).toBeNull();
  });

  it("no se reabre en una OT cerrada o anulada", () => {
    expect(planReapertura("aprobado", { estado: "cerrada", codigo: "OT-1" }, []).error).toMatch(/cerrada/);
    expect(planReapertura("aprobado", { estado: "anulada", codigo: "OT-1" }, []).error).toMatch(/anulada/);
  });

  it("anula los documentos en firma u oficiales y avisa de los entregados", () => {
    const r = planReapertura("aprobado", ot, [
      { id: "a", numero: "CERT-1", estado: "en_firma" },
      { id: "b", numero: "CERT-2", estado: "oficial", entregadoAt: "2026-10-01" },
      { id: "c", numero: "CERT-3", estado: "anulado" },
      { id: "d", numero: "CERT-4", estado: "devuelto" },
      { id: "e", numero: "CERT-5", estado: "emitido" },
    ]);
    expect(r.anular.map((d: any) => d.numero)).toEqual(["CERT-1", "CERT-2", "CERT-5"]);
    expect(r.avisos[0]).toMatch(/reemita/);
    expect(r.avisos[1]).toMatch(/CERT-2 ya se entregó/);
  });

  it("sin documentos vigentes no hay nada que anular", () => {
    expect(planReapertura("aprobado", ot, [{ id: "c", numero: "X", estado: "anulado" }])).toEqual({ error: null, anular: [], avisos: [] });
  });
});
