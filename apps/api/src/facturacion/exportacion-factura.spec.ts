import {
  ESQUEMA_FACTURA,
  construirExportacion,
  erroresCuadratura,
  esExenta,
  faltantesReceptor,
  formaPagoSii,
  rutSii,
  rutValido,
  separarCodigo,
  sumarDias,
  type DatosExportacion,
} from "./exportacion-factura";

/** Datos PRUEBA de una factura afecta emitida, con todo completo. */
function base(over: Partial<DatosExportacion> = {}): DatosExportacion {
  return {
    factura: {
      id: "00000000-0000-0000-0000-000000000001",
      numero: "1001",
      estado: "emitida",
      origen: "cierre_ot",
      moneda: "CLP",
      fechaEmision: "2026-11-10",
      neto: 100000,
      ivaPct: 19,
      ivaMonto: 19000,
      total: 119000,
      exentaIva: null,
      observaciones: null,
    },
    lineas: [
      { descripcion: "EN1074 · PRUEBA ensayo de pesaje", cantidad: 2, precioUnitario: 40000, subtotal: 80000 },
      { descripcion: "PRUEBA servicio de muestreo", cantidad: 1, precioUnitario: 30000, subtotal: 30000 },
      { descripcion: "Descuento (10 %)", cantidad: 1, precioUnitario: -10000, subtotal: -10000 },
    ],
    emisor: {
      rut: "11.111.111-1",
      razonSocial: "Instituto de ejemplo",
      giro: "Servicios de laboratorio",
      acteco: "712000",
      direccion: "Calle Uno 100",
      comuna: "Santiago",
      ciudad: "Santiago",
    },
    receptor: {
      rut: "12.345.678-5",
      razonSocial: "PRUEBA Cliente SpA",
      giro: "Comercio",
      direccion: "Avenida Dos 200",
      comuna: "Providencia",
      ciudad: "Santiago",
      contactoNombre: "PRUEBA Contacto",
      diasCredito: 30,
    },
    formaPago: { codigo: "contado_30", etiqueta: "Contado 30 días" },
    referencias: [
      { tipo: "OT", folio: "OT-2026-0001", fecha: "2026-11-01" },
      { tipo: "COTIZACION", folio: "2026-00010", fecha: "2026-10-20" },
      { tipo: "OC", folio: "4500001", fecha: "2026-10-25", razon: "Orden de compra del cliente" },
      { tipo: "OPI", folio: null },
    ],
    centroCosto: { codigo: "LME-001", nombre: "PRUEBA centro" },
    hoy: "2026-11-14",
    ...over,
  };
}

describe("RUT con dígito verificador", () => {
  it("acepta RUT válidos con o sin puntos, y K mayúscula o minúscula", () => {
    expect(rutValido("12.345.678-5")).toBe(true);
    expect(rutValido("123456785")).toBe(true);
    expect(rutValido("11.111.111-1")).toBe(true);
    expect(rutValido("10.000.013-k")).toBe(true);
  });
  it("rechaza un dígito verificador incorrecto o un RUT vacío", () => {
    expect(rutValido("12.345.678-9")).toBe(false);
    expect(rutValido("")).toBe(false);
    expect(rutValido(null)).toBe(false);
  });
  it("formato del SII: sin puntos, con guion y K mayúscula", () => {
    expect(rutSii("12.345.678-5")).toBe("12345678-5");
    expect(rutSii("10000013k")).toBe("10000013-K");
    expect(rutSii("12.345.678-9")).toBeNull();
  });
});

describe("reglas auxiliares", () => {
  it("exenta: manda lo marcado; sin marca, IVA 0 % = exenta", () => {
    expect(esExenta({ exentaIva: true, ivaPct: 19 })).toBe(true);
    expect(esExenta({ exentaIva: false, ivaPct: 0 })).toBe(false);
    expect(esExenta({ exentaIva: null, ivaPct: 0 })).toBe(true);
    expect(esExenta({ exentaIva: null, ivaPct: 19 })).toBe(false);
  });
  it("separa «código · nombre» y deja el resto como nombre", () => {
    expect(separarCodigo("EN1074 · Equipo de pesaje")).toEqual({ codigo: "EN1074", nombre: "Equipo de pesaje" });
    expect(separarCodigo("Servicios de la OT X (valor estimado)")).toEqual({ codigo: null, nombre: "Servicios de la OT X (valor estimado)" });
  });
  it("forma de pago del SII y vencimiento", () => {
    expect(formaPagoSii("adelantado", 30).codigoSii).toBe(1);
    expect(formaPagoSii("contado_30", 30).codigoSii).toBe(2);
    expect(formaPagoSii(null, 0).codigoSii).toBe(1);
    expect(formaPagoSii("transferencia", 0).codigoSii).toBe(1);
    expect(formaPagoSii("transferencia", 30).codigoSii).toBe(2);
    expect(formaPagoSii("credito", 0).codigoSii).toBe(2);
    expect(sumarDias("2026-12-15", 30)).toBe("2027-01-14");
  });
  it("receptor incompleto: dice exactamente qué falta", () => {
    expect(faltantesReceptor({ rut: "12.345.678-9", razonSocial: "X", giro: "", direccion: "D", comuna: null, ciudad: "C" })).toEqual([
      "RUT válido (el registrado, 12.345.678-9, no pasa el dígito verificador)",
      "giro",
      "comuna",
    ]);
    expect(faltantesReceptor(null)).toEqual(["el cliente de la factura (no se encontró)"]);
  });
});

