import { calcularTasa, CENTROS_REPARTO_TASA, erroresReparto, erroresTasa, repartirTasa, REPARTO_TASA_POR_DEFECTO } from "./reglas-bpch";
import { defPorcentaje, erroresPorcentaje } from "../../catalogo/parametro-porcentaje";

/**
 * Tasa de internación con la fórmula del IDIC (cuarto envío 17-11-2026, COM-03).
 * Números INVENTADOS (PRUEBA). La fórmula se cuadró además con una Comunicación
 * Breve real del DCO, cuyos datos no van al repositorio (ver reglas-bpch.ts).
 */
describe("Tasa de internación · fórmula del IDIC (COM-03)", () => {
  const base = { cifUsd: 10_000, paridad: 950, pctAfecto: 100, tasaPct: 1.5 };

  it("base = CIF $ + ad valorem $ + flete + (factura agencia − IVA de internación) + otros gastos; tasa = base afecta × 1,5 %", () => {
    const r = calcularTasa({
      ...base,
      adValoremUsd: 200, // B · en US$, con la misma paridad (planilla: C11 × tipo de cambio)
      fleteNacional: 1_190_000, // D · IVA incluido
      agenciaTotalFactura: 3_000_000, // C · monto de la operación de la agencia
      agenciaIvaInternacion: 1_805_000, // IVA de internación pagado por cuenta del cliente: NO entra
      otrosGastosCliente: 50_000, // C · bodega fuera de la factura de la agencia
    });
    expect(r.cifClp).toBe(9_500_000);
    expect(r.adValoremClp).toBe(190_000);
    expect(r.agenciaNeto).toBe(1_195_000);
    expect(r.baseCalculo).toBe(9_500_000 + 190_000 + 1_190_000 + 1_195_000 + 50_000);
    expect(r.baseAfecta).toBe(12_125_000);
    expect(r.tasa).toBe(181_875);
    // Exenta de IVA: total a cancelar = tasa.
    expect(r.iva).toBe(0);
    expect(r.total).toBe(181_875);
  });

  it("sin conceptos adicionales da lo mismo que la fórmula anterior (cálculos antiguos válidos)", () => {
    const r = calcularTasa(base);
    expect(r.baseCalculo).toBe(9_500_000);
    expect(r.tasa).toBe(142_500);
    expect(r.adValoremClp + r.fleteNacional + r.agenciaNeto + r.otrosGastosCliente).toBe(0);
  });

  it("aplica el % afecto a toda la base y redondea al peso sin error de coma flotante", () => {
    const r = calcularTasa({ ...base, pctAfecto: 50, fleteNacional: 1_001 });
    expect(r.baseAfecta).toBe(Math.round(9_501_001 / 2));
    // 9.501.001 × 50 % × 1,5 % = 71.257,5075 → 71.258
    expect(r.tasa).toBe(71_258);
    // Mitad exacta: 100 × 1,5 % = 1,5 → 2 (mitad hacia arriba)
    expect(calcularTasa({ cifUsd: 100, paridad: 1, pctAfecto: 100, tasaPct: 1.5 }).tasa).toBe(2);
  });

  it("valida montos negativos y el IVA de internación frente a la factura de la agencia", () => {
    expect(erroresTasa({ ...base, fleteNacional: -1 })[0]).toMatch(/flete nacional/);
    expect(erroresTasa({ ...base, agenciaIvaInternacion: 10 })[0]).toMatch(/total de la factura de la agencia/);
    expect(erroresTasa({ ...base, agenciaTotalFactura: 100, agenciaIvaInternacion: 101 })[0]).toMatch(/no puede ser mayor/);
    expect(erroresTasa({ ...base, agenciaTotalFactura: 100, agenciaIvaInternacion: 100, adValoremUsd: 0, otrosGastosCliente: null })).toEqual([]);
  });
});

describe("Tasa de internación · reparto por centro de costo", () => {
  it("85 / 10 / 5: las partes suman exactamente la tasa; el DTCG absorbe lo que deja el truncado", () => {
    const r = repartirTasa(181_875, REPARTO_TASA_POR_DEFECTO);
    expect(r.map((p) => [p.codigo, p.monto])).toEqual([
      ["sucursal", 154_593], // 154.593,75
      ["dtcg", 18_189], // 18.187,5 + 2
      ["sdbpch", 9_093], // 9.093,75
    ]);
    expect(r.reduce((s, p) => s + p.monto, 0)).toBe(181_875);
  });

  it("cuadra con cualquier tasa y con porcentajes con decimales", () => {
    for (const t of [0, 1, 7, 99, 100_001, 3_333_333]) {
      const r = repartirTasa(t, { sucursal: 33.3333, dtcg: 33.3333, sdbpch: 33.3334 });
      expect(r.reduce((s, p) => s + p.monto, 0)).toBe(t);
      expect(r.every((p) => p.monto >= 0)).toBe(true);
    }
  });

  it("el reparto debe sumar 100 % y cada parte estar entre 0 y 100", () => {
    expect(erroresReparto(REPARTO_TASA_POR_DEFECTO)).toEqual([]);
    expect(erroresReparto({ sucursal: 100, dtcg: 0, sdbpch: 0 })).toEqual([]);
    expect(erroresReparto({ sucursal: 85, dtcg: 10, sdbpch: 4 })[0]).toMatch(/sumar 100 %.*99 %/);
    expect(erroresReparto({ sucursal: 85, dtcg: null, sdbpch: 5 })[0]).toMatch(/DTCG/);
  });
});

describe("Tasa de internación · parámetros del reparto", () => {
  it("cada % del reparto es un porcentaje con historial (bpch_tasa) que admite 0", () => {
    for (const c of CENTROS_REPARTO_TASA) {
      const def = defPorcentaje("bpch_tasa", c.parametro);
      expect(def).not.toBeNull();
      expect(erroresPorcentaje(def!, 0, "Sin reparto a este centro")).toEqual([]);
    }
  });
});
