import { calcularMicro, dosCifras, evaluarPlan, leerHoras, leerPlanes, lecturasProgramadas, planDe, recuento, resultadoFinal, tieneConfirmado, veredictoSimple } from "./micro";
import { MicroSensorialService } from "./micro-sensorial.service";
import { codigosAleatorios, colaBinomial, erroresCartillas, estadisticaEscala, minimoCorrectas, ordenPorJuez, triangular, veredictoRango } from "./sensorial";

describe("LMB · lecturas programadas", () => {
  it("horas configuradas, ordenadas y sin repetir", () => {
    expect(leerHoras("72, 24,48,24")).toEqual([24, 48, 72]);
    expect(leerHoras("")).toEqual([24, 48, 72]);
  });
  it("estado de cada lectura frente a ahora", () => {
    const l = lecturasProgramadas("2026-10-20T10:00:00Z", [24, 48, 72], [{ horas: 24, realizada: "2026-10-21T10:05:00Z" }], new Date("2026-10-22T12:00:00Z"));
    expect(l.map((x) => x.estado)).toEqual(["registrada", "vencida", "pendiente"]);
    expect(lecturasProgramadas(null, [24], [], new Date())).toEqual([]);
  });
});

describe("LMB · recuento ISO 7218", () => {
  it("dos diluciones sucesivas", () => {
    // ΣC = 168+215+14+25 = 422 ; V = 1 ; n1 = 2, n2 = 2 ; d = 10⁻² → 422 / (2,2 · 0,01) = 19 181,8 → 19 000
    const c = recuento({ "2": [168, 215], "3": [14, 25] }, 1);
    expect(c.valor).toBe(19000);
    expect(c.texto).toBe("1,9 × 10⁴");
  });
  it("sin colonias: < LD de la dilución más baja", () => expect(recuento({ "1": [0, 0] }, 1).texto).toBe("< 10"));
  it("sobre el rango contable", () => expect(recuento({ "1": [400, 450] }, 1).texto).toMatch(/^>/));
  it("dos cifras significativas", () => {
    expect(dosCifras(19181.8)).toBe(19000);
    expect(dosCifras(155)).toBe(160);
  });
  it("NMP y presencia/ausencia desde la última lectura", () => {
    const base = { siembra: { fecha: null, medio: null, loteMedio: null, diluciones: [], volumenMl: 1, tecnica: null }, incubacion: { equipoId: null, temperatura: null, inicio: null } };
    expect(calcularMicro({ ...base, tipo: "nmp", lecturas: [{ horas: 48, realizada: "x", nmp: 23, combinacion: "3-1-0" }] }).texto).toBe("23");
    expect(calcularMicro({ ...base, tipo: "presencia", cantidadAnalizada: "25 g", lecturas: [{ horas: 24, realizada: "x", presencia: "ausencia" }] }).texto).toBe("Ausencia en 25 g");
    expect(calcularMicro({ ...base, tipo: "recuento", lecturas: [] }).errores[0]).toMatch(/lectura/);
  });
});

