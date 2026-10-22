import {
  porcentajesTasaCambiados,
  avanceInternacion,
  calcularTasa,
  condicionFinal,
  errorCambioEstadoCodificacion,
  errorFormatoCnc,
  erroresAnalisis,
  erroresInscripcion,
  erroresItems,
  erroresLoteParaMuestra,
  erroresReinspeccion,
  erroresTasa,
  faltantesDocumentoFinal,
  faltantesRemision,
  normalizarCnc,
  transicionDocAdm,
} from "./reglas-bpch";

describe("Codificación Única · CNC-DGMN", () => {
  it("normaliza espacios y separadores de miles como en los documentos reales", () => {
    expect(normalizarCnc("E-I / 21 / 1433 / 7,357 / 30537 / 24369")).toBe("E-I/21/1433/7357/30537/24369");
    expect(normalizarCnc("e-i/7/176/673/30365/3202")).toBe("E-I/7/176/673/30365/3202");
    expect(normalizarCnc("Q-I/44/902/2210/—/1942")).toBe("Q-I/44/902/2210/-/1942");
  });
  it("acepta el formato E-I/n/n/n/n/n y rechaza lo demás", () => {
    expect(errorFormatoCnc("E-I/7/176/673/30365/3202")).toBeNull();
    expect(errorFormatoCnc("E-I / 21 / 1433 / 7,357 / 30537 / 24369")).toBeNull();
    expect(errorFormatoCnc("Q-I/44/902/2210/—/1942")).toBeNull();
    expect(errorFormatoCnc("")).toMatch(/Indique/);
    expect(errorFormatoCnc("E-I/7/176")).toMatch(/formato/);
    expect(errorFormatoCnc("DE00027864")).toMatch(/formato/);
  });
  it("exige listado, fabricante, producto y, para explosivos, la clase y el Nº UN", () => {
    expect(erroresInscripcion({ listado: "EXPLOSIVOS", cnc: "E-I/7/176/673/30365/3202", fabricanteNombre: "F", producto: "P", claseDivisionUn: "1.4S", numeroUn: "0513" })).toEqual([]);
    const e = erroresInscripcion({ listado: "EXPLOSIVOS", cnc: "E-I/7/176/673/30365/3202", fabricanteNombre: "F", producto: "P" });
    expect(e.join(" ")).toMatch(/Clase\/División UN/);
    expect(e.join(" ")).toMatch(/Nº UN/);
    expect(erroresInscripcion({ listado: "SUSTANCIAS_QUIMICAS", cnc: "Q-I/44/902/2210/-/1942", fabricanteNombre: "F", producto: "P" })).toEqual([]);
    expect(erroresInscripcion({ listado: "OTRO", cnc: "x" }).length).toBeGreaterThanOrEqual(3);
  });
  it("solo cambia entre Vigente y En receso, con motivo", () => {
    expect(errorCambioEstadoCodificacion("VIGENTE", "EN_RECESO", "Baja temporal del fabricante")).toBeNull();
    expect(errorCambioEstadoCodificacion("VIGENTE", "VIGENTE", "xxxxx")).toMatch(/ya está vigente/);
    expect(errorCambioEstadoCodificacion("EN_RECESO", "VIGENTE", "")).toMatch(/motivo/);
    expect(errorCambioEstadoCodificacion("VIGENTE", "BAJA", "xxxxxx")).toMatch(/inválido/);
  });
});

