import {
  combinarVeredictos,
  erroresCondicion2,
  erroresPlanClases,
  leerCondicion2,
  leerPlanClases,
  textoCondicion2,
  veredictoCondicion2,
  veredictoPlanClases,
} from "./requisito-compuesto";
import { calcularCaptura, CapturaError } from "./captura-estandar";
import { planAjusteFactor } from "./ajuste-factor";

describe("Plan de 2 y 3 clases (n, c, m, M) · RSA", () => {
  const tres = { n: 5, c: 2, m: 100, M: 1000 };
  it("3 clases: cumple con hasta c unidades entre m y M", () => {
    expect(veredictoPlanClases([10, 150, 900, 20, 30], tres).veredicto).toBe("cumple");
  });
  it("3 clases: más de c entre m y M → no cumple", () => {
    const r = veredictoPlanClases([150, 160, 170, 20, 30], tres);
    expect(r.veredicto).toBe("no_cumple");
    expect(r.marginales).toBe(3);
  });
  it("3 clases: una unidad sobre M → no cumple aunque falten unidades", () => {
    expect(veredictoPlanClases([1500], tres).veredicto).toBe("no_cumple");
  });
  it("faltan unidades y nada decide aún → pendiente", () => {
    const r = veredictoPlanClases([10, 20], tres);
    expect(r.veredicto).toBe("pendiente");
    expect(r.faltan).toBe(3);
  });
  it("2 clases (sin M): c = 0 y una unidad sobre m → no cumple", () => {
    expect(veredictoPlanClases([0, 0, 0, 0, 1], { n: 5, c: 0, m: 0 }).veredicto).toBe("no_cumple");
    expect(veredictoPlanClases([0, 0, 0, 0, 0], { n: 5, c: 0, m: 0 }).veredicto).toBe("cumple");
  });
  it("valida el plan", () => {
    expect(erroresPlanClases({ n: 5, c: 2, m: 100, M: 1000 })).toEqual([]);
    expect(erroresPlanClases({ n: 5, c: 6, m: 100 }).join(" ")).toMatch(/no puede superar n/);
    expect(erroresPlanClases({ n: 5, c: 1, m: 100, M: 50 }).join(" ")).toMatch(/M debe ser mayor/);
    expect(erroresPlanClases(null)[0]).toMatch(/indique n, c y m/);
  });
  it("lee el plan guardado (admite coma decimal en texto)", () => {
    expect(leerPlanClases({ n: 5, c: 2, m: "1,5", M: null })).toEqual({ n: 5, c: 2, m: 1.5, M: null });
    expect(leerPlanClases({ n: 0, c: 2, m: 1 })).toBeNull();
  });
});

describe("Segunda condición en la misma fila («X kgf con Y mm»)", () => {
  const c2 = { etiqueta: "Alargamiento", inf: 12, unidad: "mm" };
  it("texto para pantallas e informes", () => {
    expect(textoCondicion2(c2)).toBe("con Alargamiento ≥ 12 mm");
    expect(textoCondicion2({ etiqueta: "Flecha", inf: 1.5, sup: 3 })).toBe("con Flecha 1,5–3");
  });
  it("veredicto propio y combinado", () => {
    expect(veredictoCondicion2(null, c2)).toBe("pendiente");
    expect(veredictoCondicion2(11, c2)).toBe("no_cumple");
    expect(combinarVeredictos("cumple", "cumple")).toBe("cumple");
    expect(combinarVeredictos("cumple", "no_cumple")).toBe("no_cumple");
    expect(combinarVeredictos("cumple", "pendiente")).toBe("pendiente");
    expect(combinarVeredictos("informativo", "cumple")).toBe("cumple");
  });
  it("valida la definición", () => {
    expect(erroresCondicion2({ etiqueta: "", inf: 1 })[0]).toMatch(/qué se mide/);
    expect(erroresCondicion2({ etiqueta: "X" })[0]).toMatch(/mínimo, el máximo/);
    expect(leerCondicion2({ etiqueta: "Alargamiento", inf: "12", sup: "" })).toEqual({ etiqueta: "Alargamiento", inf: 12, sup: null, unidad: null });
  });
});

describe("Captura estándar con requisito compuesto", () => {
  const base = { tipoDato: "numerico" as const };
  it("tracción ≥ 550 kgf con alargamiento ≥ 12 mm: cumplen las dos", () => {
    const espec = { ...base, limiteInf: "550", condicion2: { etiqueta: "Alargamiento", inf: 12, unidad: "mm" } };
    expect(calcularCaptura(espec, { valor: 600, valorCondicion2: "12,5" })).toMatchObject({ veredicto: "cumple", valorCondicion2: 12.5 });
    expect(calcularCaptura(espec, { valor: 600, valorCondicion2: 10 }).veredicto).toBe("no_cumple");
    expect(calcularCaptura(espec, { valor: 406.5, valorCondicion2: 15 }).veredicto).toBe("no_cumple");
    const sinSegundo = calcularCaptura(espec, { valor: 600 });
    expect(sinSegundo.veredicto).toBe("pendiente");
    expect(sinSegundo.explicacion).toMatch(/Falta el valor de Alargamiento/);
  });
  it("plan de clases: las réplicas son las unidades", () => {
    const espec = { ...base, planClases: { n: 5, c: 1, m: 10, M: 100 } };
    const r = calcularCaptura(espec, { replicasTexto: "5 8 50 3 2" });
    expect(r.veredicto).toBe("cumple");
    expect(r.explicacion).toMatch(/n = 5, c = 1/);
    expect(calcularCaptura(espec, { replicasTexto: "5 80 50 3 2" }).veredicto).toBe("no_cumple");
    expect(() => calcularCaptura(espec, { valor: 5 })).toThrow(CapturaError);
  });
  it("el ajuste del factor conserva la segunda condición", () => {
    const p = planAjusteFactor(
      { tipoDato: "numerico", limiteInf: "550", replicas: [600, 610], valorNumerico: 605, condicion2: { etiqueta: "Alargamiento", inf: 12 }, valorCondicion2: 10 },
      null,
    );
    expect(p.accion).toBe("recalcular");
    if (p.accion === "recalcular") {
      expect(p.datos.veredicto).toBe("no_cumple");
      expect(p.datos).not.toHaveProperty("explicacion");
      expect(p.datos).not.toHaveProperty("valorCondicion2");
    }
  });
});
