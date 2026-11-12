import { montoCl as api, montoAInput as apiInput, preMontoCl } from "./monto-cl";
// La web usa una copia (no comparte paquete): se prueba la misma tabla en ambas.
import { montoCl as web, montoAInput as webInput } from "../../../web/lib/monto-cl";

const casos: Array<[unknown, number | null]> = [
  ["184.500", 184500],
  ["184.500,25", 184500.25],
  ["1.234.567", 1234567],
  ["1.234.567,5", 1234567.5],
  ["184500", 184500],
  ["184,5", 184.5],
  ["950,25", 950.25],
  ["950.25", 950.25],
  ["184.5", 184.5],
  ["0.500", 0.5],
  ["0,5", 0.5],
  ["US$ 184.500", 184500],
  ["$ 1.000", 1000],
  ["-1.500", -1500],
  [" 12 ", 12],
  [184500, 184500],
  ["", null],
  [null, null],
  ["1.23.4", null],
  ["12a", null],
  ["1,2,3", null],
  ["1.23,4", null],
];

describe.each([["api", api], ["web", web]])("montoCl (%s)", (_n, f) => {
  it.each(casos)("%p → %p", (entrada, esperado) => {
    expect(f(entrada)).toBe(esperado);
  });
});

describe.each([["api", apiInput], ["web", webInput]])("montoAInput (%s)", (_n, f) => {
  it("vuelve a escribir con coma decimal y sin miles", () => {
    expect(f(184500)).toBe("184500");
    expect(f(1234.5)).toBe("1234,5");
    expect(f(null)).toBe("");
  });
});

describe("preMontoCl", () => {
  it("lee textos a la chilena y deja pasar números", () => {
    expect(preMontoCl("184.500")).toBe(184500);
    expect(preMontoCl(184500)).toBe(184500);
    expect(preMontoCl("")).toBeNull();
    expect(Number.isNaN(preMontoCl("xx") as number)).toBe(true);
  });
});
