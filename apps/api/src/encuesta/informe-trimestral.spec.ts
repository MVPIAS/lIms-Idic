import {
  calcularInforme,
  calcularSeccion,
  indice,
  promedioEncuesta,
  rangoTrimestre,
  sobreUmbral,
  textoNota,
  textoPct,
  textoTrimestre,
  trimestreAnterior,
  trimestreDe,
  trimestrePorDefecto,
  type FilaEncuesta,
  type TipoEncuesta,
} from "./informe-trimestral";
import { validarRespuestas } from "./encuesta.reglas";

const tipo = (codigo: string, extra: Partial<TipoEncuesta> = {}): TipoEncuesta => ({
  codigo,
  nombre: `PRUEBA ${codigo}`,
  formulario: `DCO-PG01-P04-IT05-${codigo}`,
  formularioRevision: "00",
  instruccion: "DCO-PG01-P04-IT05",
  anexoNumero: "01",
  anexoRevision: "00",
  anexoEmision: null,
  tituloInforme: `INFORME PRUEBA ${codigo}`,
  objetoInforme: `Encuestas PRUEBA ${codigo}`,
  agruparPor: "laboratorio",
  notaMaxima: 7,
  umbralPct: 85,
  distribucion: [],
  orden: 1,
  ...extra,
});

let n = 0;
const fila = (notasOResp: number[] | null, extra: Partial<FilaEncuesta> = {}): FilaEncuesta => ({
  id: `e${++n}`,
  tipo: "FORM01",
  estado: notasOResp ? "registrada" : "pendiente",
  fecha: "2026-08-10",
  grupo: "Laboratorio PRUEBA A",
  referencia: `OT-PRUEBA-${n}`,
  promedio: null,
  respuestas: notasOResp ? notasOResp.map((v, i) => ({ codigo: `P${i + 1}`, texto: `Pregunta PRUEBA ${i + 1}`, valor: v, escala: [1, 2, 3, 4, 5, 6, 7] })) : null,
  comentario: null,
  ...extra,
});

describe("Trimestres", () => {
  it("ubica una fecha en su trimestre y da su rango [desde, hasta)", () => {
    expect(trimestreDe("2026-09-30")).toEqual({ anio: 2026, trimestre: 3 });
    expect(trimestreDe("2026-10-01")).toEqual({ anio: 2026, trimestre: 4 });
    expect(rangoTrimestre(2026, 3)).toEqual({ desde: "2026-07-01", hasta: "2026-10-01" });
    expect(rangoTrimestre(2026, 4)).toEqual({ desde: "2026-10-01", hasta: "2027-01-01" });
    expect(() => rangoTrimestre(2026, 5)).toThrow(/1, 2, 3 o 4/);
  });

  it("el trimestre anterior del primero es el cuarto del año anterior; por defecto se informa el que acaba de cerrar", () => {
    expect(trimestreAnterior(2026, 1)).toEqual({ anio: 2025, trimestre: 4 });
    expect(trimestreAnterior(2026, 3)).toEqual({ anio: 2026, trimestre: 2 });
    expect(trimestrePorDefecto("2026-11-14")).toEqual({ anio: 2026, trimestre: 3 });
    expect(textoTrimestre(2026, 3)).toBe("tercer trimestre del año 2026");
  });
});

describe("Índice de satisfacción (planilla del Depto. Comercial: promedio / 7)", () => {
  it("índice = promedio / nota máxima × 100, sin redondear en el cálculo", () => {
    expect(indice(7, 7)).toBe(100);
    expect(indice(6.8, 7)).toBeCloseTo(97.142857, 5);
    expect(indice(null, 7)).toBeNull();
    expect(textoPct(indice(6.8, 7))).toBe("97 %");
    expect(textoNota(6.833333)).toBe("6,8");
    expect(textoNota(null)).toBe("—");
  });

  it("el promedio de la encuesta sale de sus notas; si no hay respuestas guardadas, del promedio registrado", () => {
    expect(promedioEncuesta({ respuestas: fila([6, 7, 7, 7, 7, 7]).respuestas, promedio: 1 })).toBeCloseTo(41 / 6, 10);
    expect(promedioEncuesta({ respuestas: null, promedio: 5.5 })).toBe(5.5);
    expect(promedioEncuesta({ respuestas: [], promedio: null })).toBeNull();
  });

  it("«sobre el 85 %» cuenta el 85 % exacto", () => {
    expect(sobreUmbral(85, 85)).toBe(true);
    expect(sobreUmbral(84.99, 85)).toBe(false);
    expect(sobreUmbral(null, 85)).toBe(false);
  });
});

