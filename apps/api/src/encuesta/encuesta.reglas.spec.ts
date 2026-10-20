import { erroresPregunta, motivoNoRegistrable, promedioDe, reportePorLaboratorio, validarRespuestas, type Pregunta } from "./encuesta.reglas";

const preguntas: Pregunta[] = [
  { codigo: "C01", texto: "Satisfacción por el servicio prestado", escala: [1, 3, 5, 7], obligatoria: true },
  { codigo: "C02", texto: "Cumplió expectativas", escala: [1, 3, 5, 7], obligatoria: true },
  { codigo: "C05", texto: "Opcional", escala: [1, 3, 5, 7], obligatoria: false },
];

describe("Encuesta de satisfacción (EP-00 9.1, registro manual por Comercial)", () => {
  it("guarda la copia de cada pregunta con su respuesta y el promedio de las respondidas", () => {
    const r = validarRespuestas(preguntas, [{ codigo: "C01", valor: 7 }, { codigo: "C02", valor: 5 }]);
    expect(r.errores).toEqual([]);
    expect(r.promedio).toBe(6);
    expect(r.guardadas).toEqual([
      { codigo: "C01", texto: "Satisfacción por el servicio prestado", valor: 7, escala: [1, 3, 5, 7] },
      { codigo: "C02", texto: "Cumplió expectativas", valor: 5, escala: [1, 3, 5, 7] },
      { codigo: "C05", texto: "Opcional", valor: null, escala: [1, 3, 5, 7] },
    ]);
  });

  it("rechaza respuestas fuera de la escala, preguntas inexistentes y obligatorias en blanco", () => {
    const r = validarRespuestas(preguntas, [{ codigo: "C01", valor: 4 }, { codigo: "X9", valor: 7 }]);
    expect(r.errores.join(" ")).toMatch(/una de 1, 3, 5, 7/);
    expect(r.errores.join(" ")).toMatch(/X9 no existe/);
    expect(r.errores.join(" ")).toMatch(/Falta la respuesta de «Cumplió expectativas»/);
  });

  it("solo se registra o cierra una encuesta pendiente", () => {
    expect(motivoNoRegistrable("pendiente")).toBeNull();
    expect(motivoNoRegistrable("registrada")).toMatch(/ya está registrada/);
    expect(motivoNoRegistrable("sin_respuesta")).toMatch(/cerrada sin respuesta/);
  });

  it("valida la configuración de las preguntas", () => {
    expect(erroresPregunta({ codigo: "C01", texto: "Ok", escala: [1, 3, 5, 7] })).toEqual([]);
    expect(erroresPregunta({ codigo: "c 1", texto: " ", escala: [5, 5] })).toHaveLength(3);
  });

  it("reporte por laboratorio: estados, tasa de respuesta y promedios por pregunta", () => {
    const resp = (a: number, b: number) => [
      { codigo: "C01", texto: "S", valor: a, escala: [1, 3, 5, 7] },
      { codigo: "C02", texto: "E", valor: b, escala: [1, 3, 5, 7] },
    ];
    const r = reportePorLaboratorio([
      { unidad: "LQC", estado: "registrada", promedio: 6, respuestas: resp(7, 5) },
      { unidad: "LQC", estado: "registrada", promedio: 4, respuestas: resp(5, 3) },
      { unidad: "LQC", estado: "pendiente", promedio: null, respuestas: null },
      { unidad: "LPN", estado: "sin_respuesta", promedio: null, respuestas: null },
    ]);
    const lqc = r.laboratorios.find((l) => l.unidad === "LQC")!;
    expect(lqc).toMatchObject({ total: 3, pendientes: 1, registradas: 2, sinRespuesta: 0, promedio: 5, tasaRespuesta: 66.7 });
    expect(lqc.porPregunta).toEqual([
      { codigo: "C01", texto: "S", promedio: 6 },
      { codigo: "C02", texto: "E", promedio: 4 },
    ]);
    expect(r.total).toMatchObject({ total: 4, registradas: 2, sinRespuesta: 1 });
    expect(promedioDe([])).toBeNull();
  });
});
