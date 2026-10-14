import { cuentaBloqueada, motivoBloqueo } from "./bloqueo";

describe("cuentas bloqueadas", () => {
  it("cuenta las bloqueadas por el administrador y por intentos fallidos", () => {
    expect(cuentaBloqueada({ estado: "bloqueado", intentosFallidos: 0 }, 5)).toBe(true);
    expect(cuentaBloqueada({ estado: "activo", intentosFallidos: 5 }, 5)).toBe(true);
    expect(cuentaBloqueada({ estado: "activo", intentosFallidos: 7 }, 5)).toBe(true);
  });

  it("no cuenta las activas por debajo del umbral ni las inactivas sin intentos", () => {
    expect(cuentaBloqueada({ estado: "activo", intentosFallidos: 4 }, 5)).toBe(false);
    expect(cuentaBloqueada({ estado: "inactivo", intentosFallidos: 0 }, 5)).toBe(false);
    expect(cuentaBloqueada({ estado: "activo", intentosFallidos: null }, 5)).toBe(false);
  });

  it("explica el motivo", () => {
    expect(motivoBloqueo({ estado: "bloqueado" }, 5)).toMatch(/administrador/);
    expect(motivoBloqueo({ estado: "activo", intentosFallidos: 6 }, 5)).toMatch(/6 intentos fallidos/);
    expect(motivoBloqueo({ estado: "activo", intentosFallidos: 1 }, 5)).toBeNull();
  });
});
