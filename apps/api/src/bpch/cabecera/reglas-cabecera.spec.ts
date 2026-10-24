import { diferencias, erroresCabecera, heredarCabecera, faltantesParaEmitirInspeccion, iniciales } from "./reglas-cabecera";

describe("BPCH · cabecera de inspección de la OT (EP-10 10.3)", () => {
  const ok = { procedimiento: "SAC-PG01-P01", lugarInspeccion: "Polvorín de prueba", fechaInspeccion: "2026-10-20" };

  it("guardar exige el procedimiento de control", () => {
    expect(erroresCabecera(ok)).toEqual([]);
    expect(erroresCabecera({ lugarInspeccion: "X" }).join(" ")).toMatch(/procedimiento de control/);
  });

  it("valida el CNC-DGMN, los tamaños NCh 44 y las fechas", () => {
    expect(erroresCabecera({ ...ok, cncDgmn: "E-I/7/176/673/30365/3202" })).toEqual([]);
    expect(erroresCabecera({ ...ok, cncDgmn: "123" }).join(" ")).toMatch(/CNC-DGMN/);
    expect(erroresCabecera({ ...ok, tamanoLote: 10, tamanoMuestra: 20 }).join(" ")).toMatch(/no puede superar/);
    expect(erroresCabecera({ ...ok, fechaInspeccion: "20-10-2026" }).join(" ")).toMatch(/fecha no válida/);
    expect(erroresCabecera({ ...ok, vigenciaInforme: "2026-10-01" }).join(" ")).toMatch(/vigencia del informe no puede ser anterior/);
  });

  it("la fecha de inspección futura se admite (se programa; por confirmar con el IDIC)", () => {
    expect(erroresCabecera({ ...ok, fechaInspeccion: "2099-01-01" })).toEqual([]);
  });

  it("en internación o reinspección solo se agregan dirección, comuna y contacto", () => {
    expect(erroresCabecera({ direccion: "Ruta 5 km 10", contacto: "R. R." }, { soloComplemento: true })).toEqual([]);
    expect(erroresCabecera({ direccion: "x", lugarInspeccion: "otro" }, { soloComplemento: true }).join(" ")).toMatch(/se registra en su expediente/);
  });

  it("antes de emitir el Informe de Inspección: lugar y fecha (EP-10 10.11)", () => {
    expect(faltantesParaEmitirInspeccion({ lugar_inspeccion: "Polvorín", fecha_inspeccion: "20-10-2026" })).toEqual([]);
    expect(faltantesParaEmitirInspeccion(null).join(" ")).toMatch(/Registre la cabecera de inspección/);
    expect(faltantesParaEmitirInspeccion({ lugar_inspeccion: "", fecha_inspeccion: null })).toEqual([
      "La cabecera de inspección no tiene el lugar de inspección.",
      "La cabecera de inspección no tiene la fecha de inspección.",
    ]);
  });

  it("historial: solo lo que cambió; inspectores por iniciales", () => {
    expect(diferencias({ lugarInspeccion: "A", comuna: null }, { lugarInspeccion: "B", comuna: null })).toEqual({ lugarInspeccion: { antes: "A", despues: "B" } });
    expect(diferencias(null, { lugarInspeccion: "A" })).toEqual({ lugarInspeccion: { antes: null, despues: "A" } });
    expect(iniciales("rosa elena riquelme soto")).toBe("R. E. R.");
    // B-093: nombres con puntos, números, signos y paréntesis.
    expect(iniciales("Inspector 1 · SCC (prueba)")).toBe("I. S.");
    expect(iniciales("María de la Luz Ñúñez")).toBe("M. L. Ñ.");
    expect(iniciales("J. P. Soto")).toBe("J. P. S.");
  });
});

describe("B-019 · la cabecera hereda lo conocido", () => {
  it("Producción Nacional: clase/división y grupo, Nº ONU, RAF y lote", () => {
    const h = heredarCabecera({ documentoOrigen: "RAF 123", claseDivision: "1.1", grupoCompatibilidad: "d", numeroOnu: "UN 0081", lote: "L-7", esquema: "LOTES", elemento: "Dinamita" }, null);
    expect(h).toEqual({ documentoOrigen: "RAF 123", esquema: "LOTES", elementoGenerico: "Dinamita", claseDivisionUn: "1.1D", numeroUn: "0081", identificacionLote: "L-7" });
  });
  it("prototipo: solicitud DGMN, esquema TIPO y elemento; lo ya escrito manda", () => {
    const h = heredarCabecera({ documentoOrigen: "Sol. 45/2026", esquema: "TIPO", elemento: "Granada", tamanoMuestra: 5 }, { elementoGenerico: "Granada de mano M-2" });
    expect(h).toEqual({ documentoOrigen: "Sol. 45/2026", esquema: "TIPO", tamanoMuestra: 5 });
  });
  it("sin fuente: nada", () => {
    expect(heredarCabecera(null, null)).toEqual({});
  });
});
