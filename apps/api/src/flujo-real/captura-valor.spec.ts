import { BadRequestException } from "@nestjs/common";
import { leerValorCaptura } from "./flujo-real.module";

describe("captura por OT · leerValorCaptura", () => {
  it("coma decimal chilena y punto decimal", () => {
    expect(leerValorCaptura("12,4")).toBe(12.4);
    expect(leerValorCaptura(" 12.4 ")).toBe(12.4);
    expect(leerValorCaptura("-0,5")).toBe(-0.5);
    expect(leerValorCaptura(7)).toBe(7);
  });
  it("texto cualitativo se conserva tal cual", () => {
    expect(leerValorCaptura("Cumple")).toBe("Cumple");
    expect(leerValorCaptura("Ausente en 25 g")).toBe("Ausente en 25 g");
  });
  it("lo que parece número pero es ambiguo se rechaza (no queda «pendiente» en silencio)", () => {
    expect(() => leerValorCaptura("1.234,5")).toThrow(BadRequestException);
    expect(() => leerValorCaptura("12,4,5")).toThrow(BadRequestException);
    expect(() => leerValorCaptura("12 4")).toThrow(BadRequestException);
  });
});
