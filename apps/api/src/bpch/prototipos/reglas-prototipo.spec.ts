import { puedeOperarEnUnidad } from "../alcance-bpch";
import { etapaPrototipo, faltantesDictamen, faltantesGenerarOt, resultadoDictamen, validarCodigoCnc, veredictoOt } from "./reglas-prototipo";

describe("Prototipos · veredicto del tipo", () => {
  it("no cumple si algún ensayo no cumple; pendiente si falta veredicto; cumple con informativos", () => {
    expect(veredictoOt([])).toBe("sin_resultados");
    expect(veredictoOt([{ veredicto: "cumple", estado: "aprobado" }, { veredicto: "no_cumple", estado: "aprobado" }])).toBe("no_cumple");
    expect(veredictoOt([{ veredicto: "cumple", estado: "aprobado" }, { veredicto: null, estado: "pendiente" }])).toBe("pendiente");
    expect(veredictoOt([{ veredicto: "cumple", estado: "aprobado" }, { veredicto: "informativo", estado: "aprobado" }])).toBe("cumple");
  });
});

describe("Prototipos · generar la OT", () => {
  const base = { estado: "ingresado" as const, otId: null, sacTamanoMuestra: 5, unidadId: "u", conCobro: false };
  it("exige el pronunciamiento SAC (SAC-PG01-IT10), la unidad y la decisión de cobro", () => {
    expect(faltantesGenerarOt(base)).toEqual([]);
    expect(faltantesGenerarOt({ ...base, sacTamanoMuestra: null }).join(" ")).toMatch(/SAC/);
    expect(faltantesGenerarOt({ ...base, unidadId: null }).join(" ")).toMatch(/sucursal/);
    expect(faltantesGenerarOt({ ...base, conCobro: undefined }).join(" ")).toMatch(/cobro/);
  });
  it("no genera una segunda OT vigente; sí si la anterior se anuló", () => {
    expect(faltantesGenerarOt({ ...base, otId: "o", otEstado: "recepcionada" }).join(" ")).toMatch(/ya tiene una OT/);
    expect(faltantesGenerarOt({ ...base, otId: "o", otEstado: "anulada" })).toEqual([]);
    expect(faltantesGenerarOt({ ...base, estado: "anulado" }).join(" ")).toMatch(/anulado/);
  });
});

describe("Prototipos · dictamen", () => {
  const listo = {
    estado: "en_evaluacion" as const,
    otId: "o",
    totalResultados: 3,
    aprobados: 3,
    veredicto: "cumple" as const,
    clasificacionEstado: "aprobada",
    documentoVigente: false,
  };
  it("aprobar exige resultados aprobados, que todos cumplan y clasificación aprobada", () => {
    expect(faltantesDictamen({ ...listo, dictamen: "aprobado" })).toEqual([]);
    expect(faltantesDictamen({ ...listo, dictamen: "aprobado", aprobados: 2 }).join(" ")).toMatch(/2 de 3/);
    expect(faltantesDictamen({ ...listo, dictamen: "aprobado", veredicto: "no_cumple" }).join(" ")).toMatch(/no cumplen/);
    expect(faltantesDictamen({ ...listo, dictamen: "aprobado", clasificacionEstado: null }).join(" ")).toMatch(/clasificación/);
    expect(faltantesDictamen({ ...listo, dictamen: "aprobado", otId: null }).join(" ")).toMatch(/no tiene OT/);
  });
  it("rechazar exige motivo y resultados aprobados, aunque no cumplan", () => {
    expect(faltantesDictamen({ ...listo, dictamen: "rechazado", veredicto: "no_cumple" }).join(" ")).toMatch(/motivo/);
    expect(faltantesDictamen({ ...listo, dictamen: "rechazado", veredicto: "no_cumple", motivo: "Detonó en insensibilidad" })).toEqual([]);
  });
  it("un dictamen con documento vigente no se repite; con el documento anulado, sí", () => {
    expect(faltantesDictamen({ ...listo, estado: "dictaminado", documentoVigente: true, dictamen: "aprobado" }).join(" ")).toMatch(/anule ese documento/);
    expect(faltantesDictamen({ ...listo, estado: "dictaminado", documentoVigente: false, dictamen: "aprobado" })).toEqual([]);
    expect(faltantesDictamen({ ...listo, dictamen: "otro" })).toEqual(["Indique el dictamen: aprobado o rechazado."]);
  });
});

describe("Prototipos · código único y etapa", () => {
  it("el código CNC-DGMN tiene seis partes", () => {
    expect(validarCodigoCnc("E-I/21/1433/7357/30537/24369")).toBeNull();
    expect(validarCodigoCnc("E-I/21/1433")).toMatch(/seis partes/);
    expect(validarCodigoCnc("")).toMatch(/Indique/);
    expect(validarCodigoCnc("E-I//1/2/3/4")).toMatch(/seis partes/);
  });
  it("etapa legible", () => {
    expect(etapaPrototipo({ estado: "ingresado" })).toMatch(/falta pronunciamiento/);
    expect(etapaPrototipo({ estado: "ingresado", sacTamanoMuestra: 3 })).toMatch(/listo/);
    expect(etapaPrototipo({ estado: "en_evaluacion", otId: "o" })).toMatch(/En evaluación/);
    expect(etapaPrototipo({ estado: "dictaminado", dictamen: "aprobado", documentoEstado: "en_firma" })).toBe("Aprobado · documento en firma");
    expect(etapaPrototipo({ estado: "dictaminado", dictamen: "rechazado", documentoEstado: "oficial" })).toBe("Rechazado · documento oficial");
  });
});

describe("BPCH · alcance para programar y generar OT", () => {
  it("global, la propia unidad o la SCC (que genera las OT de las sucursales)", () => {
    expect(puedeOperarEnUnidad(null, "suc", "scc")).toBe(true);
    expect(puedeOperarEnUnidad(["suc"], "suc", "scc")).toBe(true);
    expect(puedeOperarEnUnidad(["scc"], "suc", "scc")).toBe(true);
    expect(puedeOperarEnUnidad(["otra"], "suc", "scc")).toBe(false);
    expect(puedeOperarEnUnidad(["otra"], "suc", null)).toBe(false);
  });
});

describe("Prototipos · tabla de ensayos del dictamen (hallazgo 2 de la revisión r3)", () => {
  it("imprime el resultado final (con fórmula o factor), no el promedio crudo", () => {
    // Factor ÷2 con réplicas [10, 10]: promedio 10, resultado 5 (el veredicto se calculó con 5).
    expect(resultadoDictamen({ promedio: "10", valor_numerico: "5", resultado_final: "5" })).toBe("5");
    // Fórmula PROMEDIO(RN)*100 sobre [2, 2]: promedio 2, resultado 200.
    expect(resultadoDictamen({ promedio: 2, resultado_final: 200, valor_numerico: 200 })).toBe("200");
  });
  it("sin resultado final usa el valor capturado; sin ninguno, el promedio; sin número, el texto", () => {
    expect(resultadoDictamen({ valor_numerico: "7.25", promedio: "7" })).toBe("7,25");
    expect(resultadoDictamen({ promedio: "3.5" })).toBe("3,5");
    expect(resultadoDictamen({ valor_texto: "Sin defectos" })).toBe("Sin defectos");
  });
});
