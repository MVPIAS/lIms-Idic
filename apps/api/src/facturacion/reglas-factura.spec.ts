import {
  esNumeroBorrador,
  estadoPorPagos,
  lineasDesdeCotizacion,
  numeroBorrador,
  redondear,
  totales,
  validarNotaCredito,
  validarPago,
} from "./reglas-factura";
import { validarImagenFirma } from "../rbac/firmas-imagen.controller";

describe("reglas-factura · borrador desde la cotización aceptada", () => {
  it("copia las líneas y cuadra exactamente con el neto aceptado", () => {
    const lineas = lineasDesdeCotizacion({
      codigo: "COT-2026-0001",
      moneda: "CLP",
      neto: 171000,
      ivaPct: 19,
      descuentoPct: 10,
      descuentoMonto: 20000,
      gastosAdminPct: 5,
      gastosAdminMonto: 9000,
      lineas: [
        { descripcion: "pH", ensayoCodigo: "EN-01", cantidad: 2, precioUnitario: 50000, subtotal: 100000, orden: 1 },
        { descripcion: "Cobre", cantidad: 1, precioUnitario: 82000, subtotal: 82000, orden: 2 },
      ],
    });
    expect(lineas.map((l) => [l.descripcion, l.cantidad, l.precioUnitario, l.subtotal])).toEqual([
      ["EN-01 · pH", 2, 50000, 100000],
      ["Cobre", 1, 82000, 82000],
      ["Descuento (10 %)", 1, -20000, -20000],
      ["Gastos administrativos (5 %)", 1, 9000, 9000],
    ]);
    expect(lineas.reduce((a, l) => a + l.subtotal, 0)).toBe(171000);
  });

  it("añade una línea de ajuste si queda diferencia (utilidad, redondeos)", () => {
    const lineas = lineasDesdeCotizacion({
      codigo: "COT-2026-0002",
      moneda: "CLP",
      neto: 120000,
      ivaPct: 19,
      lineas: [{ descripcion: "Ensayo", cantidad: 1, precioUnitario: 100000, subtotal: 100000 }],
    });
    expect(lineas[1]).toEqual({ descripcion: "Ajuste según cotización COT-2026-0002", cantidad: 1, precioUnitario: 20000, subtotal: 20000 });
  });

  it("moneda extranjera con 2 decimales", () => {
    expect(redondear(10.005, "USD")).toBe(10.01);
    expect(redondear(10.5, "CLP")).toBe(11);
    expect(totales([{ subtotal: 100 }, { subtotal: 23.45 }], 19, "USD")).toEqual({ neto: 123.45, ivaMonto: 23.46, total: 146.91 });
    expect(totales([{ subtotal: 171000 }], 19, "CLP")).toEqual({ neto: 171000, ivaMonto: 32490, total: 203490 });
  });

  it("número provisional del borrador", () => {
    expect(numeroBorrador("OT-2026-0007")).toBe("PEND-OT-2026-0007");
    expect(esNumeroBorrador("PEND-OT-2026-0007")).toBe(true);
    expect(esNumeroBorrador("F-1234")).toBe(false);
  });
});

describe("reglas-factura · pagos", () => {
  it("estado según lo pagado", () => {
    expect(estadoPorPagos(1000, 0)).toBe("emitida");
    expect(estadoPorPagos(1000, 400)).toBe("parcial");
    expect(estadoPorPagos(1000, 1000)).toBe("pagada");
    expect(estadoPorPagos(1000, 800, 200)).toBe("pagada");
  });

  it("valida el pago contra el estado y el saldo", () => {
    expect(validarPago("pendiente", 1000, 100)).toContain("pendiente de emitir");
    expect(validarPago("anulada", 1000, 100)).toContain("anulada");
    expect(validarPago("pagada", 0, 100)).toContain("ya está pagada");
    expect(validarPago("emitida", 1000, 1200)).toContain("supera el saldo");
    expect(validarPago("parcial", 600, 600)).toBeNull();
    expect(validarPago("emitida", 1000, 0)).toContain("mayor que cero");
  });
});

describe("reglas-factura · notas de crédito", () => {
  it("valida la nota contra el estado y el saldo", () => {
    expect(validarNotaCredito("pendiente", 1000, 100)).toContain("pendiente de emitir");
    expect(validarNotaCredito("anulada", 1000, 100)).toContain("anulada");
    expect(validarNotaCredito("emitida", 1000, 0)).toContain("mayor que cero");
    expect(validarNotaCredito("emitida", 1000, 1200)).toContain("supera el saldo");
    expect(validarNotaCredito("parcial", 400, 400)).toBeNull();
    expect(validarNotaCredito("pagada", 0, 1)).toContain("supera el saldo");
  });

  it("una factura saldada solo con notas de crédito queda pagada", () => {
    expect(estadoPorPagos(1000, 0, 1000)).toBe("pagada");
    expect(estadoPorPagos(1000, 0, 300)).toBe("parcial");
  });
});

describe("firma · imagen", () => {
  const PNG_1x1 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("acepta un PNG real y calcula su huella", () => {
    const r = validarImagenFirma(PNG_1x1);
    expect(r.mime).toBe("image/png");
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rechaza lo que no es PNG/JPEG aunque lo diga el prefijo", () => {
    expect(() => validarImagenFirma("data:image/png;base64," + Buffer.from("<svg></svg>").toString("base64"))).toThrow(
      "no es una imagen",
    );
    expect(() => validarImagenFirma("data:image/svg+xml;base64,PHN2Zz4=")).toThrow("PNG o JPEG");
  });
});

describe("descripción de la línea de factura sin código repetido (B-084)", () => {
  const { descripcionLineaFactura } = require("./reglas-factura");
  it("no repite el código si la descripción ya lo trae", () => {
    expect(descripcionLineaFactura("131", "131 · Cloruro de Sodio")).toBe("131 · Cloruro de Sodio");
    expect(descripcionLineaFactura("EN1074", "EN1074 · Equipo de pesaje")).toBe("EN1074 · Equipo de pesaje");
  });
  it("antepone el código si no lo trae", () => {
    expect(descripcionLineaFactura("131", "Cloruro de Sodio")).toBe("131 · Cloruro de Sodio");
    expect(descripcionLineaFactura("13", "131 · Cloruro")).toBe("13 · 131 · Cloruro");
    expect(descripcionLineaFactura(null, "Servicio")).toBe("Servicio");
  });
});
