import { alPeso, cuadraConFormula, desdeCostoDirecto, desdePrecioParticular, diferencias, PCT_OFICIAL_2026 } from "./estructura-precio";

describe("Estructura oficial del precio (lista IDIC 2026)", () => {
  it("EN1214: del costo directo 329.820 salen exactamente las cifras de la lista", () => {
    expect(desdeCostoDirecto(329_820)).toEqual({
      costoDirecto: 329_820,
      costoIndirecto: 65_964,
      costoTotal: 395_784,
      recargo: 118_735,
      neto: 514_519,
      iva: 97_759,
      precioIvaIncluido: 612_278,
    });
  });

  it("EN412: desde el precio particular 70.827 reproduce la fila completa (la lista se armó hacia atrás)", () => {
    expect(desdePrecioParticular(70_827)).toEqual({
      costoDirecto: 38_153,
      costoIndirecto: 7_631,
      costoTotal: 45_783,
      recargo: 13_735,
      neto: 59_518,
      iva: 11_309,
      precioIvaIncluido: 70_827,
    });
  });

  it("EN412 desde el costo directo entero: 1 peso de diferencia en CT y neto por los decimales ocultos", () => {
    const fila = desdePrecioParticular(70_827);
    expect(diferencias(fila, desdeCostoDirecto(38_153))).toEqual({ costoTotal: 1, neto: 1 });
  });

  it("cuadraConFormula acepta el redondeo al peso y rechaza una fila con un importe cambiado", () => {
    const fila = desdePrecioParticular(70_827);
    expect(cuadraConFormula(fila)).toBe(true);
    expect(cuadraConFormula({ ...fila, recargo: fila.recargo + 2 })).toBe(false);
    expect(cuadraConFormula({ ...fila, iva: Math.round(fila.neto * 0.18) })).toBe(false);
  });

  it("los porcentajes son parámetros (12 % / 20 % del costeo anterior)", () => {
    const e = desdeCostoDirecto(1_000_000, { ciPct: 12, recargoPct: 20, ivaPct: 19 });
    expect(e.costoTotal).toBe(1_120_000);
    expect(e.neto).toBe(1_344_000);
    expect(PCT_OFICIAL_2026).toEqual({ ciPct: 20, recargoPct: 30, ivaPct: 19 });
  });

  it("alPeso no se deja engañar por el ruido binario", () => {
    expect(alPeso(0.1 * 3 * 5)).toBe(2); // 1,5000000000000002
    expect(alPeso(2.4999999999)).toBe(3); // 2,5 tras limpiar el ruido
    expect(alPeso(1234.4)).toBe(1234);
  });
});
