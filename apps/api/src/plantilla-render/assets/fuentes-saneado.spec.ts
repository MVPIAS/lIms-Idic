import { sanearParaFuente } from "./fuentes";

describe("Saneado del texto para las fuentes del PDF", () => {
  it("F021: el separador «›» de la familia sale como «>» y no como «?»", () => {
    expect(sanearParaFuente("Explosivos › Iniciadores")).toBe("Explosivos > Iniciadores");
    expect(sanearParaFuente("a ‹ b")).toBe("a < b");
  });
  it("lo no cubierto sigue cayendo a «?»", () => {
    expect(sanearParaFuente("Ω")).toBe("?");
  });
});
