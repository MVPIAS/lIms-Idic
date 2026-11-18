import { calcularInforme, type FilaEncuesta, type TipoEncuesta } from "./informe-trimestral";
import { codigoAnexo, cuerpoInformeHtml, hojasInforme } from "./informe-trimestral.documento";

const tipo: TipoEncuesta = {
  codigo: "FORM04",
  nombre: "PRUEBA asistencias técnicas",
  formulario: "DCO-PG01-P04-IT05-FORM04",
  formularioRevision: "00",
  instruccion: "DCO-PG01-P04-IT05",
  anexoNumero: "04",
  anexoRevision: "00",
  anexoEmision: "01/01/2000",
  tituloInforme: "INFORME PRUEBA <ASISTENCIAS>",
  objetoInforme: "Encuestas PRUEBA",
  agruparPor: "sucursal",
  notaMaxima: 7,
  umbralPct: 85,
  distribucion: ["DESTINO PRUEBA 1", "DESTINO PRUEBA 2"],
  orden: 4,
};
const fila = (valores: number[], comentario: string | null = null): FilaEncuesta => ({
  id: Math.random().toString(36),
  tipo: "FORM04",
  estado: "registrada",
  fecha: "2026-08-01",
  grupo: "Sucursal PRUEBA",
  referencia: "PIA-PRUEBA-1",
  promedio: null,
  respuestas: valores.map((v, i) => ({ codigo: `F04_0${i + 1}`, texto: `Afirmación PRUEBA ${i + 1}`, valor: v, escala: [1, 2, 3, 4, 5, 6, 7] })),
  comentario,
});

describe("Documento del informe trimestral", () => {
  const inf = calcularInforme([tipo], [fila([7, 7, 6, 7, 7, 7], "Comentario <b>PRUEBA</b>"), fila([7, 7, 7, 7, 7, 7])], 2026, 3);

  it("el PDF lleva el código del anexo y del formulario, los tres cuadros y la distribución, con todo escapado", () => {
    const h = cuerpoInformeHtml(inf);
    expect(codigoAnexo(tipo)).toBe("DCO-PG01-P04-IT05-Anexo04");
    expect(h).toContain("DCO-PG01-P04-IT05-Anexo04");
    expect(h).toContain("DCO-PG01-P04-IT05-FORM04");
    expect(h).toContain("tercer trimestre del año 2026");
    expect(h).toContain("TOTAL Nº DE ENCUESTAS CONTESTADAS</td><td class=\"num\">02");
    expect(h).toContain("<th>SUCURSAL</th>");
    expect(h).toContain("Afirmación PRUEBA 3</td><td class=\"num\">6,5</td><td class=\"num\">93 %");
    expect(h).toContain("INFORME PRUEBA &lt;ASISTENCIAS&gt;");
    expect(h).toContain("Comentario &lt;b&gt;PRUEBA&lt;/b&gt;");
    expect(h).toContain("DESTINO PRUEBA 2");
    expect(h).not.toContain("salto-pagina");
  });

  it("con varios formularios, cada anexo va en su página", () => {
    const dos = calcularInforme([tipo, { ...tipo, codigo: "FORM05", orden: 5 }], [], 2026, 3);
    expect(cuerpoInformeHtml(dos).match(/salto-pagina/g)).toHaveLength(1);
  });

  it("el Excel trae el resumen y la planilla de análisis por formulario (suma, promedio e índice por encuesta)", () => {
    const hs = hojasInforme(inf);
    expect(hs.map((h) => h.nombre)).toEqual(["Resumen", "FORM04 PRUEBA asistencias técni"]);
    expect(hs[0].filas[1].slice(0, 7)).toEqual(["DCO-PG01-P04-IT05-FORM04 · PRUEBA asistencias técnicas", "DCO-PG01-P04-IT05-Anexo04", 2, 2, 100, 6.9, 99]);
    const plan = hs[1].filas;
    expect(plan[0]).toEqual(["Ítem", "Sucursal PRUEBA / PIA-PRUEBA-1", "Sucursal PRUEBA / PIA-PRUEBA-1", "Nota prom.", "Índice prom. (%)"]);
    expect(plan.find((f) => f[0] === "Suma")).toEqual(["Suma", 41, 42]);
    expect(plan.find((f) => f[0] === "Índice satisfacción del cliente (%)")).toEqual(["Índice satisfacción del cliente (%)", 98, 100]);
  });
});

describe("Documento del informe trimestral · preguntas abiertas (FORM02)", () => {
  const t02: TipoEncuesta = { ...tipo, codigo: "FORM02", nombre: "PRUEBA cotizaciones", agruparPor: "laboratorio" };
  const f: FilaEncuesta = {
    ...fila([6, 6]),
    tipo: "FORM02",
    referencia: "COT-PRUEBA-9",
    grupo: "Lab PRUEBA",
    respuestas: [
      { codigo: "F02_01", texto: "Tiempo PRUEBA", valor: 6, escala: [1, 2, 3, 4, 5, 6, 7] },
      { codigo: "F02_RAZON", texto: "Razón PRUEBA", valor: null, escala: [], tipo: "texto", respuesta: "Precio <alto> PRUEBA" },
    ],
  };
  const inf = calcularInforme([t02], [f], 2026, 3);

  it("el PDF lista las razones (escapadas) y la pregunta de texto no es un ítem del cuadro 2", () => {
    const h = cuerpoInformeHtml(inf);
    expect(h).toContain("<h2>Razón PRUEBA</h2>");
    expect(h).toContain("Precio &lt;alto&gt; PRUEBA");
    expect(inf.secciones[0].items.map((i) => i.codigo)).toEqual(["F02_01"]);
  });

  it("el Excel agrega el listado de razones en la planilla del formulario", () => {
    const plan = hojasInforme(inf)[1].filas;
    expect(plan).toContainEqual(["RAZÓN PRUEBA"]);
    expect(plan).toContainEqual(["Lab PRUEBA / COT-PRUEBA-9: Precio <alto> PRUEBA"]);
  });
});
