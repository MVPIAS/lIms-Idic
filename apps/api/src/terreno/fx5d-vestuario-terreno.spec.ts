/**
 * Correcciones v4 (recorrido de manuales 12-11-2026), frente fx5-d · Vestuario, DSA y terreno.
 */
import { bloqueResultadosTerreno, faltantesInformeTerreno } from "./reglas-terreno";
import { faltantesParaEmitir } from "../plantilla-render/reglas-emision";
import { calcularAvance, terrenoPorAbrir, tipoRuta, type HechosOt } from "../ot/avance-ot";
import { advertenciaNumerica, margenDeLimite } from "../laboratorio/advertencia";
import { planEdicion } from "../laboratorio/especificacion";
import { motivoNoDefinePlanLaboratorio } from "../muestreo/reglas-muestreo";
import { cambiosEspecificacion, textoRequisito } from "../../../web/lib/especificaciones";
import { faltaObservacion, itemNoCumple, primerItemSinObservacion } from "../../../web/lib/hcp";

describe("F083 · OT del SVM en terreno: informe con los resultados del terreno", () => {
  it("sin captura normal, emite con el terreno cerrado y su IVC", () => {
    expect(faltantesParaEmitir([], "IVC", { cerrado: true, ivcGrado: "cumple" })).toEqual([]);
  });
  it("con el terreno abierto o sin IVC, dice qué falta (no «no tiene resultados»)", () => {
    const f = faltantesParaEmitir([], "IVC", { cerrado: false, ivcGrado: null });
    expect(f.join(" ")).toMatch(/Emita primero el IVC/);
    expect(f.join(" ")).toMatch(/Cierre primero el trabajo en terreno/);
    expect(f.join(" ")).not.toMatch(/no tiene resultados/);
  });
  it("sin terreno sigue la regla de siempre", () => {
    expect(faltantesParaEmitir([], "IVC", null)[0]).toMatch(/no tiene resultados registrados/);
    expect(faltantesInformeTerreno(null)).toBeNull();
  });
  it("con resultados de la captura normal, el terreno no cambia nada", () => {
    expect(faltantesParaEmitir([{ estado: "capturado" }], "IVC", { cerrado: true, ivcGrado: "cumple" })[0]).toMatch(/sin/);
  });
  it("la tabla del informe trae el grado, el resultado por sistema y cada prueba (escapado)", () => {
    const html = bloqueResultadosTerreno({
      lugar: "Regimiento <PRUEBA>", ivcNumero: "IVC-1", ivcGrado: "no_cumple", conclusion: "PRUEBA",
      pruebas: [
        { sistema: "Frenos", prueba: "Frenado", requisito: "≤ 12 m", resultado: "cumple", observacion: null, unidad: "Chasis 1" },
        { sistema: "Dirección", prueba: "Giro", requisito: "≤ 15 m", resultado: "no_cumple", observacion: "17 m", unidad: null },
      ],
    });
    expect(html).toContain("Grado de cumplimiento: <b>No cumple</b>");
    expect(html).toContain("Regimiento &lt;PRUEBA&gt;");
    expect(html).toContain("IVC N° IVC-1");
    expect(html).toMatch(/<td>Frenos<\/td><td class="num">1<\/td><td class="ok">Cumple<\/td>/);
    expect(html).toMatch(/<td>Dirección<\/td><td class="num">1<\/td><td class="no">No cumple<\/td>/);
    expect(html).toContain("17 m");
  });
});

describe("F086 · OT de laboratorio en terreno aún sin abrir", () => {
  const base = (p: Partial<HechosOt> = {}): HechosOt => ({
    id: "ot-1", codigo: "OT-2026-0093", estado: "recepcionada", origen: "INSTITUCIONAL", conCobro: false, unidad: { codigo: "SVM" },
    cotizacion: null, muestras: { total: 0, recepcionIncompleta: 0 }, analistas: [],
    resultados: { total: 0, pendientes: 0, capturados: 0, revisados: 0, aprobados: 0, devueltos: 0 }, documentos: [], factura: null, ...p,
  } as HechosOt);
  it("sin elementos, la OT indica abrir el trabajo en terreno (no recepcionar muestras)", () => {
    const h = base({ terrenoAplica: true, terreno: null });
    expect(terrenoPorAbrir(h)).toBe(true);
    expect(tipoRuta(h)).toBe("terreno");
    const a = calcularAvance(h);
    expect(a.etapaActual).toBe("terreno_apertura");
    expect(a.siguiente?.accion?.pestana).toBe("terreno");
    expect(JSON.stringify(a.siguiente)).not.toMatch(/Recepci/);
  });
  it("con muestras o muestreo, sigue la ruta de laboratorio", () => {
    expect(terrenoPorAbrir(base({ terrenoAplica: true, muestras: { total: 2, recepcionIncompleta: 0 } }))).toBe(false);
    expect(terrenoPorAbrir(base({ terrenoAplica: true, requiereMuestreo: true }))).toBe(false);
    expect(terrenoPorAbrir(base({ terrenoAplica: false }))).toBe(false);
  });
});

