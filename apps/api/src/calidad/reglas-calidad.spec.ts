import { codigoAlicuota, erroresAcreditacion, erroresMovimientoAlicuota, estadoAcreditacion, planMovimientoAlicuota } from "./reglas-calidad";

describe("calidad · acreditación ISO/IEC 17025 (§4.3.5)", () => {
  it("valida número y vigencia", () => {
    expect(erroresAcreditacion({ numero: "LE 123", vigenteDesde: "2026-01-01", vigenteHasta: "2030-01-01" })).toEqual([]);
    expect(erroresAcreditacion({ numero: null, vigenteDesde: null, vigenteHasta: null })).toHaveLength(1);
    expect(erroresAcreditacion({ numero: "LE 1", vigenteDesde: "2026-05-01", vigenteHasta: "2026-01-01" })).toEqual(["La vigencia termina antes de empezar."]);
    expect(erroresAcreditacion({ numero: "LE 1", vigenteDesde: "01-05-2026", vigenteHasta: null })[0]).toMatch(/AAAA-MM-DD/);
  });

  it("estado según la fecha de hoy en Chile", () => {
    expect(estadoAcreditacion({ vigenteDesde: "2026-01-01", vigenteHasta: "2028-01-01" }, "2026-11-02")).toBe("vigente");
    expect(estadoAcreditacion({ vigenteDesde: null, vigenteHasta: "2026-12-01" }, "2026-11-02")).toBe("por_vencer");
    expect(estadoAcreditacion({ vigenteDesde: null, vigenteHasta: "2026-11-01" }, "2026-11-02")).toBe("vencida");
    expect(estadoAcreditacion({ vigenteDesde: "2027-01-01", vigenteHasta: null }, "2026-11-02")).toBe("futura");
    expect(estadoAcreditacion({ vigenteDesde: null, vigenteHasta: null }, "2026-11-02")).toBe("vigente");
  });
});

describe("calidad · alícuotas (§4.2.1)", () => {
  it("código correlativo por muestra", () => {
    expect(codigoAlicuota("M-2026-0013-1", [])).toBe("M-2026-0013-1-A1");
    expect(codigoAlicuota("M-2026-0013-1", ["M-2026-0013-1-A1", "M-2026-0013-1-A3", "OTRA-A9"])).toBe("M-2026-0013-1-A4");
    expect(codigoAlicuota("M(1)", ["M(1)-A2"])).toBe("M(1)-A3");
  });

  it("consumo: no más de lo que queda; al agotarse queda consumida", () => {
    const a = { estado: "disponible", restante: 10 };
    expect(erroresMovimientoAlicuota({ tipo: "consumo", cantidad: 11, estado: null, ubicacionId: null, detalle: null }, a)[0]).toMatch(/Solo quedan 10/);
    expect(planMovimientoAlicuota({ tipo: "consumo", cantidad: 4, estado: null, ubicacionId: null, detalle: null }, a)).toEqual({ estado: "en_uso", restante: 6 });
    expect(planMovimientoAlicuota({ tipo: "consumo", cantidad: 10, estado: null, ubicacionId: null, detalle: null }, a)).toEqual({ estado: "consumida", restante: 0 });
    expect(planMovimientoAlicuota({ tipo: "consumo", cantidad: 0.1, estado: null, ubicacionId: null, detalle: null }, { estado: "en_uso", restante: 0.3 })).toEqual({ estado: "en_uso", restante: 0.2 });
  });

  it("estado, traslado y alícuotas cerradas", () => {
    const a = { estado: "en_uso", restante: 5 };
    expect(erroresMovimientoAlicuota({ tipo: "estado", cantidad: null, estado: "descartada", ubicacionId: null, detalle: "" }, a)[0]).toMatch(/motivo del descarte/);
    expect(planMovimientoAlicuota({ tipo: "estado", cantidad: null, estado: "descartada", ubicacionId: null, detalle: "derrame" }, a)).toEqual({ estado: "descartada", restante: 0 });
    expect(erroresMovimientoAlicuota({ tipo: "traslado", cantidad: null, estado: null, ubicacionId: null, detalle: null }, a)).toEqual(["Elija la ubicación de destino."]);
    expect(erroresMovimientoAlicuota({ tipo: "consumo", cantidad: 1, estado: null, ubicacionId: null, detalle: null }, { estado: "consumida", restante: 0 })[0]).toMatch(/no admite/);
    expect(erroresMovimientoAlicuota({ tipo: "x", cantidad: null, estado: null, ubicacionId: null, detalle: null }, a)).toHaveLength(1);
  });
});
