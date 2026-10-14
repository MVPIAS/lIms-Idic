import { diasParaVencer, estaVencida, fechaLegible, hoyEnChile, soloFecha } from "./validez";
import { mensajeVencida, puedeRegistrarAceptacion } from "./permisos-cotizacion";

describe("Vencimiento de la cotización", () => {
  it("el último día de validez todavía se puede aceptar (inclusive)", () => {
    expect(estaVencida("2026-10-14", soloFecha("2026-10-14"))).toBe(false);
  });

  it("al día siguiente queda vencida", () => {
    expect(estaVencida("2026-10-14", soloFecha("2026-10-15"))).toBe(true);
  });

  it("sin fecha de validez no vence", () => {
    expect(estaVencida(null, soloFecha("2030-01-01"))).toBe(false);
    expect(estaVencida(undefined, soloFecha("2030-01-01"))).toBe(false);
  });

  it("«hoy» es la fecha de Chile, no la del servidor en UTC", () => {
    // 15-oct 01:30 UTC = 14-oct 22:30 en Santiago (UTC-3 en octubre).
    expect(hoyEnChile(new Date("2026-10-15T01:30:00Z")).toISOString().slice(0, 10)).toBe("2026-10-14");
    // Con validez hasta el 14-oct, a esa hora aún NO está vencida.
    expect(estaVencida("2026-10-14", hoyEnChile(new Date("2026-10-15T01:30:00Z")))).toBe(false);
    expect(estaVencida("2026-10-14", hoyEnChile(new Date("2026-10-15T04:00:00Z")))).toBe(true);
  });

  it("días para vencer", () => {
    expect(diasParaVencer("2026-10-21", soloFecha("2026-10-14"))).toBe(7);
    expect(diasParaVencer("2026-10-14", soloFecha("2026-10-14"))).toBe(0);
    expect(diasParaVencer("2026-10-10", soloFecha("2026-10-14"))).toBe(-4);
  });

  it("mensaje claro al intentar aceptar una vencida", () => {
    const m = mensajeVencida("COT-2026-0007", "2026-09-30");
    expect(m).toContain("COT-2026-0007");
    expect(m).toContain(fechaLegible("2026-09-30"));
    expect(m).toMatch(/nueva cotización/);
  });

  it("solo se registra aceptación de Abierta (o 'enviada' histórica) dentro de validez", () => {
    const hoy = soloFecha("2026-10-14");
    expect(puedeRegistrarAceptacion({ estado: "abierta", validaHasta: "2026-10-14" }, hoy)).toEqual({ ok: true });
    const r = puedeRegistrarAceptacion({ estado: "abierta", validaHasta: "2026-10-13", codigo: "COT-1" }, hoy);
    expect(r.ok).toBe(false);
    expect((r as any).vencida).toBe(true);
    expect(puedeRegistrarAceptacion({ estado: "expirada", validaHasta: "2026-10-01", codigo: "COT-2" }, hoy).ok).toBe(false);
    expect(puedeRegistrarAceptacion({ estado: "enviada", expiraAt: "2026-10-01" }, hoy).ok).toBe(false);
    expect(puedeRegistrarAceptacion({ estado: "enviada", expiraAt: null }, hoy)).toEqual({ ok: true });
    // Otras transiciones las sigue validando common/estados.ts.
    expect(puedeRegistrarAceptacion({ estado: "anulada" }, hoy)).toEqual({ ok: true });
  });
});
