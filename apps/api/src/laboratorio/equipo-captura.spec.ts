import { condicionesEnsayo, equipoObligatorio, equipoUsable, equiposDelEnsayo, modoEquipo } from "./equipo-captura";

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

  it("equipo del laboratorio dueño del ensayo o común (sin unidad)", () => {
    expect(equipoUsable(null, "LME", ["LME"])).toBe(true);
    expect(equipoUsable("LME", "LME", [])).toBe(true);
    expect(equipoUsable("LQC", "LME", ["LME"])).toBe(false);
    // Aunque quien captura también sea de LQC, el ensayo es de LME: solo equipos de LME.
    expect(equipoUsable("LQC", "LME", ["LME", "LQC"])).toBe(false);
    expect(equipoUsable("LQC", "LME", null)).toBe(false);
    // Sin laboratorio dueño (OT sin laboratorio): los de quien captura.
    expect(equipoUsable("LQC", null, ["LQC"])).toBe(true);
    expect(equipoUsable("LQC", null, ["LME"])).toBe(false);
  });

  it("D02-28: el analista del LMB, en un ensayo derivado al LMB, no ve los equipos del LQA", () => {
    const eq = [
      { id: "balanza", unidadId: "LQA" },
      { id: "estufa", unidadId: "LQA" },
      { id: "incubadora", unidadId: "LMB" },
      { id: "termometro", unidadId: null },
    ];
    expect(equiposDelEnsayo(eq, "LMB", ["LMB"]).map((e) => e.id)).toEqual(["incubadora", "termometro"]);
    // El ensayo propio del LQA ofrece los del LQA y los comunes.
    expect(equiposDelEnsayo(eq, "LQA", null).map((e) => e.id)).toEqual(["balanza", "estufa", "termometro"]);
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
