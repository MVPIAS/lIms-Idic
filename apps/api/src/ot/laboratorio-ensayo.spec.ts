import { ensayosDeOtrosLaboratorios, esDelResponsable, laboratorioDelEnsayo } from "./laboratorio-ensayo";

describe("laboratorio de cada ensayo de la OT (F071)", () => {
  const LQA = "u-lqa";
  const propio = { id: "a", estado: "pendiente", derivadoA: null, laboratorioCatalogo: LQA, laboratorioCodigo: "LQA" };
  const ecoli = { id: "b", estado: "pendiente", derivadoA: null, laboratorioCatalogo: "u-lmb", laboratorioCodigo: "LMB" };
  const derivado = { id: "c", estado: "pendiente", derivadoA: "u-les", laboratorioCatalogo: "u-les", laboratorioCodigo: "LES" };
  const sinCatalogo = { id: "d", estado: "pendiente", derivadoA: null, laboratorioCatalogo: null };

  it("el ensayo del catálogo de otro laboratorio no es del responsable aunque aún no tenga orden interna", () => {
    expect(esDelResponsable(propio, LQA)).toBe(true);
    expect(esDelResponsable(ecoli, LQA)).toBe(false);
    expect(laboratorioDelEnsayo(ecoli, LQA)).toBe("u-lmb");
  });
  it("lo derivado por orden interna es del destino; sin catálogo, del responsable", () => {
    expect(esDelResponsable(derivado, LQA)).toBe(false);
    expect(esDelResponsable(sinCatalogo, LQA)).toBe(true);
    expect(esDelResponsable(ecoli, null)).toBe(true);
  });
  it("resume los ensayos de otros laboratorios", () => {
    expect(ensayosDeOtrosLaboratorios([propio, ecoli, { ...ecoli, id: "e" }, derivado], LQA)).toEqual([
      { laboratorio: "LES", ensayos: 1 },
      { laboratorio: "LMB", ensayos: 2 },
    ]);
  });
});
