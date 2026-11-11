import { evaluarMorosidad, motivoClienteBloqueado, puedeBloquearClientes } from "./bloqueo-cliente";

describe("bloqueo de clientes con facturas impagas (reunión 2)", () => {
  it("un cliente bloqueado no recibe cotizaciones ni aceptaciones", () => {
    expect(motivoClienteBloqueado({ bloqueado: false }, "cotizar")).toBeNull();
    const m = motivoClienteBloqueado({ bloqueado: true, razonSocial: "Cliente PRUEBA", motivoBloqueo: "Factura 12 impaga" }, "cotizar")!;
    expect(m).toMatch(/Cliente PRUEBA está bloqueado/);
    expect(m).toMatch(/no se le pueden emitir cotizaciones/);
    expect(m).toMatch(/Motivo: Factura 12 impaga\./);
    expect(motivoClienteBloqueado({ bloqueado: true }, "aceptar")).toMatch(/no se puede registrar la aceptación/);
  });

  it("solo la jefatura del Depto. Comercial (o SUPERADMIN) bloquea", () => {
    expect(puedeBloquearClientes({ superadmin: true, tienePermiso: false, esJefeDco: false })).toBe(true);
    expect(puedeBloquearClientes({ superadmin: false, tienePermiso: true, esJefeDco: true })).toBe(true);
    expect(puedeBloquearClientes({ superadmin: false, tienePermiso: true, esJefeDco: false })).toBe(false);
    expect(puedeBloquearClientes({ superadmin: false, tienePermiso: false, esJefeDco: true })).toBe(false);
  });

  it("morosidad: facturas impagas vencidas más allá de la gracia", () => {
    const f = [
      { fechaVencimiento: "2026-10-01", saldo: 100000, estado: "emitida" },
      { fechaVencimiento: "2026-11-05", saldo: 50000, estado: "aviso_1" },
      { fechaVencimiento: "2026-09-01", saldo: 0, estado: "parcial" },
      { fechaVencimiento: "2026-09-01", saldo: 900, estado: "pagada" },
      { fechaVencimiento: null, saldo: 900, estado: "emitida" },
    ];
    expect(evaluarMorosidad(f, "2026-11-11")).toEqual({ facturasVencidas: 2, montoVencido: 150000, diasMoraMax: 41, sugiereBloqueo: true });
    expect(evaluarMorosidad(f, "2026-11-11", 30)).toEqual({ facturasVencidas: 1, montoVencido: 100000, diasMoraMax: 41, sugiereBloqueo: true });
    expect(evaluarMorosidad([], "2026-11-11").sugiereBloqueo).toBe(false);
  });
});
