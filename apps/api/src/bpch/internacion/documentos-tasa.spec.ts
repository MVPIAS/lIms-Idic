import { calcularTasa, repartirTasa, REPARTO_TASA_POR_DEFECTO } from "../comun/reglas-bpch";
import { cuerpoCartaCliente, cuerpoComunicacionBreve, documentoTasa, pdfDocumentoTasa, textoReparto, type DatosDocumentosTasa } from "./documentos-tasa";

/** Datos INVENTADOS (PRUEBA) para la Comunicación Breve y la carta al cliente (COM-03). */
function datos(cambios: Partial<DatosDocumentosTasa> = {}): DatosDocumentosTasa {
  const r = calcularTasa({
    cifUsd: 10_000,
    paridad: 950,
    pctAfecto: 100,
    tasaPct: 1.5,
    fleteNacional: 1_190_000,
    agenciaTotalFactura: 3_000_000,
    agenciaIvaInternacion: 1_805_000,
  });
  return {
    otCodigo: "OT-2026-9001",
    internacionNumero: "INT-2026-0001",
    resolucionNumero: "RES-PRUEBA-01",
    resolucionFecha: "2026-11-02",
    fecha: "2026-11-18",
    cliente: { razonSocial: "Importadora PRUEBA <SpA>", rut: "11.111.111-1", direccion: "Calle PRUEBA 123", comuna: "Santiago", email: "prueba@example.com" },
    unidad: { codigo: "SCC", nombre: "Sucursal PRUEBA" },
    calculo: {
      ...r,
      adValoremUsd: 0,
      dinNumero: "DIN-PRUEBA-1",
      facturaAgenciaNumero: "A-1",
      facturaAgenciaEmisor: "Agencia de aduana PRUEBA 1",
      facturaTransporteNumero: "T-9",
      facturaTransporteEmisor: "Transportes PRUEBA",
      fechaRecepcionSdbpch: "2026-11-10",
      agenciaAduana: "Agencia de aduana PRUEBA 1",
    },
    reparto: repartirTasa(r.tasa, REPARTO_TASA_POR_DEFECTO),
    certificados: [
      { numero: "3000/9001/9001/000001", condicion: "CUMPLE" },
      { numero: "3000/9001/9001/000002", condicion: "CUMPLE" },
    ],
    textos: { referencia: "Ley 17.798 «Control de armas»", parrafos: ["Primero PRUEBA.", "", "Tercero PRUEBA.", "  "], firmaCargo: "Jefe Departamento Comercial" },
    ...cambios,
  };
}

describe("Comunicación Breve de la tasa (COM-03)", () => {
  const html = cuerpoComunicacionBreve(datos());

  it("lleva el título, el Nº de control DTCG (= OT) y la frase de remisión", () => {
    expect(html).toContain("COMUNICACIÓN BREVE");
    expect(html).toContain("Nº control DTCG</th><td>OT-2026-9001");
    expect(html).toContain("Adjunto se remite cálculo de tasa 1,5 % para efectos de facturación correspondiente a O/T Nº OT-2026-9001.");
  });

  it("desglosa el cálculo: CIF, factura de la agencia menos IVA de internación, flete, % afecto y TOTAL A CANCELAR", () => {
    expect(html).toContain("$ 9.500.000");
    expect(html).toContain("Fact. Nº A-1 de Agencia de aduana PRUEBA 1");
    expect(html).toContain("- $ 1.805.000");
    expect(html).toContain("Fact. Nº T-9 de Transportes PRUEBA");
    expect(html).toContain("$ 11.885.000"); // base
    expect(html).toContain("TOTAL A CANCELAR");
    expect(html).toContain("$ 178.275");
    expect(html).toContain("Declaración de Ingreso Nº DIN-PRUEBA-1");
    expect(html).toContain("Fecha de recepción de documentos SDBPCH: 10-11-2026.");
    // Sin ad valorem ni otros gastos: no se imprimen esas filas.
    expect(html).not.toContain("Ad valorem");
    expect(html).not.toContain("Otros gastos por cuenta del cliente");
  });

  it("lista los certificados de la resolución, el reparto por centro de costo, la firma y la copia", () => {
    expect(html).toContain("3000/9001/9001/000002</td><td>CUMPLE");
    expect(html).toContain("Total de certificados: 2.");
    expect(html).toContain("Sucursal · Sucursal PRUEBA (SCC)");
    expect(html).toContain("<b>$ 178.275</b>");
    expect(html).toContain("Jefe Departamento Comercial");
    expect(html).toContain("Copia Depto. Comercial.");
  });

  it("escapa los datos del cliente", () => {
    expect(html).toContain("Importadora PRUEBA &lt;SpA&gt;");
    expect(html).not.toContain("<SpA>");
  });

  it("sin certificados oficiales lo dice", () => {
    expect(cuerpoComunicacionBreve(datos({ certificados: [] }))).toContain("Aún no hay certificados oficiales");
  });
});

describe("Carta al cliente de la tasa (COM-03)", () => {
  const html = cuerpoCartaCliente(datos());

  it("numera solo los párrafos con texto (los vacíos no se imprimen)", () => {
    expect(html).toContain("<p>1.- Primero PRUEBA.</p>");
    expect(html).toContain("<p>2.- Tercero PRUEBA.</p>");
    expect(html).not.toContain("3.-");
  });

  it("lleva empresa, RUT, Nº DTCG, referencia, resolución, fecha del documento y monto a cancelar", () => {
    expect(html).toContain("IDIC.BPCH.DTCG Nº</th><td>OT-2026-9001");
    expect(html).toContain("Ley 17.798 «Control de armas»");
    expect(html).toContain("RES-PRUEBA-01");
    expect(html).toContain("02-11-2026");
    expect(html).toContain("<b>$ 178.275</b>");
    expect(html).toContain("prueba@example.com");
  });
});

describe("documento y observación de la factura", () => {
  it("el sello no tiene código de verificación y el archivo lleva la OT", () => {
    const x = documentoTasa("carta-cliente", datos());
    expect(x.sello.codigoVerificacion).toBe("");
    expect(x.archivo).toBe("Carta-tasa-OT-2026-9001");
    expect(documentoTasa("comunicacion-breve", datos()).archivo).toBe("CB-tasa-OT-2026-9001");
  });

  it("la observación de la factura informa el reparto sin cambiar el total", () => {
    const d = datos();
    expect(textoReparto(d.reparto, d.unidad)).toBe(
      "Cargar a centro de costo: Sucursal · Sucursal PRUEBA (SCC) 85 % $ 151.533 · DTCG 10 % $ 17.829 · SDBPCH 5 % $ 8.913.",
    );
  });
});

describe("PDF de los documentos de la tasa", () => {
  it.each(["comunicacion-breve", "carta-cliente"] as const)("%s genera un PDF", async (tipo) => {
    const { buffer, nombre } = await pdfDocumentoTasa(tipo, datos());
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(nombre).toMatch(/OT-2026-9001\.pdf$/);
  }, 30_000);
});
