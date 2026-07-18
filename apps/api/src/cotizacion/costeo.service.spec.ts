/**
 * Tests del costeo comercial del Ejército (`costeo.service.ts`).
 *
 * Lógica PURA (sin BD): CDT → CFA → CT → los tres precios, tasa de internación
 * del 1,5% con su IVA, redondeos y casos borde. Es el número que va en la
 * oferta al cliente: un error aquí es dinero. Alta prioridad para acreditación.
 */
import { CosteoService, LineaCosto } from "./costeo.service";

describe("CosteoService.calcular · flujo CDT → CFA → CT", () => {
  const svc = new CosteoService();

  it("suma el Costo Directo Total por líneas (cantidad × valorUnitario)", () => {
    const lineas: LineaCosto[] = [
      { tipo: "viatico", cantidad: 3, valorUnitario: 40_000 }, // 120.000
      { tipo: "hora_hombre_civil", cantidad: 10, valorUnitario: 8_000 }, // 80.000
      { tipo: "pasaje", cantidad: 2, valorUnitario: 50_000 }, // 100.000
    ];
    const r = svc.calcular(lineas);
    expect(r.cdt).toBe(300_000);
    // Subtotales por tipo.
    expect(r.costoDirecto.viatico).toBe(120_000);
    expect(r.costoDirecto.hora_hombre_civil).toBe(80_000);
    expect(r.costoDirecto.pasaje).toBe(100_000);
  });

  it("acumula varias líneas del MISMO tipo en un solo subtotal", () => {
    const r = svc.calcular([
      { tipo: "insumo", cantidad: 1, valorUnitario: 1_000 },
      { tipo: "insumo", cantidad: 2, valorUnitario: 500 },
    ]);
    expect(r.costoDirecto.insumo).toBe(2_000);
    expect(r.cdt).toBe(2_000);
  });

  it("aplica el CFA por defecto (12%) sobre el CDT y calcula el CT", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 1_000_000 }]);
    expect(r.cfaPct).toBe(12);
    expect(r.cfa).toBe(120_000); // 12% de 1.000.000
    expect(r.ct).toBe(1_120_000); // CDT + CFA
  });

  it("acepta un CFA parametrizado distinto del 12% por defecto", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 1_000_000 }], {
      cfaPct: 20,
    });
    expect(r.cfa).toBe(200_000);
    expect(r.ct).toBe(1_200_000);
  });
});

describe("CosteoService.calcular · los tres precios", () => {
  const svc = new CosteoService();
  const lineas: LineaCosto[] = [{ tipo: "otros", cantidad: 1, valorUnitario: 1_000_000 }];

  it("Ejército e Institucional FFAA = Costo Total (sin margen)", () => {
    const r = svc.calcular(lineas);
    expect(r.precios.ejercito).toBe(r.ct);
    expect(r.precios.institucional).toBe(r.ct);
    expect(r.precios.ejercito).toBe(1_120_000);
  });

  it("Particular = Costo Total + margen comercial (20% por defecto)", () => {
    const r = svc.calcular(lineas);
    // 1.120.000 × 1,20 = 1.344.000
    expect(r.precios.particular).toBe(1_344_000);
    expect(r.margenParticularPct).toBe(20);
  });

  it("respeta un margen particular parametrizado", () => {
    const r = svc.calcular(lineas, { margenParticularPct: 35 });
    expect(r.precios.particular).toBe(Math.round(1_120_000 * 1.35));
    expect(r.margenParticularPct).toBe(35);
  });

  it("ejercitoSinCfa expone el neto = CDT (referencia interna)", () => {
    const r = svc.calcular(lineas);
    expect(r.precios.ejercitoSinCfa).toBe(1_000_000);
    expect(r.precios.ejercitoSinCfa).toBe(r.cdt);
  });
});

describe("CosteoService.calcular · redondeos", () => {
  const svc = new CosteoService();

  it("sin redondeo (default) redondea al entero más próximo (Math.round)", () => {
    // CDT 1.000.001 con CFA 12% = 120.000,12 → redondea a 120.000.
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 1_000_001 }]);
    expect(r.cfa).toBe(120_000); // 120000.12 → 120000
    expect(Number.isInteger(r.cfa)).toBe(true);
    expect(Number.isInteger(r.ct)).toBe(true);
  });

  it("redondea al múltiplo de N CLP indicado (redondeoClp)", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 1_234_567 }], {
      redondeoClp: 1_000,
    });
    // Todos los importes deben ser múltiplos de 1.000.
    expect(r.cdt % 1_000).toBe(0);
    expect(r.cfa % 1_000).toBe(0);
    expect(r.ct % 1_000).toBe(0);
    expect(r.precios.particular % 1_000).toBe(0);
    expect(r.cdt).toBe(1_235_000); // 1.234.567 → 1.235.000
  });

  it("redondeoClp = 0 equivale a redondeo entero simple", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 1_500 }], {
      redondeoClp: 0,
    });
    expect(r.cdt).toBe(1_500);
  });
});

