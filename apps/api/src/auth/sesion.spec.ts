import { INACTIVIDAD_DEFECTO, minutosInactividad } from "./sesion";

describe("sesión · minutos de inactividad (§4.7.6)", () => {
  it("usa el valor guardado si es válido", () => {
    expect(minutosInactividad({ valor: "45" })).toBe(45);
    expect(minutosInactividad({ valor: " 2 ", activo: true })).toBe(2);
    expect(minutosInactividad({ valor: "480" })).toBe(480);
  });
  it("vuelve a 20 sin fila, inactiva, fuera de rango o con texto", () => {
    for (const f of [null, undefined, { valor: null }, { valor: "1" }, { valor: "481" }, { valor: "15,5" }, { valor: "x" }, { valor: "30", activo: false }])
      expect(minutosInactividad(f as any)).toBe(INACTIVIDAD_DEFECTO);
  });
});
