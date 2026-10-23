import { configPorTipo } from "./config-informe";
import {
  armarInforme,
  modalidadSugerida,
  textoMetodo,
  textoRequisito,
  textoResultado,
  unirY,
  type ResultadoParaInforme,
} from "./filas-informe";

let n = 0;
const r = (x: Partial<ResultadoParaInforme>): ResultadoParaInforme => ({
  id: `r${++n}`,
  muestraId: "m1",
  muestraCodigo: "OT-1-M1",
  muestraNombre: "Agua de pozo",
  ensayo: "pH",
  ...x,
});

describe("informe · requisito", () => {
  it("Mín y Máx → rango con coma decimal", () => {
    expect(textoRequisito({ limiteInf: "6.5", limiteSup: "8,5" })).toBe("6,5 – 8,5");
  });
  it("nominal con cotas simétricas → nominal ± tolerancia (Textil)", () => {
    expect(textoRequisito({ limiteInf: "10,2", nominal: "10,5", limiteSup: "10,8" })).toBe("10,5 ± 0,3");
  });
  it("nominal con cotas asimétricas → nominal (mín – máx)", () => {
    expect(textoRequisito({ limiteInf: "10", nominal: "10,5", limiteSup: "12" })).toBe("10,5 (10 – 12)");
  });
  it("solo Mín / solo Máx / solo nominal", () => {
    expect(textoRequisito({ limiteInf: "2.5" })).toBe("Mín. 2,5");
    expect(textoRequisito({ limiteSup: "0.05" })).toBe("Máx. 0,05");
    expect(textoRequisito({ nominal: "Lo declarado" })).toBe("Lo declarado");
  });
  it("requisito descriptivo (texto) y texto con cotas", () => {
    expect(textoRequisito({ requisito: "100 % Poliamida raquelado" })).toBe("100 % Poliamida raquelado");
    expect(textoRequisito({ requisito: "Grasas", limiteInf: "6", limiteSup: "15" })).toBe("Grasas (6 – 15)");
  });
  it("sin nada → vacío", () => {
    expect(textoRequisito({})).toBe("");
  });
});

describe("informe · resultado y método", () => {
  it("numérico: fórmula > valor > promedio", () => {
    expect(textoResultado(r({ resultadoFinal: 7.25, valorNumerico: 7, promedio: 7 }))).toBe("7,25");
    expect(textoResultado(r({ valorNumerico: 0.3 }))).toBe("0,3");
    expect(textoResultado(r({ promedio: 12.5 }))).toBe("12,5");
  });
  it("atributo: el texto observado, o Cumple / No cumple", () => {
    expect(textoResultado(r({ tipoDato: "atributo", valorTexto: "Tafetán", veredicto: "cumple" }))).toBe("Tafetán");
    expect(textoResultado(r({ tipoDato: "atributo", veredicto: "no_cumple" }))).toBe("No cumple");
  });
  it("sin valor → «Sin resultado» (nunca un guion ambiguo)", () => {
    expect(textoResultado(r({}))).toBe("Sin resultado");
  });
  it("método: la norma; con el nombre si aporta", () => {
    expect(textoMetodo({ ensayo: "Composición", metodoNombre: "Composición", metodoNorma: "ASTM D 629" })).toBe("ASTM D 629");
    expect(textoMetodo({ ensayo: "Ancho", metodoNombre: "Dimensiones", metodoNorma: "NCh 1597" })).toBe("Dimensiones (NCh 1597)");
    // «Agua» / «Cueros» son categorías del catálogo heredado, no normas.
    expect(textoMetodo({ ensayo: "Arsénico (dilución)", metodoNombre: "Arsénico", metodoNorma: "Agua" })).toBe("Arsénico");
    expect(textoMetodo({ ensayo: "pH", metodoNombre: "pH", metodoNorma: "Cueros" })).toBe("pH");
    expect(textoMetodo({ ensayo: "x", metodoNorma: "Gravimetria" })).toBe("Gravimetria");
    expect(textoMetodo({ ensayo: "pH", metodoNombre: "pH", metodoNorma: null })).toBe("pH");
    expect(textoMetodo({ ensayo: "x" })).toBe("");
  });
  it("unirY", () => {
    expect(unirY(["a"])).toBe("a");
    expect(unirY(["a", "b", "c"])).toBe("a, b y c");
  });
});

describe("informe · modalidad", () => {
  it("cumplimiento si algún ensayo tiene requisito; si ninguno, solo resultados", () => {
    expect(modalidadSugerida([{ limiteSup: "1" }, {}])).toBe("cumplimiento");
    expect(modalidadSugerida([{ requisito: "Tafetán" }])).toBe("cumplimiento");
    expect(modalidadSugerida([{}, { limiteInf: " " }])).toBe("solo_resultados");
    expect(modalidadSugerida([])).toBe("solo_resultados");
  });
});