describe("CosteoService.calcular · casos borde", () => {
  const svc = new CosteoService();

  it("sin líneas: todo en cero, sin dividir por cero ni NaN", () => {
    const r = svc.calcular([]);
    expect(r.cdt).toBe(0);
    expect(r.cfa).toBe(0);
    expect(r.ct).toBe(0);
    expect(r.precios.ejercito).toBe(0);
    expect(r.precios.particular).toBe(0);
    expect(Object.keys(r.costoDirecto)).toHaveLength(0);
    expect(Number.isNaN(r.ct)).toBe(false);
  });

  it("línea con cantidad 0 aporta 0 pero registra el tipo", () => {
    const r = svc.calcular([{ tipo: "viatico", cantidad: 0, valorUnitario: 40_000 }]);
    expect(r.costoDirecto.viatico).toBe(0);
    expect(r.cdt).toBe(0);
  });

  it("cantidad/valorUnitario NaN o undefined se tratan como 0 (|| 0)", () => {
    const r = svc.calcular([
      { tipo: "otros", cantidad: NaN as unknown as number, valorUnitario: 100 },
      { tipo: "otros", cantidad: 5, valorUnitario: undefined as unknown as number },
    ]);
    expect(r.costoDirecto.otros).toBe(0);
    expect(Number.isNaN(r.cdt)).toBe(false);
  });

  it("cfaPct 0 → CFA 0 y CT = CDT", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 500_000 }], {
      cfaPct: 0,
    });
    expect(r.cfa).toBe(0);
    expect(r.ct).toBe(500_000);
  });

  it("margenParticularPct 0 → Particular = Costo Total", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1, valorUnitario: 500_000 }], {
      margenParticularPct: 0,
    });
    expect(r.precios.particular).toBe(r.ct);
  });

  it("valores grandes: no hay overflow ni pérdida de enteros seguros", () => {
    const r = svc.calcular([{ tipo: "otros", cantidad: 1_000, valorUnitario: 1_000_000 }]); // 1e9
    expect(r.cdt).toBe(1_000_000_000);
    expect(r.ct).toBe(1_120_000_000);
    expect(r.ct).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("CosteoService.tasaInternacion · 1,5% + IVA", () => {
  const svc = new CosteoService();

  it("convierte CIF a CLP y aplica 1,5% + IVA 19% por defecto", () => {
    // CIF 10.000 USD, paridad 950 → CIF CLP 9.500.000
    const r = svc.tasaInternacion(10_000, 950);
    expect(r.divisa).toBe("USD");
    expect(r.cifClp).toBe(9_500_000);
    expect(r.tasaPct).toBe(1.5);
    expect(r.tasa).toBe(142_500); // 1,5% de 9.500.000
    expect(r.ivaPct).toBe(19);
    expect(r.iva).toBe(27_075); // 19% de 142.500
    expect(r.total).toBe(169_575); // tasa + IVA
  });

  it("acepta divisa, tasa e IVA parametrizados", () => {
    const r = svc.tasaInternacion(1_000, 1_000, { divisa: "EUR", tasaPct: 2, ivaPct: 0 });
    expect(r.divisa).toBe("EUR");
    expect(r.cifClp).toBe(1_000_000);
    expect(r.tasa).toBe(20_000); // 2%
    expect(r.iva).toBe(0);
    expect(r.total).toBe(20_000);
  });

  it("CIF 0 → tasa, IVA y total 0", () => {
    const r = svc.tasaInternacion(0, 950);
    expect(r.tasa).toBe(0);
    expect(r.iva).toBe(0);
    expect(r.total).toBe(0);
  });

  it("redondea los importes monetarios al entero (Math.round)", () => {
    // Fuerza decimales: 333,33 × 1,5% = 5,0 aprox; comprobamos que salen enteros.
    const r = svc.tasaInternacion(333.33, 3);
    expect(Number.isInteger(r.cifClp)).toBe(true);
    expect(Number.isInteger(r.tasa)).toBe(true);
    expect(Number.isInteger(r.iva)).toBe(true);
    expect(Number.isInteger(r.total)).toBe(true);
  });

  it("preserva los datos de entrada en el desglose (cifDivisa, paridad)", () => {
    const r = svc.tasaInternacion(500, 900);
    expect(r.cifDivisa).toBe(500);
    expect(r.paridad).toBe(900);
  });
});
