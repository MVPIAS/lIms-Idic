import { CONFIG_MORA_DEFECTO, configMora, diasMora, estadoMoraCliente, mensajeClienteBloqueado, motivoBloqueoMora, tramoDe, vencimientoFactura } from "./mora";

const cfg = CONFIG_MORA_DEFECTO;
const f = (id: string, venc: string, saldo = 1000, estado = "emitida") => ({ id, numero: `F-${id}`, estado, saldo, fechaVencimiento: venc });

describe("COM-05 · Bloqueo por mora (30 aviso · 60 bloqueo · 90 CDE)", () => {
  it("tramos por defecto y desde parámetros", () => {
    expect(configMora([])).toEqual({ activo: true, diasAviso: 30, diasBloqueo: 60, diasCde: 90 });
    expect(configMora([{ codigo: "dias_bloqueo", valor: "45" }]).diasBloqueo).toBe(45);
    // Tramos desordenados → los de por defecto.
    expect(configMora([{ codigo: "dias_aviso", valor: "70" }])).toMatchObject({ diasAviso: 30, diasBloqueo: 60 });
    expect(configMora([{ codigo: "activo", valor: "no" }]).activo).toBe(false);
  });

  it("vencimiento: el de la factura o la emisión + días de crédito del cliente", () => {
    expect(vencimientoFactura({ fechaVencimiento: "2026-09-01", fechaEmision: "2026-08-01" })).toBe("2026-09-01");
    expect(vencimientoFactura({ fechaEmision: "2026-08-01", diasCredito: 45 })).toBe("2026-09-15");
    expect(vencimientoFactura({ fechaEmision: new Date("2026-08-01T00:00:00Z") })).toBe("2026-08-31");
    expect(diasMora("2026-09-01", "2026-08-15")).toBe(0);
    expect(diasMora("2026-09-01", "2026-10-01")).toBe(30);
  });

  it("los cortes: 29 al día, 30 aviso, 60 bloqueo, 90 CDE", () => {
    expect(tramoDe(29, cfg)).toBe("al_dia");
    expect(tramoDe(30, cfg)).toBe("aviso");
    expect(tramoDe(60, cfg)).toBe("bloqueo");
    expect(tramoDe(90, cfg)).toBe("cde");
  });

  it("bloquea con una factura con saldo en el tramo de bloqueo; las pagadas o pendientes no cuentan", () => {
    const hoy = "2026-11-17";
    const e = estadoMoraCliente([f("a", "2026-10-10"), f("b", "2026-09-10"), f("c", "2026-01-01", 0), f("d", "2026-01-01", 500, "pendiente")], hoy, cfg);
    expect(e.tramo).toBe("bloqueo");
    expect(e.bloquear).toBe(true);
    expect(e.facturas.map((x) => x.id)).toEqual(["b", "a"]);
    expect(motivoBloqueoMora(e)).toMatch(/F-b lleva 68 días vencida/);
    // Solo aviso: no bloquea.
    expect(estadoMoraCliente([f("a", "2026-10-10")], hoy, cfg)).toMatchObject({ tramo: "aviso", bloquear: false });
    // 90 días: alerta CDE (y bloqueo).
    expect(estadoMoraCliente([f("a", "2026-08-10")], hoy, cfg)).toMatchObject({ tramo: "cde", bloquear: true });
  });

  it("la excepción del Jefe DCO cubre sus facturas; una factura nueva en mora vuelve a bloquear", () => {
    const hoy = "2026-11-17";
    expect(estadoMoraCliente([f("b", "2026-09-10")], hoy, cfg, ["b"]).bloquear).toBe(false);
    expect(estadoMoraCliente([f("b", "2026-09-10"), f("n", "2026-09-15")], hoy, cfg, ["b"]).bloquear).toBe(true);
  });

  it("con el bloqueo automático desactivado no bloquea", () => {
    expect(estadoMoraCliente([f("b", "2026-08-10")], "2026-11-17", { ...cfg, activo: false }).bloquear).toBe(false);
  });

  it("mensaje claro al cotizar o abrir una OT", () => {
    expect(mensajeClienteBloqueado("PRUEBA S.A.", "Bloqueo automático por mora")).toMatch(/no se le pueden crear cotizaciones ni OT/);
  });
});
