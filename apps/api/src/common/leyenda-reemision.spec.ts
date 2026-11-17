import { esModalidadReemision, leyendaReemision, motivoNoReemite, numeroModificado, versionDeNumero } from "./leyenda-reemision";

describe("Certificado modificado y de reemplazo (R9, todos los laboratorios)", () => {
  it("la modificación conserva el número con la versión siguiente", () => {
    expect(numeroModificado("LCPNF-010.26")).toBe("LCPNF-010.26-V2");
    expect(numeroModificado("LCPNF-010.26-V2")).toBe("LCPNF-010.26-V3");
    expect(numeroModificado(" M-3950-v9 ")).toBe("M-3950-V10");
    expect(versionDeNumero("X-V4")).toBe(4);
    expect(versionDeNumero("X")).toBe(1);
  });
  it("modificar exige la OT abierta; reemplazar vale también con la OT cerrada", () => {
    expect(motivoNoReemite({ modalidad: "modificacion", otCerrada: false, estadoDocumento: "emitida" })).toBeNull();
    expect(motivoNoReemite({ modalidad: "modificacion", otCerrada: true, estadoDocumento: "emitida" })).toMatch(/OT ya está cerrada.*reemplazo/);
    expect(motivoNoReemite({ modalidad: "reemplazo", otCerrada: true, estadoDocumento: "oficial", tipo: "documento" })).toBeNull();
    expect(motivoNoReemite({ modalidad: "reemplazo", otCerrada: false, estadoDocumento: "en_firma", tipo: "documento" })).toBe("Solo se modifica o reemplaza un documento emitido.");
  });
  it("leyendas: modificado con fecha y motivo; reemplazo con el número anterior", () => {
    expect(leyendaReemision({ modalidad: "modificacion", numeroAnterior: "LCPNF-010.26", fechaAnterior: "2026-11-03", motivo: "PRUEBA error de tipeo en la serie." }))
      .toBe("CERTIFICADO MODIFICADO: esta versión reemplaza a la emitida con el N° LCPNF-010.26 el 03-11-2026. Motivo: PRUEBA error de tipeo en la serie.");
    expect(leyendaReemision({ modalidad: "reemplazo", numeroAnterior: "M-3950" })).toBe("ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° M-3950.");
    expect(leyendaReemision({ modalidad: "reemplazo", numeroAnterior: "INF-2026-0007", fechaAnterior: "2026-10-30", tipo: "documento", motivo: "PRUEBA" }))
      .toBe("ESTE DOCUMENTO REEMPLAZA AL DOCUMENTO N° INF-2026-0007 EMITIDO EL 30-10-2026. Motivo: PRUEBA.");
    expect(leyendaReemision({ modalidad: "modificacion", numeroAnterior: "X", tipo: "documento" })).toMatch(/^DOCUMENTO MODIFICADO/);
  });
  it("solo dos modalidades", () => {
    expect(esModalidadReemision("modificacion")).toBe(true);
    expect(esModalidadReemision("anular")).toBe(false);
  });
});
