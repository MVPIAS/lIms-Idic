import { puedeElegirCliente } from "./clientes-buscador.controller";

describe("B-014 · buscador acotado de clientes", () => {
  it("D11 (evidencia.crear) y Jefe de Sucursal (bpch.reinspeccion.gestionar) eligen cliente", () => {
    expect(puedeElegirCliente({ permisos: ["evidencia.crear"] })).toBe(true);
    expect(puedeElegirCliente({ permisos: ["bpch.reinspeccion.gestionar"] })).toBe(true);
    expect(puedeElegirCliente({ permisos: ["cliente.ver"] })).toBe(true);
  });
  it("un perfil sin ninguno de esos permisos, no", () => {
    expect(puedeElegirCliente({ permisos: ["resultado.crear", "ot.ver"] })).toBe(false);
    expect(puedeElegirCliente(undefined)).toBe(false);
    expect(puedeElegirCliente({ roles: ["SUPERADMIN"] })).toBe(true);
  });
});
