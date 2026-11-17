import { calcularCaptura } from "./captura-estandar";
import { condicionesSegunMetodo, erroresReglasResultado, explicacionFactor, leerReglasResultado, redondear, textoRedondeado } from "./reglas-resultado";

describe("Redondeo del resultado por ensayo (LPN, R7)", () => {
  it("al medio hacia afuera, sin error de coma flotante", () => {
    expect(redondear(87.5, 0)).toBe(88);
    expect(redondear(87.49, 0)).toBe(87);
    expect(redondear(-2.5, 0)).toBe(-3);
    expect(redondear(1.005, 2)).toBe(1.01);
    expect(redondear(12.345, null)).toBe(12.345);
    expect(redondear(-0.4, 0)).toBe(0);
    expect(textoRedondeado(12.3, 2)).toBe("12.30");
    expect(textoRedondeado(87.6, 0)).toBe("88");
  });
  it("brillo en enteros: el valor informado y el veredicto usan el valor redondeado", () => {
    const espec = { tipoDato: "numerico" as const, limiteInf: "85", limiteSup: null, decimales: 0 };
    const c = calcularCaptura(espec, { replicas: [84.4, 84.8] });
    expect(c.valorNumerico).toBe(85);
    expect(c.valorTexto).toBe("85");
    expect(c.veredicto).toBe("cumple");
    const sin = calcularCaptura({ ...espec, decimales: null }, { replicas: [84.4, 84.8] });
    expect(sin.valorNumerico).toBeCloseTo(84.6, 10);
    expect(sin.veredicto).toBe("no_cumple");
  });
  it("con factor: se redondea el resultado final (tras el factor)", () => {
    const c = calcularCaptura({ tipoDato: "numerico", decimales: 1, factor: { valor: 3, operacion: "dividir" } }, { replicas: [10] });
    expect(c.valorNumerico).toBe(3.3);
    expect(c.resultadoFinal).toBe(3.3);
  });
  it("lee y valida la configuración del método", () => {
    expect(leerReglasResultado({ decimales_resultado: 0, condiciones_ambientales: "no_aplica" })).toEqual({ decimales: 0, condiciones: "no_aplica" });
    expect(leerReglasResultado({ decimales_resultado: 9, condiciones_ambientales: "x" })).toEqual({ decimales: null, condiciones: "opcional" });
    expect(leerReglasResultado(null)).toEqual({ decimales: null, condiciones: "opcional" });
    expect(erroresReglasResultado({ decimales: 7 })).toHaveLength(1);
    expect(erroresReglasResultado({ decimales: null, condiciones: "obligatoria" })).toEqual([]);
  });
});

describe("Condiciones ambientales según el ensayo (LME, R8)", () => {
  it("no aplica: se descartan; obligatoria: faltar alguna es error; opcional: como vengan", () => {
    expect(condicionesSegunMetodo("no_aplica", { temperatura: 21, humedad: 40 })).toEqual({ temperatura: undefined, humedad: undefined, error: null });
    expect(condicionesSegunMetodo("obligatoria", { temperatura: 21, humedad: null }).error).toMatch(/exige registrar la temperatura/);
    expect(condicionesSegunMetodo("opcional", { temperatura: null, humedad: 40 })).toEqual({ temperatura: null, humedad: 40, error: null });
  });
});

describe("Explicación del factor de la fórmula (LPN, R7)", () => {
  it("dice qué hace, sobre qué valor, para qué y quién lo ajusta", () => {
    const t = explicacionFactor({ valor: 10, operacion: "dividir", descripcion: "dilución 1:10" }, "metodo");
    expect(t).toContain("divide por 10 el valor calculado");
    expect(t).toContain("promedio de las lecturas");
    expect(t).toContain("(dilución 1:10)");
    expect(t).toContain("resultado.factor");
    expect(explicacionFactor({ valor: 2.5, operacion: "multiplicar" }, "orden")).toMatch(/^Factor ajustado en esta OT: multiplica por 2,5/);
    expect(explicacionFactor(null)).toMatch(/^Este ensayo no lleva factor/);
  });
});