describe("cuadratura de totales", () => {
  it("neto + IVA + exento = total, con IVA = 19 % del neto", () => {
    expect(erroresCuadratura({ montoNeto: 100000, montoExento: 0, tasaIva: 19, iva: 19000, montoTotal: 119000 }, 33)).toEqual([]);
    expect(erroresCuadratura({ montoNeto: 0, montoExento: 50000, tasaIva: null, iva: 0, montoTotal: 50000 }, 34)).toEqual([]);
  });
  it("detecta un total que no cuadra, un IVA mal calculado y decimales", () => {
    expect(erroresCuadratura({ montoNeto: 100000, montoExento: 0, tasaIva: 19, iva: 19000, montoTotal: 119001 }, 33).join(" ")).toMatch(/no cuadran/);
    expect(erroresCuadratura({ montoNeto: 100000, montoExento: 0, tasaIva: 19, iva: 18000, montoTotal: 118000 }, 33).join(" ")).toMatch(/no es el 19 %/);
    expect(erroresCuadratura({ montoNeto: 100.5, montoExento: 0, tasaIva: 19, iva: 19, montoTotal: 119.5 }, 33).join(" ")).toMatch(/enteros/);
    expect(erroresCuadratura({ montoNeto: 1000, montoExento: 0, tasaIva: null, iva: 0, montoTotal: 1000 }, 34).join(" ")).toMatch(/exenta no lleva/);
  });
});

