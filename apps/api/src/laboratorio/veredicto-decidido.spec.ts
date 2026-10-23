import { errorMotivoVeredicto, notaVeredictoDecidido, observacionConDecision } from "./veredicto-decidido";

describe("Decidir… un veredicto (B-032)", () => {
  it("exige motivo de al menos 5 caracteres", () => {
    expect(errorMotivoVeredicto(undefined)).toMatch(/motivo/);
    expect(errorMotivoVeredicto("  ok ")).toMatch(/mínimo 5/);
    expect(errorMotivoVeredicto("LD del método sobre el máximo; se informa conforme a la norma")).toBeNull();
  });
  it("arma la nota del informe con el revisor", () => {
    expect(notaVeredictoDecidido("LD mayor que el máximo.", "Ana Pérez")).toBe("Veredicto decidido por el revisor (Ana Pérez): LD mayor que el máximo.");
    expect(notaVeredictoDecidido(null)).toBe("");
  });
  it("suma la nota a la observación del analista", () => {
    expect(observacionConDecision("Muestra turbia", "LD sobre el máximo", null)).toBe("Muestra turbia Veredicto decidido por el revisor: LD sobre el máximo.");
    expect(observacionConDecision(null, null)).toBeNull();
  });
});
