import { errorDocumentoAceptacion, TIPOS_ACEPTACION } from "./reglas-ot";

describe("documento de aceptación (reuniones 2 y 3)", () => {
  it("incluye OPI, Resolución y Oficio (BPCH), correo y pago adelantado", () => {
    expect(TIPOS_ACEPTACION).toEqual(expect.arrayContaining(["OPI_RESOLUCION", "RESOLUCION", "OFICIO", "CORREO", "PAGO_ADELANTADO"]));
  });

  it("OPI, Resolución, Oficio y O/C exigen número", () => {
    for (const tipo of ["OPI_RESOLUCION", "RESOLUCION", "OFICIO", "OC"])
      expect(errorDocumentoAceptacion({ tipo, numero: " ", tieneComprobante: true, exigeComprobante: true })).toMatch(/requiere número/);
    expect(errorDocumentoAceptacion({ tipo: "CORREO", numero: null, tieneComprobante: true, exigeComprobante: true })).toBeNull();
  });

  it("exige el comprobante adjunto (configurable), salvo la disposición del Director", () => {
    expect(errorDocumentoAceptacion({ tipo: "CORREO", tieneComprobante: false, exigeComprobante: true })).toMatch(/Adjunte el comprobante/);
    expect(errorDocumentoAceptacion({ tipo: "CORREO", tieneComprobante: false, exigeComprobante: false })).toBeNull();
    expect(errorDocumentoAceptacion({ tipo: "DISPOSICION_DIRECTOR", numero: "D-1", tieneComprobante: false, exigeComprobante: true })).toBeNull();
    expect(errorDocumentoAceptacion({ tipo: "PAGO_ADELANTADO", tieneComprobante: true, exigeComprobante: true })).toBeNull();
  });

  it("rechaza un tipo desconocido", () => {
    expect(errorDocumentoAceptacion({ tipo: "FAX", tieneComprobante: true, exigeComprobante: false })).toMatch(/desconocido/);
  });
});
