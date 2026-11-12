import { diferencias, erroresCabecera, heredarCabecera, faltantesParaEmitirInspeccion, iniciales, loteEnUnidades, camposLotesImpresos, tamanoCabeceraImpreso } from "./reglas-cabecera";
import { muestraSuperaLote } from "../comun/reglas-bpch";

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
  it("D07-12 · Producción Nacional: el tamaño del lote es la cantidad programada (entera); lo escrito manda", () => {
    expect(heredarCabecera({ lote: "L-9", tamanoLote: "1200" }, null)).toEqual({ identificacionLote: "L-9", tamanoLote: 1200 });
    expect(heredarCabecera({ tamanoLote: "12.5" }, null)).toEqual({});
    expect(heredarCabecera({ tamanoLote: 1200 }, { tamanoLote: 900 })).toEqual({});
  });
  it("sin fuente: nada", () => {
    expect(heredarCabecera(null, null)).toEqual({});
  });
});

describe("F005 · lote y muestra en la misma escala", () => {
  const ok = { procedimiento: "SAC-PG01-P01" };
  it("2 Toneladas de lote y 5 Kilos de muestra es válido", () => {
    expect(erroresCabecera({ ...ok, tamanoLote: 2, unidadLote: "t", tamanoMuestra: 5, unidadMuestra: "kg" })).toEqual([]);
  });
  it("5 Toneladas de muestra para 2 Toneladas de lote no", () => {
    expect(erroresCabecera({ ...ok, tamanoLote: 2, unidadLote: "t", tamanoMuestra: 5, unidadMuestra: "t" }).join(" ")).toMatch(/5 Toneladas.*2 Toneladas/);
  });
  it("unidades incompatibles no se comparan; sin unidades, tal cual", () => {
    expect(muestraSuperaLote(2, "t", 50, "unidades")).toBeNull();
    expect(muestraSuperaLote(2, null, 5, null)).toBe(true);
    expect(muestraSuperaLote(3000, "g", 2, "kg")).toBe(false);
  });
  it("F014: el documento imprime todos los lotes con unidad y vencimiento", () => {
    const r = camposLotesImpresos([
      { identificacion: "L-PRUEBA-V4-A1", tamanoLote: "800.000", unidadLote: "kg", tamanoMuestra: "13", unidadMuestra: "kg", vencimiento: "2027-01-31" },
      { identificacion: "L-PRUEBA-V4-A2", tamanoLote: 2, unidadLote: "t", tamanoMuestra: 5, unidadMuestra: "kg", vencimiento: null },
    ]);
    expect(r?.lote).toBe("L-PRUEBA-V4-A1 · L-PRUEBA-V4-A2");
    expect(r?.tamano_lote_muestra).toBe("L-PRUEBA-V4-A1: 800 Kilos / 13 Kilos · L-PRUEBA-V4-A2: 2 Toneladas / 5 Kilos");
    expect(r?.vencimiento_producto).toBe("L-PRUEBA-V4-A1: 31-01-2027");
    expect(camposLotesImpresos([])).toBeNull();
    expect(tamanoCabeceraImpreso({ tamanoLote: "1500", unidadLote: "unidades", tamanoMuestra: "13", unidadMuestra: "unidades" })).toBe("1.500 Unidades / 13 Unidades");
    expect(tamanoCabeceraImpreso({ tamanoLote: 800, tamanoMuestra: 13 })).toBeNull();
  });
  it("el plan NCh 44 solo se propone con el lote en unidades", () => {
    expect(loteEnUnidades("unidades")).toBe(true);
    expect(loteEnUnidades("pares")).toBe(true);
    expect(loteEnUnidades(null)).toBe(true);
    expect(loteEnUnidades("t")).toBe(false);
  });
});
