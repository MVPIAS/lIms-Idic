import { bloqueIbisArma, fichaEvidencia, normalizarBusqueda, paginaFichas, textoHit, tipoTestigo } from "./ibis-testigos";

describe("IBIS · evidencias de prueba", () => {
  it("reconoce la vaina y el proyectil del XML; el resto no es evidencia de prueba", () => {
    expect(tipoTestigo("Cartridge Case")).toBe("vainilla");
    expect(tipoTestigo("Bullet")).toBe("proyectil");
    expect(tipoTestigo("Firearm")).toBeNull();
    expect(tipoTestigo(null)).toBeNull();
  });

  it("texto del resultado: con o sin hit", () => {
    expect(textoHit(0)).toBe("Sin hit");
    expect(textoHit(2)).toBe("Con hit (2)");
    expect(textoHit(null)).toBe("Sin hit");
  });

  it("certificado por arma: «Pendiente de IBIS» sin resultado, y el resultado con sus evidencias", () => {
    expect(bloqueIbisArma(null)).toContain("Pendiente de IBIS");
    const html = bloqueIbisArma({
      uuid: "EXH_FIR_1",
      exhibit: "FA-1",
      fechaPrueba: "11-11-2026",
      hitCount: 1,
      evidencias: [
        { codigo: "EV-2026-0001", tipo: "vainilla", exhibit: "TF-1", hitCount: 1, ubicacion: "Estante 3" },
        { codigo: "EV-2026-0002", tipo: "proyectil", exhibit: "TF-2", hitCount: 0, ubicacion: null },
      ],
    });
    expect(html).toContain("EXH_FIR_1");
    expect(html).toContain("Con hit (1)");
    expect(html).toContain("Vaina");
    expect(html).toContain("Proyectil");
    expect(html).not.toContain("Pendiente de IBIS");
  });

  it("ficha tipo biblioteca: código de barras, datos del arma y ubicación en texto; escapa HTML", () => {
    const f = fichaEvidencia({
      codigo: "EV-2026-0001",
      codigoBarras: null,
      tipo: "vainilla",
      exhibit: "TF-1",
      uuidIbis: "EXH_1",
      serie: "<b>X1</b>",
      marca: "PRUEBA",
      modelo: "M1",
      calibre: "9 mm",
      ot: "OT-2026-0001",
      fechaDisparo: "11-11-2026 10:00",
      ubicacion: "Almacén 1 · estante 3 · línea 4 · caja 5",
      hitCount: 0,
    });
    expect(f).toContain("<svg");
    expect(f).toContain("estante 3 · línea 4 · caja 5");
    expect(f).toContain("&lt;b&gt;X1&lt;/b&gt;");
    expect(fichaEvidencia({ ...({} as any), codigo: "EV-1", tipo: "proyectil", hitCount: 0, ubicacion: null })).toContain("Sin ubicación asignada");
    expect(paginaFichas("Fichas", [], "hoy")).toContain("0 ficha(s)");
  });

  it("búsqueda: normaliza la serie como serie_normalizada", () => {
    expect(normalizarBusqueda("  ab-12 34 ")).toEqual({ texto: "ab-12 34", serie: "AB1234" });
  });
});
