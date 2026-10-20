import { condicionesEnsayo, equipoObligatorio, equipoUsable, modoEquipo } from "./equipo-captura";

describe("Equipo usado en la captura (contrato §4.4.2)", () => {
  it("modo desde el parámetro; lo desconocido cae a «metodo»", () => {
    expect(modoEquipo("numerico")).toBe("numerico");
    expect(modoEquipo(" SIEMPRE ")).toBe("siempre");
    expect(modoEquipo("x")).toBe("metodo");
    expect(modoEquipo(null)).toBe("metodo");
  });

  it("obligatorio según el modo y el método", () => {
    expect(equipoObligatorio("metodo", false, "numerico")).toBe(false);
    expect(equipoObligatorio("metodo", true, "atributo")).toBe(true);
    expect(equipoObligatorio("numerico", false, "numerico")).toBe(true);
    expect(equipoObligatorio("numerico", false, "atributo")).toBe(false);
    expect(equipoObligatorio("siempre", false, "atributo")).toBe(true);
  });

  it("equipo del laboratorio de la OT, común o de los laboratorios de quien captura", () => {
    expect(equipoUsable(null, "LME", ["LME"])).toBe(true);
    expect(equipoUsable("LME", "LME", [])).toBe(true);
    expect(equipoUsable("LQC", "LME", ["LME"])).toBe(false);
    expect(equipoUsable("LQC", "LME", ["LME", "LQC"])).toBe(true);
    expect(equipoUsable("LQC", "LME", null)).toBe(true);
  });
});

describe("Condiciones del ensayo", () => {
  const ahora = new Date("2026-10-20T15:00:00Z");
  it("sin fecha, la de la captura; vacíos a null", () => {
    const r = condicionesEnsayo({ incertidumbre: "  " }, ahora);
    expect(r.errores).toEqual([]);
    expect(r.valor).toEqual({ fechaEnsayo: ahora, temperatura: null, humedad: null, incertidumbre: null });
  });
  it("fecha futura, humedad fuera de 0–100 y temperatura absurda se rechazan", () => {
    const r = condicionesEnsayo({ fechaEnsayo: "2026-10-21T10:00:00Z", humedad: 120, temperatura: 5000 }, ahora);
    expect(r.errores).toHaveLength(3);
  });
  it("acepta un ensayo de ayer con T y HR", () => {
    const r = condicionesEnsayo({ fechaEnsayo: "2026-10-19T09:30:00Z", temperatura: 21.5, humedad: 45, incertidumbre: "± 0,02 %" }, ahora);
    expect(r.errores).toEqual([]);
    expect(r.valor.fechaEnsayo.toISOString()).toBe("2026-10-19T09:30:00.000Z");
    expect(r.valor.incertidumbre).toBe("± 0,02 %");
  });
});