describe("Internación · elementos y lotes", () => {
  const ok = { elementoEspecifico: "Detonador", claseDivisionUn: "1.4S", numeroUn: "0513" };
  it("exige al menos un elemento con UN y producto", () => {
    expect(erroresItems([])).toEqual(["Indique al menos un elemento a internar."]);
    expect(erroresItems([ok])).toEqual([]);
    expect(erroresItems([{ elementoEspecifico: "X" }]).length).toBe(2);
  });
  it("internación de armas (EP-11 11.1): con listado de armas los elementos son opcionales y sin Nº UN", () => {
    expect(erroresItems([], { conArmas: true })).toEqual([]);
    expect(erroresItems([{ elementoEspecifico: "Cargadores" }], { conArmas: true })).toEqual([]);
    expect(erroresItems([{ elementoEspecifico: "" }], { conArmas: true })[0]).toMatch(/elemento específico/);
  });
  it("tamaño de muestra ≤ tamaño de lote (NCh 44)", () => {
    expect(erroresItems([{ ...ok, tamanoLote: 1482, tamanoMuestra: 36 }])).toEqual([]);
    expect(erroresItems([{ ...ok, tamanoLote: 8, tamanoMuestra: 9 }]).join(" ")).toMatch(/no puede superar/);
    expect(erroresItems([{ ...ok, tamanoLote: 0 }]).join(" ")).toMatch(/mayor que cero/);
  });
  it("para registrar el lote como muestra pide identificación y tamaños", () => {
    expect(erroresLoteParaMuestra({ identificacionLote: "L1", tamanoLote: 10, tamanoMuestra: 2 })).toEqual([]);
    expect(erroresLoteParaMuestra({}).length).toBe(3);
  });
  it("valida el CNC del elemento si se indica", () => {
    expect(erroresItems([{ ...ok, cnc: "malo" }]).join(" ")).toMatch(/formato/);
  });
});

describe("Internación · análisis técnico", () => {
  it("información incompleta exige la solicitud a DGMN", () => {
    expect(erroresAnalisis({ estado: "registrada", infoCompleta: false, solicitudesPendientes: 0 }).length).toBe(2);
    expect(
      erroresAnalisis({ estado: "registrada", infoCompleta: false, solicitudesPendientes: 0, solicitud: { destinatario: "DGMN", detalle: "Falta ficha técnica" } }),
    ).toEqual([]);
  });
  it("no se da por completa con solicitudes sin respuesta", () => {
    expect(erroresAnalisis({ estado: "antecedentes_pendientes", infoCompleta: true, solicitudesPendientes: 1 }).join(" ")).toMatch(/sin respuesta/);
    expect(erroresAnalisis({ estado: "antecedentes_pendientes", infoCompleta: true, solicitudesPendientes: 0 })).toEqual([]);
  });
  it("no se repite una vez generada la OT", () => {
    expect(erroresAnalisis({ estado: "ot_generada", infoCompleta: true, solicitudesPendientes: 0 }).join(" ")).toMatch(/OT está generada/);
  });
});

describe("Internación · documentación administrativa", () => {
  it("sigue el circuito solicitar → recibir → conforme / no conforme → solicitar", () => {
    expect(transicionDocAdm("pendiente", "solicitar")).toEqual({ estado: "solicitada" });
    expect(transicionDocAdm("solicitada", "recibir")).toEqual({ estado: "recibida" });
    expect(transicionDocAdm("recibida", "no_conforme")).toEqual({ estado: "no_conforme" });
    expect(transicionDocAdm("no_conforme", "solicitar")).toEqual({ estado: "solicitada" });
    expect(transicionDocAdm("recibida", "conforme")).toEqual({ estado: "conforme" });
  });
  it("rechaza saltos y la documentación de una internación sin tasa", () => {
    expect(transicionDocAdm("pendiente", "conforme").error).toMatch(/No se puede/);
    expect(transicionDocAdm("no_aplica", "solicitar").error).toMatch(/no está sujeta/);
    expect(transicionDocAdm("conforme", "recibir").error).toMatch(/ya está conforme/);
  });
});

