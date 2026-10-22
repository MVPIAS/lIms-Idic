import { PATRONES_128, anchosCode128B, svgCode128, valoresCode128B } from "./code128";

describe("Code 128 B", () => {
  it("la tabla tiene 107 símbolos distintos de 11 módulos (el de fin, 13)", () => {
    expect(PATRONES_128).toHaveLength(107);
    expect(new Set(PATRONES_128).size).toBe(107);
    PATRONES_128.forEach((p, i) => {
      const suma = p.split("").reduce((s, d) => s + Number(d), 0);
      expect([i, suma]).toEqual([i, i === 106 ? 13 : 11]);
    });
  });

  it("calcula el dígito de control módulo 103", () => {
    expect(valoresCode128B("A")).toEqual([104, 33, 34, 106]);
    expect(valoresCode128B("AB")).toEqual([104, 33, 34, 102, 106]);
    // OT-2026-0001-M01: 16 datos + inicio + control + fin
    expect(valoresCode128B("OT-2026-0001-M01")).toHaveLength(19);
  });

  it("alterna barras y espacios y empieza y termina en barra", () => {
    const a = anchosCode128B("M01");
    expect(a.length % 2).toBe(1);
    // inicio B = 211214
    expect(a.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    // fin = 2331112
    expect(a.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it("rechaza caracteres fuera del juego B y el texto vacío", () => {
    expect(() => valoresCode128B("")).toThrow(/vacío/);
    expect(() => valoresCode128B("Ñ01")).toThrow(/no admitido/);
  });

  it("dibuja un SVG con el texto legible escapado", () => {
    const svg = svgCode128("A<1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("A&lt;1");
    expect(svg).not.toContain("A<1<");
  });
});
