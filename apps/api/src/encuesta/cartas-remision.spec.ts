import { armarCarta, CARTAS, cuerpoCartaHtml, filasCarta, periodoCarta, textoCarta, type FilaCarta, type Periodo } from "./cartas-remision";

const per = (x: Periodo | { error: string }): Periodo => {
  if ("error" in x) throw new Error(x.error);
  return x;
};

let n = 0;
const fila = (extra: Partial<FilaCarta>): FilaCarta => ({
  id: `c${++n}`,
  tipo: "FORM01",
  formulario: "DCO-PG01-P04-IT05-FORM01",
  estado: "pendiente",
  fechaEnvio: "2026-11-05",
  fechaRespuesta: null,
  referencia: `OT-PRUEBA-${n}`,
  cliente: "Empresa PRUEBA",
  promedio: null,
  ...extra,
});

describe("Cartas de remisión de encuestas (FORM06 / FORM07 / FORM08)", () => {
  it("período por mes o por trimestre, con sus límites [desde, hasta)", () => {
    expect(per(periodoCarta(CARTAS.FORM06, { anio: "2026", mes: "11" }))).toMatchObject({ desde: "2026-11-01", hasta: "2026-12-01", texto: "noviembre de 2026", trimestre: null });
    expect(per(periodoCarta(CARTAS.FORM06, { anio: 2026, mes: 12 }))).toMatchObject({ desde: "2026-12-01", hasta: "2027-01-01" });
    expect(per(periodoCarta(CARTAS.FORM07, { anio: 2026, trimestre: 3 }))).toMatchObject({ desde: "2026-07-01", hasta: "2026-10-01", texto: "julio a septiembre de 2026 (tercer trimestre)" });
  });

  it("valida el período: la FORM08 es trimestral; mes o trimestre, no ambos", () => {
    expect(periodoCarta(CARTAS.FORM08, { anio: 2026, mes: 5 })).toEqual({ error: expect.stringMatching(/trimestral/) });
    expect(periodoCarta(CARTAS.FORM06, { anio: 2026, mes: 5, trimestre: 2 })).toEqual({ error: expect.stringMatching(/no los dos/) });
    expect(periodoCarta(CARTAS.FORM06, { anio: 2026 })).toEqual({ error: expect.stringMatching(/mes o el trimestre/) });
    expect(periodoCarta(CARTAS.FORM06, { anio: 2026, mes: 13 })).toEqual({ error: expect.stringMatching(/entre 1 y 12/) });
    expect(periodoCarta(CARTAS.FORM06, { anio: "x", mes: 1 })).toEqual({ error: expect.stringMatching(/año válido/) });
  });

  it("remitidas = encuestas abiertas en el período (cualquier estado vigente), por fecha de envío", () => {
    const p = per(periodoCarta(CARTAS.FORM06, { anio: 2026, mes: 11 }));
    const filas = [
      fila({ referencia: "B", fechaEnvio: "2026-11-20", estado: "registrada", fechaRespuesta: "2026-12-02" }),
      fila({ referencia: "A", fechaEnvio: "2026-11-01", estado: "sin_respuesta" }),
      fila({ referencia: "C", fechaEnvio: "2026-12-01" }), // fuera (límite superior excluido)
      fila({ referencia: "D", fechaEnvio: "2026-10-31" }), // fuera
      fila({ referencia: "E", fechaEnvio: "2026-11-10", estado: "anulada" }), // estado heredado: no cuenta
    ];
    expect(filasCarta(CARTAS.FORM06, filas, p).map((f) => [f.referencia, f.fecha])).toEqual([
      ["A", "2026-11-01"],
      ["B", "2026-11-20"],
    ]);
  });

  it("realizadas = registradas con respuesta en el período (por fecha de respuesta)", () => {
    const p = per(periodoCarta(CARTAS.FORM07, { anio: 2026, mes: 12 }));
    const filas = [
      fila({ referencia: "B", fechaEnvio: "2026-11-20", estado: "registrada", fechaRespuesta: "2026-12-02", promedio: 6.5 }),
      fila({ referencia: "P", fechaEnvio: "2026-12-03", estado: "pendiente" }),
      fila({ referencia: "S", fechaEnvio: "2026-12-03", estado: "sin_respuesta", fechaRespuesta: "2026-12-04" }),
    ];
    expect(filasCarta(CARTAS.FORM07, filas, p).map((f) => f.referencia)).toEqual(["B"]);
  });

  it("FORM08: solo los formularios Ejército del trimestre", () => {
    const p = per(periodoCarta(CARTAS.FORM08, { anio: 2026, trimestre: 4 }));
    const filas = [fila({ referencia: "E1", tipo: "FORM03" }), fila({ referencia: "P1", tipo: "FORM01" }), fila({ referencia: "E2", tipo: "EJ_PRUEBA" })];
    expect(filasCarta(CARTAS.FORM08, filas, p).map((f) => f.referencia)).toEqual(["E1"]);
    expect(filasCarta(CARTAS.FORM08, filas, p, ["FORM03", "EJ_PRUEBA"]).map((f) => f.referencia)).toEqual(["E1", "E2"]);
  });

  it("texto de cada carta según el formulario Rev00", () => {
    const m = per(periodoCarta(CARTAS.FORM06, { anio: 2026, mes: 11 }));
    expect(textoCarta(CARTAS.FORM06, m, "18-11-2026")).toBe(
      "Sección Planificación, Estudios y Control Comercial, se informa a UD detalle de encuestas remitidas con fecha 18-11-2026, correspondiente al período noviembre de 2026, para su conocimiento y seguimiento.",
    );
    expect(textoCarta(CARTAS.FORM07, m, "18-11-2026")).toMatch(/encuestas realizadas con fecha 18-11-2026, correspondientes al período noviembre de 2026, para su conocimiento\.$/);
    const t = per(periodoCarta(CARTAS.FORM08, { anio: 2026, trimestre: 3 }));
    expect(textoCarta(CARTAS.FORM08, t, "18-11-2026")).toMatch(/remitidas al cliente Ejército, correspondiente al tercer Trimestre del año 2026, para su conocimiento y seguimiento\.$/);
  });

  it("el PDF lleva código y revisión del formulario, la tabla y quien remite, con todo escapado", () => {
    const p = per(periodoCarta(CARTAS.FORM07, { anio: 2026, mes: 11 }));
    const c = armarCarta(
      CARTAS.FORM07,
      p,
      [fila({ referencia: "OT-<PRUEBA>", estado: "registrada", fechaRespuesta: "2026-11-09", promedio: 6.25, cliente: "Empresa <b>PRUEBA</b>" })],
      "2026-11-18",
      { nombre: "Usuario PRUEBA", cargo: "Cargo PRUEBA" },
    );
    expect(c.fecha).toBe("18-11-2026");
    expect(c.lineas).toHaveLength(1);
    const h = cuerpoCartaHtml(c);
    expect(h).toContain("DCO-PG01-P04-IT05-FORM07");
    expect(h).toContain("Revisión 00");
    expect(h).toContain("OT-&lt;PRUEBA&gt;");
    expect(h).toContain("Empresa &lt;b&gt;PRUEBA&lt;/b&gt;");
    expect(h).toContain("09-11-2026");
    expect(h).toContain("6,3");
    expect(h).toContain("Usuario PRUEBA · Cargo PRUEBA");
    const vacia = cuerpoCartaHtml(armarCarta(CARTAS.FORM06, p, [], "2026-11-18", { nombre: "U", cargo: null }));
    expect(vacia).toContain("Sin encuestas remitidas en el período.");
    expect(vacia).toContain("Fecha de envío");
  });
});
