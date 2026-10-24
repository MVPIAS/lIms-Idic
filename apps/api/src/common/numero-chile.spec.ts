import { numeroChile, porcentajeChile } from "./numero-chile";

describe("números con coma decimal en mensajes (B-083)", () => {
  it("usa coma decimal", () => {
    expect(numeroChile(6.5)).toBe("6,5");
    expect(numeroChile("1.5")).toBe("1,5");
    expect(numeroChile(6)).toBe("6");
    expect(numeroChile(2 / 3)).toBe("0,67");
  });
  it("miles con punto solo desde 10.000", () => {
    expect(numeroChile(1234.5)).toBe("1234,5");
    expect(numeroChile(12345.5)).toBe("12.345,5");
  });
  it("porcentaje", () => {
    expect(porcentajeChile(1.5)).toBe("1,5 %");
    expect(porcentajeChile(null)).toBe("");
  });
});
