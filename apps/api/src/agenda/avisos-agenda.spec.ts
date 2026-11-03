import { cambioRelevante, describirEvento, destinatariosCambio, type DatosAviso } from "./avisos-agenda";

const base: DatosAviso = { titulo: "Reunión PRUEBA", fecha: "2026-11-05", todoDia: false, horaInicio: "09:00", horaFin: "10:00", lugar: "Sala 1", recurrencia: "NINGUNA", recursos: ["r1"] };

describe("agenda · avisos a participantes (§4.5.9)", () => {
  it("describe el evento en el aviso", () => {
    expect(describirEvento(base)).toBe("«Reunión PRUEBA» el 2026-11-05 de 09:00 a 10:00 en Sala 1");
    expect(describirEvento({ ...base, todoDia: true, lugar: null, recurrencia: "SEMANAL" })).toBe("«Reunión PRUEBA» el 2026-11-05 (día completo) (se repite)");
  });

  it("al crear: todos los participantes menos quien crea", () => {
    expect(destinatariosCambio({ antes: [], despues: ["a", "b", "org"], organizadorId: "org", actorId: "org" })).toEqual({ invitados: ["a", "b"], quitados: [], siguen: [] });
  });

  it("al editar: invitados nuevos, quitados y los que siguen (con el organizador si edita otro)", () => {
    const r = destinatariosCambio({ antes: ["a", "b"], despues: ["b", "c"], organizadorId: "org", actorId: "gestor" });
    expect(r.invitados).toEqual(["c"]);
    expect(r.quitados).toEqual(["a"]);
    expect(r.siguen.sort()).toEqual(["b", "org"]);
  });

  it("quien hace el cambio no se avisa a sí mismo", () => {
    const r = destinatariosCambio({ antes: ["a"], despues: ["a", "yo"], organizadorId: "yo", actorId: "yo" });
    expect(r).toEqual({ invitados: [], quitados: [], siguen: ["a"] });
  });

  it("solo los cambios de cuándo, dónde, qué o recursos merecen aviso", () => {
    expect(cambioRelevante(base, { ...base })).toBe(false);
    expect(cambioRelevante(base, { ...base, horaInicio: "09:00:00" })).toBe(false);
    expect(cambioRelevante(base, { ...base, fecha: "2026-11-06" })).toBe(true);
    expect(cambioRelevante(base, { ...base, horaFin: "11:00" })).toBe(true);
    expect(cambioRelevante(base, { ...base, lugar: "Sala 2" })).toBe(true);
    expect(cambioRelevante(base, { ...base, recursos: ["r2"] })).toBe(true);
    expect(cambioRelevante({ ...base, recursos: ["r1", "r2"] }, { ...base, recursos: ["r2", "r1"] })).toBe(false);
  });
});