describe("LMB · etapa de confirmación (SAL-01)", () => {
  const base = { siembra: { fecha: "2026-11-17T10:00", medio: null, loteMedio: null, diluciones: [1, 2], volumenMl: 1, tecnica: null }, incubacion: { equipoId: null, temperatura: null, inicio: null } };
  const lecturas = [{ horas: 48, realizada: "x", colonias: { "1": [150, 160], "2": [14, 16] } }];
  it("sin confirmación: el resultado es el de la lectura (presuntivo)", () => {
    const r = resultadoFinal({ ...base, tipo: "recuento", lecturas });
    expect(r.confirmado).toBe(false);
    expect(r.texto).toBe(calcularMicro({ ...base, tipo: "recuento", lecturas }).texto);
  });
  it("con resultado confirmado: el final es el confirmado y deja constancia del presuntivo", () => {
    const r = resultadoFinal({ ...base, tipo: "recuento", lecturas, confirmacion: { fecha: "2026-11-19T10:00", valor: 1234, observacion: "PRUEBA" } });
    expect(r.confirmado).toBe(true);
    expect(r.valor).toBe(1200);
    expect(r.formula).toMatch(/^Confirmado \(presuntivo /);
    expect(r.errores).toEqual([]);
  });
  it("presencia / ausencia confirmada manda sobre la lectura", () => {
    const r = resultadoFinal({ ...base, tipo: "presencia", cantidadAnalizada: "25 g", lecturas: [{ horas: 24, realizada: "x", presencia: "presencia" }], confirmacion: { fecha: "2026-11-19T10:00", presencia: "ausencia" } });
    expect(r.texto).toBe("Ausencia en 25 g");
  });
  it("NMP confirmado sin lectura previa; sin fecha avisa", () => {
    const r = resultadoFinal({ ...base, tipo: "nmp", lecturas: [], confirmacion: { fecha: null, valor: 9.2 } });
    expect(r.texto).toBe("9,2");
    expect(r.errores[0]).toMatch(/fecha de la confirmación/);
  });
  it("solo observación o tipo que no corresponde: no hay confirmado", () => {
    expect(tieneConfirmado("recuento", { fecha: "x", observacion: "PRUEBA" })).toBe(false);
    expect(tieneConfirmado("recuento", { fecha: "x", presencia: "ausencia" })).toBe(false);
    expect(tieneConfirmado("presencia", { fecha: "x", valor: 10 })).toBe(false);
  });
  it("lectura del cuerpo de la petición", () => {
    const e: string[] = [];
    expect(MicroSensorialService.leerConfirmacion({}, e)).toBeNull();
    expect(MicroSensorialService.leerConfirmacion({ valor: "1,5" }, e)?.valor).toBe(1.5);
    expect(e).toEqual(["Indique la fecha de la confirmación."]);
    const e2: string[] = [];
    expect(MicroSensorialService.leerConfirmacion({ fecha: "2026-11-19T10:00", valor: "-3" }, e2)?.valor).toBeNull();
    expect(e2[0]).toMatch(/0 o más/);
  });
});

describe("LMB · plan n, c, m, M del RSA", () => {
  const planes = leerPlanes(JSON.stringify([{ metodo: "428", producto: "", n: 5, c: 2, m: 1000, M: 10000, articulo: "RSA Art. 173" }, { metodo: "429", n: 5, c: 0, m: 0 }, { metodo: "", n: 1 }]));
  it("lee los planes válidos", () => expect(planes).toHaveLength(2));
  it("3 clases: más de c entre m y M no cumple; alguna sobre M no cumple", () => {
    const p = planDe(planes, "428", "Leche")!;
    expect(evaluarPlan(p, [500, 2000, 3000, 900, 800]).veredicto).toBe("cumple");
    expect(evaluarPlan(p, [500, 2000, 3000, 1500, 800]).veredicto).toBe("no_cumple");
    expect(evaluarPlan(p, [500, 20000, 300, 100, 800]).veredicto).toBe("no_cumple");
    expect(evaluarPlan(p, [500, "< 10"]).veredicto).toBe("pendiente");
  });
  it("sin plan: un solo máximo o presencia/ausencia", () => {
    expect(veredictoSimple({ valor: 900, texto: "900", formula: null, errores: [] }, "recuento", 1000, null)).toBe("cumple");
    expect(veredictoSimple({ valor: 1900, texto: "1.900", formula: null, errores: [] }, "recuento", 1000, null)).toBe("no_cumple");
    expect(veredictoSimple({ valor: null, texto: "< 10", formula: null, errores: [] }, "recuento", 100, null)).toBe("cumple");
    expect(veredictoSimple({ valor: null, texto: "Ausencia en 25 g", formula: null, errores: [] }, "presencia", null, "Ausencia en 25 g")).toBe("cumple");
  });
});

describe("LES · panel sensorial", () => {
  it("códigos de 3 dígitos distintos y orden por juez", () => {
    const c = codigosAleatorios(4, 42);
    expect(new Set(c).size).toBe(4);
    expect(c.every((x) => /^\d{3}$/.test(x))).toBe(true);
    expect(codigosAleatorios(4, 42)).toEqual(c);
    const o = ordenPorJuez(c, 3);
    expect(o[1][0]).toBe(c[1]);
    expect(new Set(o.map((x) => x[0])).size).toBe(3);
  });
  it("estadística por atributo y atípicos", () => {
    const cart = [7, 7, 8, 7, 6, 7, 1].map((v, i) => ({ juez: `J${i + 1}`, puntajes: { Aceptabilidad: v } }));
    const e = estadisticaEscala(cart, ["Aceptabilidad"])[0];
    expect(e.n).toBe(7);
    expect(e.atipicos).toEqual(["J7"]);
    const sinJ7 = estadisticaEscala(cart.map((c) => (c.juez === "J7" ? { ...c, excluido: true, motivoExclusion: "Juez atípico" } : c)), ["Aceptabilidad"])[0];
    expect(sinJ7.media).toBe(7);
    expect(veredictoRango(sinJ7.media, { prueba: "Aceptabilidad", atributo: "Aceptabilidad", min: 5, max: 9 })).toBe("cumple");
    expect(veredictoRango(4.2, { prueba: "Aceptabilidad", atributo: "Aceptabilidad", min: 5, max: 9 })).toBe("no_cumple");
    expect(veredictoRango(4.2, undefined)).toBe("informativo");
  });
  it("triangular ISO 4120: mínimo de correctas con α = 0,05", () => {
    expect(minimoCorrectas(12, 0.05)).toBe(8);
    expect(minimoCorrectas(24, 0.05)).toBe(13);
    expect(colaBinomial(3, 0, 1 / 3)).toBeCloseTo(1);
    const t = triangular(Array.from({ length: 12 }, (_, i) => ({ juez: `J${i}`, correcta: i < 9 })), 0.05);
    expect(t).toMatchObject({ n: 12, correctas: 9, minimo: 8, diferencia: true });
    expect(t.conclusion).toMatch(/^Existen diferencias/);
  });
  it("cartillas inválidas", () => {
    expect(erroresCartillas("escala", [{ juez: "J1", puntajes: { A: 12 } }, { juez: "J1", excluido: true }], ["A"]).length).toBe(3);
  });
});
