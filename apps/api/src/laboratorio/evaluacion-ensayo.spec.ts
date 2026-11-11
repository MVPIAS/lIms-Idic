import { calcularCaptura } from "./captura-estandar";
import { evaluacionDe, planEdicion, sinCondicion } from "./especificacion";
import { armarInforme } from "../plantilla-render/filas-informe";
import { configEfectiva } from "../plantilla-render/config-informe";

describe("evaluación del ensayo: con condición, requisito sin condición o solo resultado", () => {
  it("evaluacionDe: null o desconocido es con condición", () => {
    expect(evaluacionDe(null)).toBe("con_condicion");
    expect(evaluacionDe("otra")).toBe("con_condicion");
    expect(evaluacionDe("solo_resultado")).toBe("solo_resultado");
    expect(sinCondicion("sin_condicion")).toBe(true);
    expect(sinCondicion(undefined)).toBe(false);
  });

  it("con condición: fuera de Mín → no cumple; sin condición: informativo con el mismo valor", () => {
    const espec = { tipoDato: "numerico" as const, limiteInf: "95" };
    expect(calcularCaptura(espec, { valor: "90" }).veredicto).toBe("no_cumple");
    const c = calcularCaptura({ ...espec, evaluacion: "sin_condicion" }, { valor: "90" });
    expect(c.veredicto).toBe("informativo");
    expect(c.valorNumerico).toBe(90);
  });

  it("solo resultado en un ensayo de atributo admite texto libre o la elección", () => {
    const espec = { tipoDato: "atributo" as const, requisito: "Ausencia", evaluacion: "solo_resultado" };
    expect(calcularCaptura(espec, { valor: "Presencia leve" })).toMatchObject({ valorTexto: "Presencia leve", veredicto: "informativo" });
    expect(calcularCaptura(espec, { atributo: "cumple" })).toMatchObject({ valorTexto: "Cumple", veredicto: "informativo" });
  });

  it("cambiar la evaluación en la OT exige jefatura", () => {
    const plan = planEdicion({ evaluacion: "con_condicion" }, {}, { evaluacion: "solo_resultado" });
    expect(plan.requiereJefatura).toBe(true);
    expect(plan.campos).toEqual(["evaluacion"]);
  });

  it("informe: sin condición muestra el requisito y un guion en la condición; solo resultado, guion en ambos", () => {
    const base = { muestraId: "m1", muestraCodigo: "OT-1-M1", ensayo: "Pureza", limiteInf: "95", tipoDato: "numerico", valorNumerico: 90, veredicto: "informativo" };
    const est = armarInforme(
      [
        { ...base, id: "a", evaluacion: "sin_condicion" },
        { ...base, id: "b", evaluacion: "solo_resultado" },
        { ...base, id: "c", veredicto: "no_cumple" },
      ],
      configEfectiva("INFORME", null),
      "cumplimiento",
    );
    const filas = est.secciones.flatMap((s) => s.componentes.flatMap((c) => c.filas));
    const f = (id: string) => filas.find((x) => x.id === id)!;
    expect(f("a")).toMatchObject({ requisito: "Mín. 95", veredictoTexto: "—" });
    expect(f("b")).toMatchObject({ requisito: "—", minimo: "", veredictoTexto: "—" });
    expect(f("c").veredictoTexto).toBe("No cumple");
  });
});
