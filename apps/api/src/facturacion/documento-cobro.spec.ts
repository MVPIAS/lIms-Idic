import { LEYENDA_NO_DTE, cuerpoDocumentoCobroHtml, documentoCobro, pdfDocumentoCobro, textoFormaPago, type DatosDocumentoCobro } from "./documento-cobro";

const datos = (estado = "emitida"): DatosDocumentoCobro => ({
  factura: {
    id: "00000000-0000-0000-0000-000000000001",
    numero: "1001",
    estado,
    moneda: "CLP",
    fechaEmision: "2026-11-10",
    neto: 50000,
    ivaPct: 0,
    ivaMonto: 0,
    total: 50000,
    exentaIva: true,
  },
  lineas: [{ descripcion: "EN1 · PRUEBA tasa", cantidad: 1, precioUnitario: 50000, subtotal: 50000 }],
  emisor: { rut: "11.111.111-1", razonSocial: "PRUEBA Instituto", giro: "PRUEBA giro", direccion: "PRUEBA calle", comuna: "Santiago", ciudad: "Santiago" },
  receptor: { rut: "12.345.678-5", razonSocial: "PRUEBA Cliente <SpA>", giro: "Comercio", direccion: "Av. 1", comuna: "Ñuñoa", ciudad: "Santiago" },
  referencias: [{ tipo: "OT", folio: "OT-PRUEBA-1", fecha: "2026-11-01" }],
  pagado: 20000,
  notasCredito: 0,
});

describe("documento de cobro", () => {
  it("dice de forma visible que no es un documento tributario electrónico", () => {
    const html = cuerpoDocumentoCobroHtml(datos());
    expect(html).toContain("DOCUMENTO DE COBRO");
    expect(html).toContain("No es un documento tributario electrónico");
    expect(html).toContain(LEYENDA_NO_DTE);
    expect(html).toContain("Factura exenta (34)");
    expect(html).toContain("PRUEBA Cliente &lt;SpA&gt;");
    expect(html).toContain("$ 30.000"); // saldo
  });

  it("el pie de cada página repite la leyenda; una anulada lleva la marca de anulada", () => {
    expect(documentoCobro(datos(), "2026-11-14").sello.numero).toContain(LEYENDA_NO_DTE);
    expect(documentoCobro(datos("anulada"), "2026-11-14").sello.estadoDocumento).toBe("anulado");
  });

  it("forma de pago sin repetir los días", () => {
    expect(textoFormaPago({ codigo: "contado_30", etiqueta: "Contado 30 días" }, 30)).toBe("Contado 30 días");
    expect(textoFormaPago({ codigo: "transferencia", etiqueta: "Transferencia" }, 30)).toBe("Transferencia · 30 días");
    expect(textoFormaPago(null, 0)).toBe("—");
  });

  it("genera un PDF", async () => {
    const pdf = await pdfDocumentoCobro(datos(), "2026-11-14");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