describe("Tasa de internación", () => {
  it("CIF × paridad × % afecto × % tasa, IVA sobre la tasa", () => {
    const r = calcularTasa({ cifUsd: 184500, paridad: 945.2, pctAfecto: 100, tasaPct: 1.5, ivaPct: 19 });
    expect(r.cifClp).toBe(174389400);
    expect(r.tasa).toBe(2615841);
    expect(r.iva).toBe(Math.round(2615841 * 0.19));
    expect(r.total).toBe(r.tasa + r.iva);
    const afecto = calcularTasa({ cifUsd: 184500, paridad: 945.2, pctAfecto: 99.9, tasaPct: 1.5, ivaPct: 0 });
    expect(afecto.tasa).toBe(Math.round(174389400 * 0.999 * 0.015));
    expect(afecto.iva).toBe(0);
  });
  it("valida los datos de entrada", () => {
    expect(erroresTasa({ cifUsd: 1, paridad: 1, pctAfecto: 100, tasaPct: 1.5, ivaPct: 19 })).toEqual([]);
    expect(erroresTasa({ cifUsd: 0, paridad: -1, pctAfecto: 120, tasaPct: 0, ivaPct: -1 }).length).toBe(5);
  });
});

describe("Veredicto y documento final", () => {
  it("condición final de la OT según sus lotes", () => {
    expect(condicionFinal([])).toBe("pendiente");
    expect(condicionFinal(["cumple", "cumple"])).toBe("cumple");
    expect(condicionFinal(["cumple", "no_cumple"])).toBe("no_cumple");
    expect(condicionFinal(["cumple", "pendiente"])).toBe("pendiente");
    expect(condicionFinal(["cumple", "informativo"])).toBe("cumple");
  });
  it("certificado solo si cumple; incumplimiento solo si no cumple; ambos tras el informe de inspección oficial", () => {
    expect(faltantesDocumentoFinal({ tipoDocumento: "CERTIFICADO_CONFORMIDAD", condicion: "cumple", informeInspeccionOficial: true })).toEqual([]);
    expect(faltantesDocumentoFinal({ tipoDocumento: "CERTIFICADO_CONFORMIDAD", condicion: "no_cumple", informeInspeccionOficial: true })[0]).toMatch(/Informe de Incumplimiento/);
    expect(faltantesDocumentoFinal({ tipoDocumento: "INFORME_INCUMPLIMIENTO", condicion: "no_cumple", informeInspeccionOficial: true })).toEqual([]);
    expect(faltantesDocumentoFinal({ tipoDocumento: "INFORME_INCUMPLIMIENTO", condicion: "cumple", informeInspeccionOficial: true })[0]).toMatch(/Certificado de Conformidad/);
    expect(faltantesDocumentoFinal({ tipoDocumento: "CERTIFICADO_CONFORMIDAD", condicion: "cumple", informeInspeccionOficial: false })[0]).toMatch(/Informe de Inspección/);
    // Prototipo (IT10): el dictamen no exige Informe de Inspección previo, pero sí la condición.
    expect(faltantesDocumentoFinal({ tipoDocumento: "CERTIFICADO_CONFORMIDAD", condicion: "cumple", informeInspeccionOficial: false, exigeInformePrevio: false })).toEqual([]);
    expect(faltantesDocumentoFinal({ tipoDocumento: "CERTIFICADO_CONFORMIDAD", condicion: "no_cumple", informeInspeccionOficial: false, exigeInformePrevio: false })[0]).toMatch(/Informe de Incumplimiento/);
    expect(faltantesDocumentoFinal({ tipoDocumento: "INFORME_ENSAYO", condicion: "pendiente", informeInspeccionOficial: false })).toEqual([]);
  });
  it("la tasa se remite con documentación conforme, tasa calculada y documento final oficial", () => {
    const base = { sujetaTasa: true, docAdmEstado: "conforme", tasaCalculada: true, documentoFinalOficial: true, yaRemitida: false };
    expect(faltantesRemision(base)).toEqual([]);
    expect(faltantesRemision({ ...base, sujetaTasa: false })[0]).toMatch(/no está sujeta/);
    expect(faltantesRemision({ ...base, docAdmEstado: "recibida", tasaCalculada: false, documentoFinalOficial: false, yaRemitida: true }).length).toBe(4);
  });
});

