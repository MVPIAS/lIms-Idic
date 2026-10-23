import { csvTasa, estadoPagoTasa, rangoMes, resumenTasa, type FilaTasa } from "./tasa-mensual";

const fila = (p: Partial<FilaTasa>): FilaTasa => ({
  internacion: "INT-1", ot: "OT-1", otId: "o1", resolucion: "R-1", cliente: "C", centroCosto: "SSTGO", calculadaAt: "2026-10-05",
  tasa: 1000, iva: 190, total: 1190, factura: null, estadoFactura: null, pagado: 0, estadoPago: "sin_facturar", ...p,
});

describe("Tasa 1,5 % · informe mensual (EP-06 6.23, BL-164)", () => {
  it("estado de pago según la factura y lo pagado", () => {
    expect(estadoPagoTasa({ facturaEstado: null, total: 100, pagado: 0 })).toBe("sin_facturar");
    expect(estadoPagoTasa({ facturaEstado: "pendiente", total: 100, pagado: 0 })).toBe("sin_facturar");
    expect(estadoPagoTasa({ facturaEstado: "emitida", total: 100, pagado: 0 })).toBe("por_cobrar");
    expect(estadoPagoTasa({ facturaEstado: "parcial", total: 100, pagado: 40 })).toBe("abonada");
    expect(estadoPagoTasa({ facturaEstado: "emitida", total: 100, pagado: 100 })).toBe("pagada");
  });
  it("resumen por centro de costo", () => {
    const r = resumenTasa([fila({}), fila({ otId: "o2", centroCosto: "SANTOF", total: 2380, tasa: 2000 })]);
    expect(r).toMatchObject({ nOt: 2, tasa: 3000, total: 3570 });
    expect(r.porCentro).toEqual([{ centro: "SSTGO", total: 1190 }, { centro: "SANTOF", total: 2380 }]);
  });
  it("rango del mes y diciembre", () => {
    expect(rangoMes("2026-10")).toEqual({ desde: "2026-10-01", hasta: "2026-11-01" });
    expect(rangoMes("2026-12")).toEqual({ desde: "2026-12-01", hasta: "2027-01-01" });
    expect(() => rangoMes("2026-13")).toThrow();
  });
  it("CSV para Excel con «;» y texto entre comillas si hace falta", () => {
    const c = csvTasa("2026-10", [fila({ cliente: "Empresa; Ltda." })]);
    expect(c.startsWith("﻿Mes;Internación;OT")).toBe(true);
    expect(c).toContain('"Empresa; Ltda."');
    expect(c).toContain(";1190;;Sin facturar;0");
  });
});
