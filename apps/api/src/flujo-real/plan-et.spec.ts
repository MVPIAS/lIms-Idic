import { filtrarAnalitosPorPlan } from "./flujo-real.module";

describe("B-005 · los ensayos generados siguen el plan de la E.T.", () => {
  const a = (id: string, metodoId: string) => ({ id, metodoId });
  const analitos = [a("alarg", "467"), a("espesor", "467"), a("taco", "467"), a("planta", "472"), a("otro", "999")];

  it("sin plan: todos los analitos de los métodos", () => {
    expect(filtrarAnalitosPorPlan(analitos, new Map())).toHaveLength(5);
  });
  it("el plan nombra analitos de un método: solo esos; los demás métodos, completos", () => {
    const plan = new Map([["467", new Set(["espesor"])], ["472", new Set(["planta"])]]);
    expect(filtrarAnalitosPorPlan(analitos, plan).map((x) => x.id)).toEqual(["espesor", "planta", "otro"]);
  });
});