describe("Anexo de un formulario (cuadros 1, 2 y 3)", () => {
  const t = tipo("FORM01");
  const filas = [
    fila([6, 7, 6, 7, 7, 7], { comentario: "Comentario PRUEBA uno" }),
    fila([7, 7, 7, 6, 7, 7]),
    fila([5, 5, 6, 6, 5, 6], { grupo: "Laboratorio PRUEBA B" }), // 5,5 / 7 = 78,6 % < 85 %
    fila(null), // pendiente
    fila(null, { estado: "sin_respuesta", grupo: "Laboratorio PRUEBA C" }),
  ];
  const s = calcularSeccion(t, filas);

  it("cuadro 1: contestadas, con índice sobre el umbral y su porcentaje", () => {
    expect(s.resumen.contestadas).toBe(3);
    expect(s.resumen.sobreUmbral).toBe(2);
    expect(s.resumen.porcentajeSobreUmbral).toBeCloseTo(66.6667, 3);
  });

  it("cuadro 2: promedio e índice por ítem, en el orden del formulario", () => {
    expect(s.items.map((i) => i.codigo)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(s.items[0].promedio).toBeCloseTo(6, 10);
    expect(s.items[0].indice).toBeCloseTo((6 / 7) * 100, 6);
    expect(s.items[0].respuestas).toBe(3);
  });

  it("cuadro 3: promedio por laboratorio = promedio de los promedios de sus encuestas", () => {
    const a = s.grupos.find((g) => g.grupo === "Laboratorio PRUEBA A")!;
    expect(a.contestadas).toBe(2);
    expect(a.promedio).toBeCloseTo((40 / 6 + 41 / 6) / 2, 10);
    expect(s.grupos.map((g) => g.grupo)).toEqual(["Laboratorio PRUEBA A", "Laboratorio PRUEBA B"]);
  });

  it("planilla de análisis: suma, promedio e índice de cada encuesta", () => {
    expect(s.detalle[0]).toMatchObject({ referencia: expect.stringMatching(/^OT-PRUEBA/), suma: 40, sobreUmbral: true });
    expect(s.detalle[2].indice).toBeCloseTo((33 / 6 / 7) * 100, 6);
    expect(s.detalle[2].sobreUmbral).toBe(false);
  });

  it("observaciones y control de aplicación (pendientes, sin respuesta, tasa, laboratorios sin contestar)", () => {
    expect(s.observaciones).toEqual([{ referencia: expect.any(String), grupo: "Laboratorio PRUEBA A", texto: "Comentario PRUEBA uno" }]);
    expect(s.aplicacion).toMatchObject({ total: 5, contestadas: 3, pendientes: 1, sinRespuesta: 1 });
    expect(s.aplicacion.tasaRespuesta).toBeCloseTo(75, 6);
    expect(s.aplicacion.gruposSinContestar).toEqual(["Laboratorio PRUEBA C"]);
  });

  it("sin encuestas contestadas el anexo sale en cero, como el del Ejército sin respuestas", () => {
    const v = calcularSeccion(tipo("FORM03"), []);
    expect(v.resumen).toEqual({ contestadas: 0, sobreUmbral: 0, porcentajeSobreUmbral: null, promedio: null, indice: null });
    expect(v.items).toEqual([]);
    expect(v.aplicacion.tasaRespuesta).toBeNull();
  });

  it("escala 1/3/5/7 del formulario Ejército: el índice sigue siendo promedio / 7", () => {
    const v = calcularSeccion(tipo("FORM03"), [fila([7, 5, 7, 5], { tipo: "FORM03" })]);
    expect(v.resumen.indice).toBeCloseTo((6 / 7) * 100, 6);
    expect(v.resumen.sobreUmbral).toBe(1);
  });
});

describe("Informe del trimestre", () => {
  const tipos = [tipo("FORM02", { orden: 2 }), tipo("FORM01", { orden: 1 }), tipo("FORM04", { orden: 4, agruparPor: "sucursal" })];
  const filas = [
    fila([7, 7, 7, 7, 7, 7]),
    fila([6, 6, 6, 6, 6, 6], { fecha: "2026-05-02" }), // trimestre anterior
    fila([7, 7, 7, 7, 7, 7], { fecha: "2026-10-05" }), // trimestre siguiente: no entra
    fila([7, 7, 7, 7, 7, 7], { tipo: "FORM04", grupo: null }),
    fila([7, 7, 7, 7, 7], { tipo: null }),
  ];

  it("un anexo por formulario, en su orden, solo con las encuestas del trimestre", () => {
    const inf = calcularInforme(tipos, filas, 2026, 3);
    expect(inf.etiqueta).toBe("3er TRIMESTRE 2026");
    expect(inf.secciones.map((s) => s.tipo.codigo)).toEqual(["FORM01", "FORM02", "FORM04"]);
    expect(inf.secciones[0].resumen.contestadas).toBe(1);
    expect(inf.secciones[0].anterior?.contestadas).toBe(1);
    expect(inf.secciones[0].anterior?.promedio).toBe(6);
    expect(inf.secciones[2].grupos[0].grupo).toBe("Sin sucursal");
    expect(inf.sinTipo).toBe(1);
  });

  it("con filtro de formulario sale solo ese anexo", () => {
    const inf = calcularInforme(tipos, filas, 2026, 3, "FORM04");
    expect(inf.secciones.map((s) => s.tipo.codigo)).toEqual(["FORM04"]);
  });
});

describe("Comentario obligatorio con nota baja (FORM01 criterio 4: menor que 4,0)", () => {
  const ps = [{ codigo: "F01_04", texto: "Tiempo de ejecución del trabajo", escala: [1, 2, 3, 4, 5, 6, 7], obligatoria: true, comentarioSiMenor: 4 }];
  it("con nota 3 y sin comentario no se registra; con comentario, sí", () => {
    expect(validarRespuestas(ps, [{ codigo: "F01_04", valor: 3 }], "").errores.join(" ")).toMatch(/menor que 4/);
    expect(validarRespuestas(ps, [{ codigo: "F01_04", valor: 3 }], "Motivo PRUEBA").errores).toEqual([]);
    expect(validarRespuestas(ps, [{ codigo: "F01_04", valor: 4 }], "").errores).toEqual([]);
  });
});
