import { calcularOpiPendiente, origenDesdeAceptacion, resolverCobro, validarOrigenOt } from "./reglas-ot";

describe("Reglas OT · origen / cobro / OPI pendiente (Comercial R2)", () => {
  describe("calcularOpiPendiente (SVT7)", () => {
    it("disposición del Director CON cobro y sin OPI → pendiente", () => {
      expect(calcularOpiPendiente({ origen: "DISPOSICION", conCobro: true })).toBe(true);
      expect(calcularOpiPendiente({ aceptacionTipo: "DISPOSICION_DIRECTOR", conCobro: true })).toBe(true);
    });
    it("disposición SIN cobro → no espera OPI", () => {
      expect(calcularOpiPendiente({ origen: "DISPOSICION", conCobro: false })).toBe(false);
      expect(calcularOpiPendiente({ aceptacionTipo: "DISPOSICION_DIRECTOR", conCobro: false })).toBe(false);
    });
    it("si ya trae OPI, no queda pendiente", () => {
      expect(calcularOpiPendiente({ origen: "DISPOSICION", conCobro: true, opiNumero: "OPI-123" })).toBe(false);
      expect(calcularOpiPendiente({ origen: "DISPOSICION", conCobro: true, opiNumero: "   " })).toBe(true);
    });
    it("otros orígenes nunca quedan con OPI pendiente", () => {
      for (const origen of ["COTIZACION", "INTERNACION", "INTERLABORATORIO", "OT_INTERNA", null]) {
        expect(calcularOpiPendiente({ origen, conCobro: true })).toBe(false);
      }
      for (const aceptacionTipo of ["OPI_RESOLUCION", "OC", "CORREO", "PAGO_ADELANTADO"]) {
        expect(calcularOpiPendiente({ origen: "COTIZACION", aceptacionTipo, conCobro: true })).toBe(false);
      }
    });
  });

  it("origenDesdeAceptacion", () => {
    expect(origenDesdeAceptacion("DISPOSICION_DIRECTOR")).toBe("DISPOSICION");
    expect(origenDesdeAceptacion("OPI_RESOLUCION")).toBe("COTIZACION");
    expect(origenDesdeAceptacion(undefined)).toBe("COTIZACION");
  });

  describe("resolverCobro", () => {
    it("Interlaboratorio siempre sin cobro", () => {
      expect(resolverCobro("INTERLABORATORIO", undefined)).toEqual({ conCobro: false });
      expect(resolverCobro("INTERLABORATORIO", false)).toEqual({ conCobro: false });
      expect(resolverCobro("INTERLABORATORIO", true).error).toBeDefined();
    });
    it("resto: con cobro por defecto, respeta lo indicado", () => {
      expect(resolverCobro("COTIZACION", undefined).conCobro).toBe(true);
      expect(resolverCobro("DISPOSICION", false).conCobro).toBe(false);
      expect(resolverCobro(undefined, undefined).conCobro).toBe(true);
    });
  });

  describe("validarOrigenOt", () => {
    it("DISPOSICION exige referencia", () => {
      expect(validarOrigenOt({ origen: "DISPOSICION" })).toHaveLength(1);
      expect(validarOrigenOt({ origen: "DISPOSICION", disposicionRef: "DISP-DIR-12/2026" })).toHaveLength(0);
    });
    it("INTERLABORATORIO exige solicitante y ejecutor distintos, sin cotización", () => {
      expect(validarOrigenOt({ origen: "INTERLABORATORIO" })).toHaveLength(2);
      expect(validarOrigenOt({ origen: "INTERLABORATORIO", labSolicitanteCcId: "a", centroCostoId: "a" })).toHaveLength(1);
      expect(validarOrigenOt({ origen: "INTERLABORATORIO", labSolicitanteCcId: "a", centroCostoId: "b", cotizacionId: "c" })).toHaveLength(1);
      expect(validarOrigenOt({ origen: "INTERLABORATORIO", labSolicitanteCcId: "a", centroCostoId: "b" })).toHaveLength(0);
    });
    it("COTIZACION exige cotizacionId; INTERNACION ya no se registra a mano (puerta única)", () => {
      expect(validarOrigenOt({ origen: "COTIZACION" })).toHaveLength(1);
      expect(validarOrigenOt({ origen: "INTERNACION" })).toHaveLength(1);
      expect(validarOrigenOt({ origen: "INTERNACION", resolucion: "17.798-2026-0158" })[0]).toMatch(/resolución DGMN en Internaciones/);
    });
    it("sin origen no exige nada (compatibilidad)", () => {
      expect(validarOrigenOt({})).toHaveLength(0);
    });
  });
});
