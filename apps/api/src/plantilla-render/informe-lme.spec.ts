import { configEfectiva } from "./config-informe";
import { armarInforme, filasMetodos, type ResultadoParaInforme } from "./filas-informe";
import { bloqueIdentificacion, bloqueMetodos, bloqueResultados, bloqueTermograma } from "./bloques-informe";

/** Formatos del LME (respuestas del 20-10-2026), tal como los siembra align_recepcion_custodia_equipo_lme.sql. */
const LIMS_LME = configEfectiva("I.ENSAYO", {
  agrupacion: "muestra",
  columnaMetodo: false,
  columnaUnidad: false,
  columnasRequisito: "min_max",
  unidadEnResultado: true,
  textoSinCota: "-.-",
  referencias: false,
  etiquetas: { ensayo: "Análisis", minimo: "Mínimo", maximo: "Máximo", resultado: "Resultado", veredicto: "Condición" },
});
const INTERNO_LME = configEfectiva("I.ENSAYO", {
  agrupacion: "unica",
  columnaMuestra: true,
  columnaMetodo: false,
  columnaUnidad: false,
  unidadEnResultado: true,
  etiquetas: { muestra: "Muestra", ensayo: "Ensayo", requisito: "Requisito", resultado: "Resultado", veredicto: "Condición" },
});

const r = (p: Partial<ResultadoParaInforme>): ResultadoParaInforme => ({
  id: p.id ?? "r1",
  muestraId: p.muestraId ?? "m1",
  muestraCodigo: p.muestraCodigo ?? "OT-1-M1",
  ensayo: p.ensayo ?? "Contenido de nitritos",
  tipoDato: "numerico",
  ...p,
});

describe("Informe del LME · tabla de 5 columnas (Análisis · Mínimo · Máximo · Resultado · Condición)", () => {
  const filas = [
    r({ id: "a", ensayo: "Contenido de nitritos", limiteSup: "0,00", valorNumerico: 0, unidad: "mg/L", veredicto: "cumple" }),
    r({ id: "b", ensayo: "Pureza", limiteInf: "95", valorNumerico: 97.75, unidad: "%", veredicto: "cumple" }),
  ];
  const html = bloqueResultados(armarInforme(filas, LIMS_LME, "cumplimiento"), LIMS_LME);

  it("cabecera de 5 columnas, sin método ni unidad aparte", () => {
    const ths = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(ths).toEqual(["Análisis", "Mínimo", "Máximo", "Resultado", "Condición"]);
  });

  it("cota vacía como «-.-» y la unidad junto al resultado", () => {
    expect(html).toContain('<td class="num">-.-</td><td class="num">0,00</td><td>0 mg/L</td>');
    expect(html).toContain('<td class="num">95</td><td class="num">-.-</td><td>97,75 %</td>');
    expect(html).toContain("Cumple");
  });
});

describe("Informe interno del LME · Muestra · Ensayo · Requisito · Resultado · Condición", () => {
  const filas = [
    r({ id: "a", muestraId: "m1", muestraCodigo: "OT-1-M1", ensayo: "Composición", requisito: "Nitrocelulosa", valorTexto: "Nitrocelulosa", tipoDato: "atributo", veredicto: "cumple" }),
    r({ id: "b", muestraId: "m2", muestraCodigo: "OT-1-M2", ensayo: "Humedad", limiteSup: "1", valorNumerico: 0.05, unidad: "%", veredicto: "cumple" }),
  ];
  const est = armarInforme(filas, INTERNO_LME, "cumplimiento");
  const html = bloqueResultados(est, INTERNO_LME);

  it("una sola tabla, sin títulos por muestra, con la columna Muestra", () => {
    expect(est.secciones).toHaveLength(1);
    expect(html).not.toContain("<h3>");
    const ths = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(ths).toEqual(["Muestra", "Ensayo", "Requisito", "Resultado", "Condición"]);
    expect(html).toContain("<td>OT-1-M2</td><td>Humedad</td><td>Máx. 1 %</td><td>0,05 %</td>");
  });

  it("D01-13 · el requisito del catálogo lleva su unidad aunque el resultado también la lleve («Mín. 97 %»)", () => {
    const html = bloqueResultados(
      armarInforme([r({ id: "c", ensayo: "Cloruro de sodio", limiteInf: "97", valorNumerico: 98.196, unidad: "%", veredicto: "cumple" })], INTERNO_LME, "cumplimiento"),
      INTERNO_LME,
    );
    expect(html).toContain("<td>Mín. 97 %</td><td>98,196 %</td>");
  });

  it("aun con una sola muestra, la columna Muestra se mantiene", () => {
    const una = armarInforme([filas[0]], INTERNO_LME, "cumplimiento");
    expect(una.mostrarMuestra).toBe(true);
  });
});

describe("Bloques del informe para cliente externo (IDIC-PG09 Anexo 02-02 rev05)", () => {
  it("3.1 normas y métodos con la fecha y hora del análisis", () => {
    const f = filasMetodos([
      r({ id: "a", ensayo: "Explosividad", metodoNombre: "Calorimetría diferencial", metodoNorma: "EPA OPPTS 830.6316", fechaEnsayo: "2025-08-20T12:30:00Z" }),
      r({ id: "b", ensayo: "Explosividad", metodoNombre: "Calorimetría diferencial", metodoNorma: "EPA OPPTS 830.6316", fechaEnsayo: "2025-08-25T13:30:00Z" }),
      r({ id: "c", ensayo: "Humedad", metodoNombre: "Gravimetría", fechaEnsayo: null }),
    ]);
    expect(f).toHaveLength(2);
    expect(f[0].fechas).toBe("20.AGO.25 (08:30) – 25.AGO.25 (09:30)");
    expect(f[1].fechas).toBe("—");
    expect(bloqueMetodos(f)).toContain("<th>Fecha del análisis</th>");
  });

  it("termograma con su pie; vacío si no hay", () => {
    expect(bloqueTermograma([])).toBe("");
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const html = bloqueTermograma([{ mime: "image/png", datos: png, pie: "DSC <b>", punto: null, titulo: "Muestra OT-1-M1" }]);
    expect(html).toContain("Termograma 1 · Muestra OT-1-M1 · DSC &lt;b&gt;");
    expect(bloqueTermograma([{ mime: "image/gif", datos: png, pie: null, punto: null, titulo: null }])).toBe("");
  });

  it("identificación de la muestra con Nº interno, producto y datos de recepción, escapados", () => {
    const html = bloqueIdentificacion([
      { codigo: "OT-1-M1", nombre: "Flonicamid técnico", numeroInterno: "427218", producto: "Nitrato de amonio", cliente: null,
        identificacionCliente: "<script>", datos: [{ etiqueta: "Lote", valor: "20220110" }] },
    ]);
    expect(html).toContain("Muestra OT-1-M1 · Nº 427218");
    expect(html).toContain("Lote: 20220110");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
