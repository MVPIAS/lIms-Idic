import { apruebaSinRevision, configSegregacion } from "../rbac/alcance-resultado";
import { clasificarParaAccion } from "./flujo-resultado";
import { validarTransicion } from "../common/estados";

describe("aprobación sin revisión previa (sesiones oct-nov 2026)", () => {
  it("por defecto la revisión es obligatoria", () => {
    expect(apruebaSinRevision(configSegregacion(null, null), "LME")).toBe(false);
  });
  it("opcional sin lista: todos los laboratorios; con lista: solo los marcados", () => {
    expect(apruebaSinRevision(configSegregacion(null, null, "opcional", ""), "LQC")).toBe(true);
    const cfg = configSegregacion(null, null, "opcional", "LME, lpn");
    expect(apruebaSinRevision(cfg, "LPN")).toBe(true);
    expect(apruebaSinRevision(cfg, "LQC")).toBe(false);
    expect(apruebaSinRevision(cfg, null)).toBe(false);
  });
  it("aprobar en bloque incluye lo capturado sin revisión, salvo lo propio", () => {
    const filas = [
      { id: "a", estado: "capturado", analistaId: "u1" },
      { id: "b", estado: "capturado", analistaId: "jefe" },
      { id: "c", estado: "revisado_n1", analistaId: "u1" },
    ];
    expect(clasificarParaAccion(filas, "aprobar", "jefe").aplicables).toEqual(["c"]);
    const r = clasificarParaAccion(filas, "aprobar", "jefe", () => true);
    expect(r.aplicables).toEqual(["a", "c"]);
    expect(r.omitidos.map((o) => o.id)).toEqual(["b"]);
  });
  it("la máquina de estados admite capturado → aprobado", () => {
    expect(() => validarTransicion("resultado", "capturado", "aprobado")).not.toThrow();
  });
});
