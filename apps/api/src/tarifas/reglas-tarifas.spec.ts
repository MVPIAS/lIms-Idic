/**
 * Frente f5 · tarifas HH, HM, perfiles HH y servicios primarios: lo que se
 * acepta al crear y editar, y la vigencia.
 */
import { erroresVigencia, esquemasTarifa } from "./reglas-tarifas";

describe("tarifas · vigencia", () => {
  it("exige inicio y que el fin no sea anterior", () => {
    expect(erroresVigencia("2026-01-01", null)).toEqual([]);
    expect(erroresVigencia("2026-01-01", "2026-01-01")).toEqual([]);
    expect(erroresVigencia(new Date("2026-01-01T00:00:00Z"), "2026-12-31")).toEqual([]);
    expect(erroresVigencia(null, "2026-12-31")[0]).toMatch(/fecha de inicio/);
    expect(erroresVigencia("2026-06-01", "2026-01-01")[0]).toMatch(/termina .* antes de empezar/);
  });
});

describe("tarifas · HH por categoría", () => {
  it("alta: categoría en mayúsculas, valor ≥ 0, fechas a Date y activa por defecto", () => {
    const d: any = esquemasTarifa.hh.crear.parse({ categoria: " a ", valorHoraClp: "25000", vigenteDesde: "2026-01-01" });
    expect(d.categoria).toBe("A");
    expect(d.valorHoraClp).toBe(25000);
    expect(d.vigenteDesde).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(d.activo).toBe(true);
  });
  it("rechaza valor negativo, sin categoría y fin antes del inicio", () => {
    expect(esquemasTarifa.hh.crear.safeParse({ categoria: "A", valorHoraClp: -1, vigenteDesde: "2026-01-01" }).success).toBe(false);
    expect(esquemasTarifa.hh.crear.safeParse({ categoria: "", valorHoraClp: 1, vigenteDesde: "2026-01-01" }).success).toBe(false);
    expect(esquemasTarifa.hh.crear.safeParse({ categoria: "A", valorHoraClp: 1, vigenteDesde: "2026-06-01", vigenteHasta: "2026-01-01" }).success).toBe(false);
  });
  it("edición parcial: desactivar con «no» sin tocar lo demás", () => {
    const d: any = esquemasTarifa.hh.editar.parse({ activo: "no" });
    expect(d).toEqual({ activo: false });
  });
});

describe("tarifas · HM por equipo", () => {
  it("pide el código EQ### o el equipo", () => {
    expect(esquemasTarifa.hm.crear.safeParse({ valorHoraClp: 1000, vigenteDesde: "2026-01-01" }).success).toBe(false);
    const d: any = esquemasTarifa.hm.crear.parse({ codigo: "eq101", valorHoraClp: 1000, vigenteDesde: "2026-01-01", equipoId: "" });
    expect(d.codigo).toBe("EQ101");
    expect(d.equipoId).toBeNull();
  });
});

describe("tarifas · servicios primarios y perfiles HH", () => {
  it("servicio primario: precio opcional y ≥ 0", () => {
    expect(esquemasTarifa.servicioPrimario.crear.safeParse({ codigo: "SP-1", vigenteDesde: "2026-01-01" }).success).toBe(true);
    expect(esquemasTarifa.servicioPrimario.crear.safeParse({ codigo: "SP-1", precioClp: -5, vigenteDesde: "2026-01-01" }).success).toBe(false);
  });
  it("perfil: ajuste entre −100 % y 1000 %", () => {
    expect(esquemasTarifa.perfil.crear.parse({ perfil: "militar", ajustePct: "15" })).toMatchObject({ perfil: "militar", ajustePct: 15, activo: true });
    expect(esquemasTarifa.perfil.crear.safeParse({ perfil: "civil", ajustePct: -150 }).success).toBe(false);
  });
});
