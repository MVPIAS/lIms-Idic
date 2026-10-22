import { erroresCierre, erroresSalida, mismoCalibre, saldo } from "./municion";

describe("EP-11 11.40 · munición de prueba", () => {
  it("el saldo suma entradas y devoluciones y resta entregas, usos y bajas", () => {
    expect(
      saldo([
        { tipo: "entrada", cantidad: 500 },
        { tipo: "entrega", cantidad: 100 },
        { tipo: "devolucion", cantidad: 20 },
        { tipo: "uso", cantidad: 12 },
        { tipo: "ajuste_baja", cantidad: 8 },
      ]),
    ).toBe(400);
    expect(saldo([])).toBe(0);
  });

  it("una salida no deja el lote en negativo ni sale de un lote dado de baja", () => {
    const l = { lote: "L-1", activo: true, saldo: 30 };
    expect(erroresSalida(l, 30)).toEqual([]);
    expect(erroresSalida(l, 31)[0]).toMatch(/tiene 30/);
    expect(erroresSalida(l, 0)[0]).toMatch(/mayor que cero/);
    expect(erroresSalida({ ...l, activo: false }, 1)[0]).toMatch(/de baja/);
  });

  it("el acta cuadra: entregados = usados + devueltos", () => {
    expect(erroresCierre(100, 80, 20)).toEqual([]);
    expect(erroresCierre(100, 80, 10)[0]).toMatch(/No cuadra: se entregaron 100/);
    expect(erroresCierre(100, -1, 101)[0]).toMatch(/usados/);
  });

  it("compara calibres sin espacios ni mayúsculas", () => {
    expect(mismoCalibre("9 x 19 mm", "9X19MM")).toBe(true);
    expect(mismoCalibre(".40 S&W", "9x19")).toBe(false);
  });
});