describe("informe · armarInforme (agrupado por muestra, Químicos)", () => {
  const datos = [
    r({ ensayo: "pH", limiteInf: "6,5", limiteSup: "8,5", valorNumerico: 7.2, veredicto: "cumple", metodoNombre: "pH" }),
    r({ ensayo: "Azufre", unidad: "%", limiteInf: "0", limiteSup: "0,5", especOrigen: "orden", promedio: 0.3, desviacion: 0.01, cv: 3.33, nReplicas: 3, veredicto: "cumple" }),
    r({ ensayo: "Cloruro", valorNumerico: 300, veredicto: "informativo" }),
    r({ muestraId: "m2", muestraCodigo: "OT-1-M2", muestraNombre: null, ensayo: "pH", limiteInf: "6,5", limiteSup: "8,5", valorNumerico: 9, veredicto: "no_cumple" }),
  ];
  const est = armarInforme(datos, configPorTipo("I.ENSAYO"), "cumplimiento");

  it("una sección por muestra, sin numerar, con el ensayo y el requisito de cada fila", () => {
    expect(est.secciones.map((s) => [s.numero, s.titulo])).toEqual([
      [null, "Muestra OT-1-M1 · Agua de pozo"],
      [null, "Muestra OT-1-M2"],
    ]);
    const filas = est.secciones[0].componentes[0].filas;
    expect(filas.map((f) => f.ensayo)).toEqual(["pH", "Azufre", "Cloruro"]);
    expect(filas.map((f) => f.requisito)).toEqual(["6,5 – 8,5", "0 – 0,5", "No especificado"]);
    expect(filas.map((f) => f.requisitoOrigen)).toEqual(["catalogo", "orden", null]);
    expect(filas.map((f) => f.veredictoTexto)).toEqual(["Cumple", "Cumple", "Informativo"]);
  });

  it("veredicto de cada muestra y de la OT", () => {
    expect(est.veredictosMuestra.map((v) => [v.codigo, v.veredicto])).toEqual([
      ["OT-1-M1", "cumple"],
      ["OT-1-M2", "no_cumple"],
    ]);
    expect(est.veredictoOt).toBe("no_cumple");
  });

  it("marca el requisito de la orden y muestra DE/CV si hay réplicas", () => {
    expect(est.hayRequisitoDeOrden).toBe(true);
    expect(est.mostrarEstadisticas).toBe(true);
  });

  it("solo resultados: sin veredicto ni referencias", () => {
    const solo = armarInforme(datos, configPorTipo("I.ENSAYO"), "solo_resultados");
    expect(solo.secciones[1].componentes[0].filas[0].veredictoTexto).toBe("");
    expect(solo.referencias).toEqual([]);
    expect(solo.hayRequisitoDeOrden).toBe(false);
  });

  it("un ensayo sin nombre no sale como guion", () => {
    const e = armarInforme([r({ ensayo: null })], configPorTipo(null), "cumplimiento");
    expect(e.secciones[0].componentes[0].filas[0].ensayo).toBe("Ensayo sin nombre en el catálogo");
  });
});

describe("informe · armarInforme (secciones numeradas, Textil / LCC)", () => {
  const cfg = configPorTipo("IVC"); // agrupación por sección, numeración desde 4
  const datos = [
    r({ ensayo: "Composición", requisito: "100 % Poliamida", valorTexto: "100 % Poliamida", tipoDato: "atributo", veredicto: "cumple", seccion: "Materiales", componente: "Tela base", orden: 1 }),
    r({ ensayo: "Color instrumental", requisito: "ΔE ≤ 1", valorTexto: "ΔE 2,1", tipoDato: "atributo", veredicto: "no_cumple", seccion: "Materiales", componente: "Tela base", orden: 2 }),
    r({ ensayo: "Peso", limiteSup: "300", valorNumerico: 320, veredicto: "no_cumple", seccion: "Materiales", componente: "Material de protección", orden: 3 }),
    r({ ensayo: "Ancho guante", limiteInf: "10,2", nominal: "10,5", limiteSup: "10,8", valorNumerico: 11, veredicto: "no_cumple", seccion: "Dimensiones", orden: 4 }),
  ];
  const est = armarInforme(datos, cfg, "cumplimiento");

  it("numera 4.1 Materiales › 4.1.1 Tela base, 4.1.2 Material de protección; 4.2 Dimensiones", () => {
    expect(est.secciones.map((s) => [s.numero, s.titulo])).toEqual([
      ["4.1", "Materiales"],
      ["4.2", "Dimensiones"],
    ]);
    expect(est.secciones[0].componentes.map((c) => [c.numero, c.titulo])).toEqual([
      ["4.1.1", "Tela base"],
      ["4.1.2", "Material de protección"],
    ]);
    expect(est.secciones[1].componentes.map((c) => c.numero)).toEqual([null]);
    expect(est.secciones[1].componentes[0].filas[0].requisito).toBe("10,5 ± 0,3");
  });

  it("referencias automáticas: un punto por componente con sus No cumple", () => {
    expect(est.referencias.map((x) => x.texto)).toEqual([
      "Punto 4.1.1 Tela base no cumple con Color instrumental.",
      "Punto 4.1.2 Material de protección no cumple con Peso.",
      "Punto 4.2 Dimensiones no cumple con Ancho guante.",
    ]);
  });

  it("punto de cada ensayo para el pie de las fotos", () => {
    expect(est.puntoDe[datos[0].id]).toEqual({ punto: "4.1.1", titulo: "Tela base" });
    expect(est.puntoDe[datos[3].id]).toEqual({ punto: "4.2", titulo: "Dimensiones" });
  });

  it("sin sección fijada, la sección es la muestra", () => {
    const e = armarInforme([r({ ensayo: "Ligamento" })], cfg, "cumplimiento");
    expect(e.secciones[0].titulo).toBe("Muestra OT-1-M1 · Agua de pozo");
    expect(e.secciones[0].numero).toBe("4.1");
  });
});