describe("Reinspección · solicitud", () => {
  const base = {
    motivo: "TRASPASO",
    motivosValidos: ["TRASPASO", "VENCIMIENTO", "RECHAZO", "OTRO"],
    solicitadoPor: "Jefe Sucursal",
    fechaSolicitud: "2026-10-10",
    codificacionId: "x",
    elementoEspecifico: "Tortas",
  };
  it("acepta una solicitud completa ligada a un antecedente", () => {
    expect(erroresReinspeccion(base)).toEqual([]);
  });
  it("exige antecedente original y detalle si el motivo es Otro", () => {
    expect(erroresReinspeccion({ ...base, codificacionId: null }).join(" ")).toMatch(/OT original/);
    expect(erroresReinspeccion({ ...base, motivo: "OTRO" }).join(" ")).toMatch(/describa/);
    expect(erroresReinspeccion({ ...base, motivo: "X" }).join(" ")).toMatch(/motivo/);
  });
  it("un código que no está en la Codificación Única no es reinspección (corresponde Prototipo)", () => {
    expect(erroresReinspeccion({ ...base, cnc: "E-I/1/2/3/4/5", cncEnCodificacion: false }).join(" ")).toMatch(/Prototipo/);
  });
});

describe("Internación · estado que se muestra = avance real (revisión r3, hallazgo 21)", () => {
  const ot = { estado: "ot_generada", otEstado: "recepcionada", lotes: 1, lotesRegistrados: 0, sujetaTasa: true };
  it("antes de la OT, el estado del expediente", () => {
    expect(avanceInternacion({ estado: "registrada" })).toBe("registrada");
    expect(avanceInternacion({ estado: "antecedentes_pendientes" })).toBe("antecedentes_pendientes");
    expect(avanceInternacion({ estado: "anulada" })).toBe("anulada");
  });
  it("después avanza con los lotes, los documentos, la tasa y el cierre de la OT", () => {
    expect(avanceInternacion(ot)).toBe("ot_generada");
    expect(avanceInternacion({ ...ot, lotesRegistrados: 1 })).toBe("en_inspeccion");
    expect(avanceInternacion({ ...ot, lotesRegistrados: 1, informeOficial: true })).toBe("informe_emitido");
    expect(avanceInternacion({ ...ot, informeOficial: true, certificadoOficial: true })).toBe("certificado_emitido");
    expect(avanceInternacion({ ...ot, informeOficial: true, incumplimientoOficial: true, sujetaTasa: false })).toBe("incumplimiento_emitido");
    expect(avanceInternacion({ ...ot, certificadoOficial: true, tasaRemitida: true })).toBe("tasa_remitida");
    // OT cerrada y tasa remitida: ya no figura como «OT generada».
    expect(avanceInternacion({ ...ot, otEstado: "cerrada", certificadoOficial: true, tasaRemitida: true })).toBe("ot_cerrada");
    expect(avanceInternacion({ ...ot, otEstado: "anulada" })).toBe("ot_anulada");
  });
});

describe("Tasa · porcentajes del parámetro (revisión de seguridad r3)", () => {
  const prm = { tasaPct: 1.5, ivaPct: 19 };
  it("sin porcentajes, o con los del parámetro, no cambia nada", () => {
    expect(porcentajesTasaCambiados({}, prm)).toEqual([]);
    expect(porcentajesTasaCambiados({ tasaPct: 1.5, ivaPct: 19 }, prm)).toEqual([]);
  });
  it("otros porcentajes se informan (exigen el permiso de configuración)", () => {
    expect(porcentajesTasaCambiados({ tasaPct: 2 }, prm)[0]).toMatch(/tasa 2 %/);
    expect(porcentajesTasaCambiados({ ivaPct: 0 }, prm)[0]).toMatch(/IVA 0 %/);
  });
});
