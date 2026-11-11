import { agruparPendientes, faltantesOrdenInterna } from "./oi-pendientes";

const ajeno = (muestra: string, lab: string, ensayo: string) => ({
  muestraId: `m-${muestra}`,
  muestra,
  ensayoId: `e-${ensayo}`,
  ensayo,
  familiaId: `f-${lab}`,
  laboratorioId: `u-${lab}`,
  laboratorio: lab,
});

describe("Muestra que pasa a otro laboratorio sin orden interna (R3)", () => {
  it("una propuesta por muestra y laboratorio, sin ensayos repetidos", () => {
    const g = agruparPendientes(
      [ajeno("M1", "LQC", "pH"), ajeno("M1", "LQC", "pH"), ajeno("M1", "LQC", "Humedad"), ajeno("M1", "LME", "Sensibilidad"), ajeno("M2", "LQC", "pH")],
      [],
    );
    expect(g.map((x) => `${x.muestra}>${x.laboratorio}:${x.ensayos.length}`)).toEqual(["M1>LME:1", "M1>LQC:2", "M2>LQC:1"]);
  });
  it("lo declarado en la recepción sin ensayos queda como propuesta manual", () => {
    const g = agruparPendientes([ajeno("M1", "LQC", "pH")], [
      { muestraId: "m-M1", muestra: "M1", laboratorioId: "u-LQC", laboratorio: "LQC" },
      { muestraId: "m-M1", muestra: "M1", laboratorioId: "u-LPN", laboratorio: "LPN" },
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.laboratorio === "LPN")).toMatchObject({ soloDeclarado: true, familiaId: null, ensayos: [] });
    expect(g.find((x) => x.laboratorio === "LQC")!.soloDeclarado).toBe(false);
  });
  it("el cierre lo exige con un texto claro", () => {
    expect(faltantesOrdenInterna([])).toEqual([]);
    const f = faltantesOrdenInterna(agruparPendientes([ajeno("M1", "LQC", "pH")], []));
    expect(f[0]).toMatch(/M1 → LQC/);
    expect(f[0]).toMatch(/orden interna/);
  });
});
