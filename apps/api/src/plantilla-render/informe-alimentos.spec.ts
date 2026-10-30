import { configEfectiva } from "./config-informe";
import { armarInforme, modalidadInicial, type ResultadoParaInforme } from "./filas-informe";
import { bloqueResultados } from "./bloques-informe";
import { antecedentesInforme, datosRecepcionInforme, NO_APLICA } from "./antecedentes-informe";

/** Formatos de Alimentos (EP-02 5.1, revisión 29-10), tal como los siembra align_ali_alimentos.sql. */
const IVC_ALI = configEfectiva("PLANILLA", {
  agrupacion: "muestra",
  columnaMetodo: false,
  columnaUnidad: false,
  columnasRequisito: "min_max_otros",
  referencias: false,
  anexoFotografico: false,
  modalidadPorDefecto: "cumplimiento",
  etiquetas: { ensayo: "Análisis", minimo: "Mín.", maximo: "Máx.", otros: "Otros", resultado: "Resultado", veredicto: "Observ." },
});
const IE_ALI = configEfectiva("I.ENSAYO", {
  agrupacion: "muestra",
  columnaMetodo: false,
  columnaUnidad: true,
  referencias: false,
  modalidadPorDefecto: "solo_resultados",
  etiquetas: { ensayo: "Ensayos", resultado: "Resultado" },
});

const r = (p: Partial<ResultadoParaInforme>): ResultadoParaInforme => ({
  id: p.id ?? "r1",
  muestraId: p.muestraId ?? "m1",
  muestraCodigo: p.muestraCodigo ?? "OT-PRUEBA-0002-M1",
  ensayo: p.ensayo ?? "Recuento de aerobios mesófilos",
  tipoDato: "numerico",
  ...p,
});

const filas = [
  r({ id: "a", ensayo: "Salmonella en 25 g", nominal: "Ausencia", tipoDato: "texto", valorTexto: "Ausencia", veredicto: "cumple" }),
  r({ id: "b", ensayo: "Recuento de aerobios mesófilos", limiteSup: "100000", valorNumerico: 40, unidad: "ufc/g", veredicto: "cumple" }),
];
const cabeceras = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);

describe("Reporte I.V.C. de Alimentos · Análisis · Mín. · Máx. · Otros · Resultado · Observ.", () => {
  const modalidad = modalidadInicial(IVC_ALI, filas);
  const html = bloqueResultados(armarInforme(filas, IVC_ALI, modalidad), IVC_ALI);
  it("propone cumplimiento y arma la cabecera de seis columnas", () => {
    expect(modalidad).toBe("cumplimiento");
    expect(cabeceras(html)).toEqual(["Análisis", "Mín.", "Máx.", "Otros", "Resultado", "Observ."]);
  });
  it("el requisito de texto va en «Otros» y el máximo en su columna", () => {
    expect(html).toMatch(/Salmonella en 25 g<\/td><td class="num">—<\/td><td class="num">—<\/td><td>Ausencia<\/td><td>Ausencia/);
    expect(html).toMatch(/<td class="num">100000<\/td><td>—<\/td><td>40/);
    expect(html).toContain("Cumple");
  });
  it("un requisito de atributo (P/A) sin cotas también va en «Otros»", () => {
    const pa = [r({ id: "c", ensayo: "Salmonella", requisito: "Ausencia en 25 g", tipoDato: "atributo", valorTexto: "Ausencia", veredicto: "cumple" })];
    const h = bloqueResultados(armarInforme(pa, IVC_ALI, "cumplimiento"), IVC_ALI);
    expect(h).toMatch(/<td class="num">—<\/td><td class="num">—<\/td><td>Ausencia en 25 g<\/td>/);
  });
});

describe("Informe de Ensayos de Alimentos · solo resultados por defecto", () => {
  it("la plantilla fija la modalidad aunque los ensayos tengan requisito", () => {
    expect(modalidadInicial(IE_ALI, filas)).toBe("solo_resultados");
    const html = bloqueResultados(armarInforme(filas, IE_ALI, "solo_resultados"), IE_ALI);
    expect(cabeceras(html)).toEqual(["Ensayos", "Unidad", "Resultado"]);
    expect(html).not.toContain("Cumple");
  });
  it("sin modalidad fija sigue la sugerida", () => {
    expect(modalidadInicial(configEfectiva("I.ENSAYO", {}), filas)).toBe("cumplimiento");
    expect(modalidadInicial(configEfectiva("I.ENSAYO", {}), [r({ valorNumerico: 1 })])).toBe("solo_resultados");
  });
  it("un valor desconocido de modalidad o columnas se ignora", () => {
    const c = configEfectiva("I.ENSAYO", { modalidadPorDefecto: "otra", columnasRequisito: "cuatro" });
    expect(c.modalidadPorDefecto).toBe("sugerida");
    expect(c.columnasRequisito).toBe("texto");
  });
});

describe("Antecedentes del informe (muestreo, recepción, análisis, temperatura)", () => {
  // 07-09-2026 11:09 y 11:50 en Chile (UTC−3 en septiembre) y análisis a las 15:30.
  const toma = new Date("2026-09-07T14:09:00Z");
  const recep = new Date("2026-09-07T14:50:00Z");
  const analisis = new Date("2026-09-07T18:30:00Z");
  it("toma lo más temprano y formatea en hora de Chile", () => {
    const a = antecedentesInforme(
      [{ fechaTomaMuestra: toma, recepcionadaAt: recep, temperaturaRecepcion: 3.8, formularioMuestreo: "FORM-PRUEBA-01" }],
      [analisis, null],
      {},
      { contactoTelefono: "", telefono: "221234567" },
    );
    expect(a).toEqual({
      muestreo: "07-09-2026 11:09",
      recepcion: "07-09-2026 11:50",
      analisis: "07-09-2026 15:30",
      temperatura: "3,8 °C",
      formulario: "FORM-PRUEBA-01",
      contacto: "221234567",
    });
  });
  it("sin datos imprime «No aplica» y la recepción cae en la fecha de la OT", () => {
    const a = antecedentesInforme([{}], [], { fechaRecepcion: recep });
    expect(a.muestreo).toBe(NO_APLICA);
    expect(a.analisis).toBe(NO_APLICA);
    expect(a.temperatura).toBe(NO_APLICA);
    expect(a.recepcion).toBe("07-09-2026 11:50");
    expect(a.contacto).toBe(NO_APLICA);
  });
  it("varias muestras: temperaturas y formularios distintos, sin repetir", () => {
    const a = antecedentesInforme(
      [{ temperaturaRecepcion: "3.8", formularioMuestreo: "F-1" }, { temperaturaRecepcion: 3.8, formularioMuestreo: "F-2" }, { temperaturaRecepcion: -18 }],
      [],
    );
    expect(a.temperatura).toBe("3,8 °C / -18 °C");
    expect(a.formulario).toBe("F-1 / F-2");
  });
  it("la identificación de la muestra lleva solo lo que tiene valor", () => {
    expect(datosRecepcionInforme({ temperaturaRecepcion: 3.8, formularioMuestreo: " FORM-PRUEBA-01 " })).toEqual([
      { etiqueta: "Temperatura de recepción", valor: "3,8 °C" },
      { etiqueta: "Formulario de muestreo", valor: "FORM-PRUEBA-01" },
    ]);
    expect(datosRecepcionInforme({ fechaTomaMuestra: toma })).toEqual([{ etiqueta: "Fecha y hora de toma de muestra", valor: "07-09-2026 11:09" }]);
    expect(datosRecepcionInforme({})).toEqual([]);
  });
});