describe("construirExportacion · lims-idic.factura.v1", () => {
  it("factura afecta: tipo 33, montos enteros, descuento global y referencias", () => {
    const r = construirExportacion(base(), "2026-11-14T12:00:00-03:00");
    expect(r.errores).toEqual([]);
    const d = r.documento!;
    expect(d.esquema).toBe(ESQUEMA_FACTURA);
    expect(d.encabezado).toMatchObject({ tipoDte: 33, folioInterno: "1001", folioTributario: "1001", fechaEmision: "2026-11-10", fechaVencimiento: "2026-12-10" });
    expect(d.encabezado.formaPago).toMatchObject({ codigoSii: 2, codigoLims: "contado_30", diasCredito: 30 });
    expect(d.emisor.rut).toBe("11111111-1");
    expect(d.receptor.rut).toBe("12345678-5");
    expect(d.detalle).toHaveLength(2);
    expect(d.detalle[0]).toMatchObject({ linea: 1, codigo: { tipo: "INT1", valor: "EN1074" }, nombre: "PRUEBA ensayo de pesaje", cantidad: 2, unidad: "UN", montoItem: 80000, indicadorExencion: null });
    expect(d.descuentosRecargos).toEqual([{ linea: 1, tipoMovimiento: "D", glosa: "Descuento (10 %)", tipoValor: "$", valor: 10000, indicadorExencion: null }]);
    expect(d.totales).toEqual({ montoNeto: 100000, montoExento: 0, tasaIva: 19, iva: 19000, montoTotal: 119000 });
    expect(d.referencias.map((x) => [x.tipo, x.tipoDocSii, x.folio])).toEqual([
      ["OT", null, "OT-2026-0001"],
      ["COTIZACION", null, "2026-00010"],
      ["OC", "801", "4500001"],
    ]);
    expect(d.centroCosto).toEqual({ codigo: "LME-001", nombre: "PRUEBA centro" });
  });

  it("factura exenta (tasa de internación): tipo 34, todo exento, sin IVA", () => {
    const r = construirExportacion(
      base({
        factura: { ...base().factura, origen: "tasa_internacion", ivaPct: 0, ivaMonto: 0, neto: 50000, total: 50000, exentaIva: true },
        lineas: [{ descripcion: "Tasa de internación 1,5 % · PRUEBA", cantidad: 1, precioUnitario: 50000, subtotal: 50000 }],
        referencias: [{ tipo: "RESOLUCION", folio: "PRUEBA-123", fecha: "2026-10-01" }],
      }),
      "2026-11-14T12:00:00-03:00",
    );
    expect(r.errores).toEqual([]);
    expect(r.documento!.encabezado.tipoDte).toBe(34);
    expect(r.documento!.detalle[0].indicadorExencion).toBe(1);
    expect(r.documento!.totales).toEqual({ montoNeto: 0, montoExento: 50000, tasaIva: null, iva: 0, montoTotal: 50000 });
    expect(r.documento!.referencias[0].tipoDocSii).toBe("804");
  });

  it("tasa de internación afecta: se exporta, con advertencia", () => {
    const r = construirExportacion(base({ factura: { ...base().factura, origen: "tasa_internacion" } }), "x");
    expect(r.errores).toEqual([]);
    expect(r.advertencias.join(" ")).toMatch(/tasa de internación/);
  });

  it("no exporta una factura anulada", () => {
    const r = construirExportacion(base({ factura: { ...base().factura, estado: "anulada" } }), "x");
    expect(r.documento).toBeNull();
    expect(r.errores[0]).toMatch(/está anulada/);
  });

  it("no exporta sin receptor completo y dice qué falta", () => {
    const r = construirExportacion(base({ receptor: { ...base().receptor!, giro: "", comuna: "" } }), "x");
    expect(r.documento).toBeNull();
    expect(r.errores).toEqual(["Faltan datos del cliente (receptor): giro, comuna. Complételos en Clientes y vuelva a exportar."]);
  });

  it("no exporta si los importes registrados no cuadran con las líneas", () => {
    const r = construirExportacion(base({ factura: { ...base().factura, total: 120000 } }), "x");
    expect(r.documento).toBeNull();
    expect(r.errores.join(" ")).toMatch(/no cuadran con sus líneas/);
  });

  it("exenta con IVA registrado o afecta con IVA distinto de 19 %: error explicado", () => {
    expect(construirExportacion(base({ factura: { ...base().factura, exentaIva: true } }), "x").errores.join(" ")).toMatch(/marcada exenta/);
    expect(construirExportacion(base({ factura: { ...base().factura, ivaPct: 10, ivaMonto: 10000, total: 110000 } }), "x").errores.join(" ")).toMatch(/IVA del 19 %/);
  });

  it("línea en $ 0, sin líneas o en dólares: no se exporta", () => {
    expect(construirExportacion(base({ lineas: [...base().lineas, { descripcion: "Sin precio", cantidad: 1, precioUnitario: 0, subtotal: 0 }] }), "x").errores.join(" ")).toMatch(/monto \$ 0/);
    expect(construirExportacion(base({ lineas: [] }), "x").errores.join(" ")).toMatch(/no tiene líneas/);
    expect(construirExportacion(base({ factura: { ...base().factura, moneda: "USD" } }), "x").errores.join(" ")).toMatch(/solo facturas en pesos/);
  });

  it("pendiente: sin folio tributario, fecha de hoy sugerida y advertencia", () => {
    const r = construirExportacion(base({ factura: { ...base().factura, estado: "pendiente", numero: "PEND-OT-1" } }), "x");
    expect(r.errores).toEqual([]);
    expect(r.documento!.encabezado).toMatchObject({ folioInterno: "PEND-OT-1", folioTributario: null, fechaEmision: "2026-11-14", fechaEmisionSugerida: true });
    expect(r.advertencias.join(" ")).toMatch(/folio tributario lo asigna/);
  });

  it("emisor de ejemplo «PRUEBA»: advierte; emisor sin RUT válido: no exporta", () => {
    const conPrueba = construirExportacion(base({ emisor: { ...base().emisor, razonSocial: "PRUEBA · Instituto" } }), "x");
    expect(conPrueba.advertencias.join(" ")).toMatch(/de ejemplo/);
    const sinRut = construirExportacion(base({ emisor: { ...base().emisor, rut: "1-1" } }), "x");
    expect(sinRut.errores.join(" ")).toMatch(/Faltan datos del emisor \(IDIC\): RUT válido/);
  });

  it("montos con decimales se redondean a pesos enteros", () => {
    const r = construirExportacion(
      base({
        factura: { ...base().factura, neto: 1000, ivaMonto: 190, total: 1190 },
        lineas: [{ descripcion: "PRUEBA", cantidad: 3, precioUnitario: 333.333333, subtotal: 999.6 }],
      }),
      "x",
    );
    expect(r.errores).toEqual([]);
    expect(r.documento!.detalle[0].montoItem).toBe(1000);
    expect(Number.isInteger(r.documento!.totales.iva)).toBe(true);
  });
});
