import {
  caminoEstadosOt,
  diaDe,
  faltantesParaCerrar,
  fechaCompromisoDesdePlazo,
  hoyCl,
  semaforoPlazo,
  sumarDias,
  validarFechaCompromiso,
} from "./plazos";

// 14-10-2026 a mediodía en Chile (UTC-3).
const AHORA = new Date("2026-10-14T15:00:00Z");

describe("plazos · semáforo de la fecha de compromiso", () => {
  it("usa el día de Chile, no el del servidor", () => {
    expect(hoyCl(AHORA)).toBe("2026-10-14");
    // 01:30 UTC del 15 = 22:30 del 14 en Chile
    expect(hoyCl(new Date("2026-10-15T01:30:00Z"))).toBe("2026-10-14");
  });

  it("vencida, por vencer (hoy a +3 días), en plazo y sin fecha", () => {
    expect(semaforoPlazo(new Date("2026-10-13T00:00:00Z"), "en_analisis", AHORA)).toEqual({ semaforo: "vencida", diasRestantes: -1 });
    expect(semaforoPlazo("2026-10-14", "en_analisis", AHORA)).toEqual({ semaforo: "por_vencer", diasRestantes: 0 });
    expect(semaforoPlazo("2026-10-17", "recepcionada", AHORA)).toEqual({ semaforo: "por_vencer", diasRestantes: 3 });
    expect(semaforoPlazo("2026-10-18", "recepcionada", AHORA)).toEqual({ semaforo: "en_plazo", diasRestantes: 4 });
    expect(semaforoPlazo(null, "recepcionada", AHORA).semaforo).toBe("sin_fecha");
  });

  it("una OT cerrada o anulada no tiene semáforo", () => {
    expect(semaforoPlazo("2026-01-01", "cerrada", AHORA).semaforo).toBe("terminada");
    expect(semaforoPlazo("2026-01-01", "anulada", AHORA).semaforo).toBe("terminada");
    // finalizada/informada siguen contando: el compromiso es la entrega al cliente
    expect(semaforoPlazo("2026-01-01", "finalizada", AHORA).semaforo).toBe("vencida");
  });

  it("calcula la fecha desde el plazo de la cotización", () => {
    expect(fechaCompromisoDesdePlazo(new Date("2026-10-01T14:00:00Z"), 10)).toBe("2026-10-11");
    expect(fechaCompromisoDesdePlazo("2026-10-01", 30)).toBe("2026-10-31");
    expect(fechaCompromisoDesdePlazo("2026-10-01", null)).toBeNull();
    expect(fechaCompromisoDesdePlazo("2026-10-01", 0)).toBeNull();
    expect(sumarDias("2026-12-30", 3)).toBe("2027-01-02");
    expect(diaDe(new Date("2026-10-20T00:00:00Z"))).toBe("2026-10-20");
  });

  it("valida la fecha fijada a mano", () => {
    expect(validarFechaCompromiso("2026-10-20", "2026-10-01")).toBeNull();
    expect(validarFechaCompromiso("2026-09-20", "2026-10-01")).toContain("anterior a la recepción");
    expect(validarFechaCompromiso("20-10-2026", null)).toContain("inválida");
  });
});

describe("plazos · condiciones de cierre", () => {
  const ok = { numero: "CERT-2026-0001", estado: "oficial", entregadoAt: "2026-10-10" };

  it("se puede cerrar con todos los documentos oficiales y entregados", () => {
    expect(faltantesParaCerrar({ estado: "finalizada", documentos: [ok], resultadosNoAprobados: 0 })).toEqual([]);
    // un documento anulado no cuenta; el emitido antes del circuito vale como oficial
    expect(
      faltantesParaCerrar({
        estado: "en_analisis",
        documentos: [{ numero: "A", estado: "anulado", entregadoAt: null }, { numero: "B", estado: "emitido", entregadoAt: "2026-10-01" }],
        resultadosNoAprobados: 0,
      }),
    ).toEqual([]);
  });

  it("explica qué falta", () => {
    const f = faltantesParaCerrar({
      estado: "validacion",
      documentos: [
        { numero: "C1", estado: "en_firma", entregadoAt: null, pendienteDe: "Jefe de Laboratorio" },
        { numero: "C2", estado: "oficial", entregadoAt: null },
        { numero: "C3", estado: "devuelto", entregadoAt: null },
      ],
      resultadosNoAprobados: 2,
    });
    expect(f).toEqual([
      "Hay 2 resultado(s) sin aprobar.",
      "El documento C1 está en firma (pendiente de Jefe de Laboratorio).",
      "El documento C2 es oficial pero falta registrar su entrega al cliente.",
      "El documento C3 fue devuelto sin firmar: reemítalo o anúlelo.",
    ]);
  });

  it("sin documentos, o ya cerrada / anulada, no se cierra", () => {
    expect(faltantesParaCerrar({ estado: "finalizada", documentos: [], resultadosNoAprobados: 0 })[0]).toContain("no tiene informes");
    expect(faltantesParaCerrar({ estado: "cerrada", documentos: [ok], resultadosNoAprobados: 0 })).toEqual(["La OT ya está cerrada."]);
    expect(faltantesParaCerrar({ estado: "anulada", documentos: [ok], resultadosNoAprobados: 0 })).toEqual(["La OT está anulada."]);
  });
});

describe("plazos · camino de la máquina de estados hasta «cerrada»", () => {
  it("recorre solo transiciones permitidas", () => {
    expect(caminoEstadosOt("recepcionada")).toEqual(["en_analisis", "validacion", "finalizada", "cerrada"]);
    expect(caminoEstadosOt("recibida")).toEqual(["en_analisis", "validacion", "finalizada", "cerrada"]);
    expect(caminoEstadosOt("validacion")).toEqual(["finalizada", "cerrada"]);
    expect(caminoEstadosOt("finalizada")).toEqual(["cerrada"]);
    expect(caminoEstadosOt("informada")).toEqual(["cerrada"]);
    expect(caminoEstadosOt("cerrada")).toEqual([]);
  });

  it("sin camino desde un estado final o desconocido", () => {
    expect(caminoEstadosOt("anulada")).toBeNull();
    expect(caminoEstadosOt("estado_raro")).toBeNull();
  });
});
