import { marcarEnAlcance } from "./en-alcance";

describe("marcarEnAlcance (F061)", () => {
  const filas = [{ id: "a" }, { id: "b" }];
  it("alcance global: todas modificables", () => {
    expect(marcarEnAlcance(filas, null).map((f) => f.enAlcance)).toEqual([true, true]);
  });
  it("alcance acotado: solo las de su laboratorio", () => {
    expect(marcarEnAlcance(filas, new Set(["b"])).map((f) => f.enAlcance)).toEqual([false, true]);
    expect(marcarEnAlcance(filas, new Set()).map((f) => f.enAlcance)).toEqual([false, false]);
  });
});