describe("F089 · margen de advertencia en rangos abiertos o poco realistas", () => {
  it("206 g/m² con rango 1–3.000 no está en advertencia", () => {
    expect(advertenciaNumerica(206, "1", "3000", 10)).toBeNull();
    // El margen del Mín es el 10 % de 1 (0,1), no el 10 % del ancho (299,9).
    expect(margenDeLimite(1, 3000, 10)).toBeCloseTo(0.1, 12);
  });
  it("cerca del Máx de ese mismo rango sí avisa (10 % de 3.000, con tope en el 10 % del ancho)", () => {
    expect(advertenciaNumerica(2800, "1", "3000", 10)).toMatch(/a 200 del Máx 3000/);
    expect(advertenciaNumerica(2600, "1", "3000", 10)).toBeNull();
  });
  it("en un intervalo estrecho manda el 10 % del ancho, como antes", () => {
    expect(margenDeLimite(6, 8, 10)).toBeCloseTo(0.2, 12);
    expect(advertenciaNumerica(7.85, "6", "8", 10)).toMatch(/a 0,15 del Máx 8/);
    expect(advertenciaNumerica(6.3, "6", "8", 10)).toBeNull();
  });
  it("con un solo límite, el % del límite", () => {
    expect(advertenciaNumerica(1.6, "1,5", null, 10)).toMatch(/del Mín 1,5/);
    expect(advertenciaNumerica(1.7, "1,5", null, 10)).toBeNull();
  });
});

describe("F084 · ensayos de la E.T. con límites escritos con coma", () => {
  const claves = ["limiteInf", "nominal", "limiteSup", "unidad"];
  it("«1,5» de la E.T. y «1.5» del editor no son un cambio (el analista captura sin la jefatura)", () => {
    expect(cambiosEspecificacion({ limiteInf: "1,5", unidad: "kgf/mm²" }, { limiteInf: "1,5", unidad: "kgf/mm²" }, claves)).toEqual({});
    expect(cambiosEspecificacion({ limiteInf: "1,0", nominal: "1,1", limiteSup: "1,2" }, { limiteInf: "1.0", nominal: "1,1", limiteSup: "1,2" }, claves)).toEqual({});
  });
  it("un cambio real sí cuenta", () => {
    expect(cambiosEspecificacion({ limiteInf: "1,5" }, { limiteInf: "1,6" }, claves)).toEqual({ limiteInf: "1.6" });
    expect(cambiosEspecificacion({ limiteInf: "1,5" }, { limiteInf: "" }, claves)).toEqual({ limiteInf: null });
  });
  it("el servidor tampoco lo toma como cambio (no se pierde la marca E.T.)", () => {
    const plan = planEdicion({ limiteInf: "1,5", unidad: "kgf/mm²" }, { limiteInf: "1,5" }, { limiteInf: "1.5", unidad: "kgf/mm²" });
    expect(plan.campos).toEqual([]);
  });
});

describe("F085 · plan NCh 44 definido por el laboratorio", () => {
  it("se define con el muestreo entregado o recibido, antes de concluir el lote", () => {
    expect(motivoNoDefinePlanLaboratorio({ estado: "registrado", tamanoLote: 500 })).toBeNull();
    expect(motivoNoDefinePlanLaboratorio({ estado: "recibido", tamanoLote: 500, veredictoLote: null })).toBeNull();
  });
  it("no en borrador, anulado, concluido o sin tamaño del lote", () => {
    expect(motivoNoDefinePlanLaboratorio({ estado: "borrador", tamanoLote: 500 })).toMatch(/aún no se entrega/);
    expect(motivoNoDefinePlanLaboratorio({ estado: "anulado", tamanoLote: 500 })).toMatch(/anulado/);
    expect(motivoNoDefinePlanLaboratorio({ estado: "recibido", tamanoLote: 500, veredictoLote: "acepta" })).toMatch(/concluido/);
    expect(motivoNoDefinePlanLaboratorio({ estado: "recibido", tamanoLote: null })).toMatch(/tamaño del lote/);
  });
});

describe("F087 · HCP: la observación obligatoria lleva al campo", () => {
  const items = [
    { item: "4.1.1", min: null, max: null },
    { item: "4.2.1", min: null, max: 15 },
  ];
  it("un ítem cuantitativo fuera de límite no cumple y exige observación", () => {
    expect(itemNoCumple(items[1], { valorTxt: "17" })).toBe(true);
    expect(faltaObservacion(items[1], { valorTxt: "17" })).toBe(true);
    expect(faltaObservacion(items[1], { valorTxt: "17", observacion: "Giro de 17 m" })).toBe(false);
    expect(itemNoCumple(items[1], { valorTxt: "14,5" })).toBe(false);
  });
  it("el primer ítem sin observación es al que se lleva el foco", () => {
    expect(primerItemSinObservacion(items, { "4.1.1": { resultado: "C" }, "4.2.1": { valorTxt: "17" } })).toBe("4.2.1");
    expect(primerItemSinObservacion(items, { "4.1.1": { resultado: "NC" }, "4.2.1": { valorTxt: "17" } })).toBe("4.1.1");
    expect(primerItemSinObservacion(items, { "4.1.1": { resultado: "C" } })).toBeNull();
  });
});

describe("F090 · el plan de componentes muestra el requisito completo", () => {
  it("con la segunda condición de la E.T.", () => {
    expect(textoRequisito({ tipo: "ensayo", limiteInf: "1,5", unidad: "kgf/mm²", cond2Etiqueta: "Alargamiento a la rotura", cond2Inf: 30, cond2Unidad: "%" }))
      .toBe("≥ 1,5 kgf/mm² con Alargamiento a la rotura ≥ 30 %");
  });
});
