import { etiquetaVeredicto, normalizarVeredicto, veredictoNumerico } from "./veredicto";

describe("veredicto único · normalizarVeredicto", () => {
  it("lleva las formas heredadas de la captura por réplicas al código único", () => {
    expect(normalizarVeredicto("Cumple")).toBe("cumple");
    expect(normalizarVeredicto("No cumple")).toBe("no_cumple");
    expect(normalizarVeredicto("NO CUMPLE")).toBe("no_cumple");
    expect(normalizarVeredicto("Informativo")).toBe("informativo");
  });
  it("respeta los códigos de la captura por OT", () => {
    for (const v of ["cumple", "no_cumple", "informativo", "pendiente"]) expect(normalizarVeredicto(v)).toBe(v);
  });
  it("no inventa un veredicto para textos desconocidos o vacíos", () => {
    expect(normalizarVeredicto("Declarado")).toBeNull();
    expect(normalizarVeredicto("")).toBeNull();
    expect(normalizarVeredicto(null)).toBeNull();
  });
  it("etiqueta legible para informes y pantallas", () => {
    expect(etiquetaVeredicto("no_cumple")).toBe("No cumple");
    expect(etiquetaVeredicto("Cumple")).toBe("Cumple");
    expect(etiquetaVeredicto("otra cosa")).toBe("otra cosa");
    expect(etiquetaVeredicto(null)).toBe("");
  });
});

describe("veredicto único · veredictoNumerico", () => {
  it("doble cota inclusiva", () => {
    expect(veredictoNumerico(5, 0, 10)).toBe("cumple");
    expect(veredictoNumerico(0, 0, 10)).toBe("cumple");
    expect(veredictoNumerico(10, 0, 10)).toBe("cumple");
    expect(veredictoNumerico(10.5, 0, 10)).toBe("no_cumple");
    expect(veredictoNumerico(-0.1, 0, 10)).toBe("no_cumple");
  });
  it("una sola cota", () => {
    expect(veredictoNumerico(3, 3, null)).toBe("cumple");
    expect(veredictoNumerico(2.9, 3, null)).toBe("no_cumple");
    expect(veredictoNumerico(8, null, 8)).toBe("cumple");
    expect(veredictoNumerico(8.1, null, 8)).toBe("no_cumple");
  });
  it("sin especificación → informativo (igual en las dos capturas)", () => {
    expect(veredictoNumerico(5, null, null)).toBe("informativo");
    expect(veredictoNumerico(5)).toBe("informativo");
  });
  it("tolera el ruido de coma flotante en la cota", () => {
    expect(veredictoNumerico(3600.0000000001, null, 3600)).toBe("cumple");
  });
});