describe("B-025 · requisito compuesto de la E.T.", () => {
  const { textoRequisito: tr, textoResultado: tres } = require("./filas-informe");
  const c2 = { etiqueta: "Alargamiento", inf: 30, sup: null, unidad: "%" };
  it("imprime la segunda condición con su valor", () => {
    expect(tr({ limiteInf: "1,5", nominal: null, limiteSup: null, requisito: null, unidad: "kgf/mm²", condicion2: c2 }))
      .toBe("Mín. 1,5 kgf/mm² con Alargamiento ≥ 30 %");
  });
  it("sin segunda condición el requisito no cambia", () => {
    expect(tr({ limiteInf: "1,5", nominal: null, limiteSup: null, requisito: null, unidad: "kgf/mm²" })).toBe("Mín. 1,5");
  });
  it("el resultado imprime también el valor de la segunda condición", () => {
    expect(tres({ id: "r", muestraId: "m", muestraCodigo: "M-1", ensayo: "Tracción", valorNumerico: 1.8, condicion2: c2, valorCondicion2: 42 }))
      .toBe("1,8 · Alargamiento 42 %");
  });
});

describe("B-075 · requisito con unidad y sin repetir las cotas", () => {
  const { textoRequisito: tr, requisitoConUnidad: ru } = require("./filas-informe");
  it("no repite entre paréntesis las cotas que el texto ya dice", () => {
    expect(tr({ limiteInf: null, nominal: null, limiteSup: "0,5", requisito: "Máx. 0,5 % (NCh 2190)" })).toBe("Máx. 0,5 % (NCh 2190)");
    expect(tr({ limiteInf: null, nominal: null, limiteSup: "0.5", requisito: "Máx. 0,5 %" })).toBe("Máx. 0,5 %");
    expect(tr({ limiteInf: "97", nominal: null, limiteSup: null, requisito: "Pureza" })).toBe("Pureza (Mín. 97)");
    // 0,05 no es 0,5: sí se añade.
    expect(tr({ limiteInf: null, nominal: null, limiteSup: "0,05", requisito: "Máx. 0,5 %" })).toBe("Máx. 0,5 % (Máx. 0,05)");
  });
  it("añade la unidad al requisito cuando no hay columna de unidad", () => {
    expect(ru("Mín. 97", "%")).toBe("Mín. 97 %");
    expect(ru("Máx. 0,5 %", "%")).toBe("Máx. 0,5 %");
    expect(ru("Sin formación de grumos", "%")).toBe("Sin formación de grumos");
    expect(ru("Mín. 97", null)).toBe("Mín. 97");
  });
});

describe("B-075 · ensayo derivado por orden interna", () => {
  const { armarInforme: ai } = require("./filas-informe");
  const { configEfectiva } = require("./config-informe");
  it("identifica el laboratorio que lo realizó", () => {
    const est = ai([{ id: "r1", muestraId: "m", muestraCodigo: "M-1", ensayo: "Plomo", valorNumerico: 0.01, derivadoA: { laboratorio: "LQC", ordenInterna: "OI-2026-0003" } }], configEfectiva("I.ENSAYO", null), "solo_resultados");
    const filas = est.secciones.flatMap((s: any) => s.componentes.flatMap((c: any) => c.filas));
    expect(filas[0].ensayo).toBe("Plomo (realizado por LQC, orden interna OI-2026-0003)");
  });
});
