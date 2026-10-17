import { accionesDisponibles, codigoCalibracion, estadoDe, fechaCalibracion, motivoRechazo, plantillaVacia, type ContextoCal } from "./metrologia.flujo";

const ctx = (o: Partial<ContextoCal> = {}): ContextoCal => ({
  estado: "borrador", esAutor: true, puedeCrear: true, puedeEmitir: false, calculada: true, ...o,
});

describe("Circuito del certificado de calibración", () => {
  it("el metrólogo autor edita y envía su borrador, pero no lo emite", () => {
    expect(accionesDisponibles(ctx())).toEqual(["EDITAR", "ENVIAR"]);
    expect(motivoRechazo("EMITIR", ctx())).toMatch(/enviada a revisión/);
  });

  it("otro metrólogo no edita ni envía un borrador ajeno", () => {
    expect(accionesDisponibles(ctx({ esAutor: false }))).toEqual([]);
    expect(motivoRechazo("ENVIAR", ctx({ esAutor: false }))).toMatch(/Solo quien elaboró/);
  });

  it("el jefe (otra persona, con metrologia.emitir) emite o devuelve lo enviado", () => {
    const c = ctx({ estado: "en_revision", esAutor: false, puedeCrear: true, puedeEmitir: true });
    expect(accionesDisponibles(c)).toEqual(["DEVOLVER", "EMITIR"]);
  });

  it("quien elaboró la calibración puede emitirla si tiene metrologia.emitir", () => {
    const c = ctx({ estado: "en_revision", esAutor: true, puedeEmitir: true });
    expect(motivoRechazo("EMITIR", c)).toBeNull();
    expect(motivoRechazo("DEVOLVER", c)).toBeNull();
    expect(accionesDisponibles(c)).toEqual(["DEVOLVER", "EMITIR"]);
  });

  it("sin metrologia.emitir no se emite", () => {
    expect(motivoRechazo("EMITIR", ctx({ estado: "en_revision", esAutor: false }))).toMatch(/no le corresponde/i);
  });

  it("en revisión no se edita; emitida solo admite la reemisión", () => {
    expect(motivoRechazo("EDITAR", ctx({ estado: "en_revision" }))).toMatch(/borrador/);
    const e = ctx({ estado: "emitida", esAutor: false, puedeEmitir: true });
    expect(accionesDisponibles(e)).toEqual(["REEMITIR"]);
    expect(motivoRechazo("EMITIR", e)).toMatch(/ya fue emitida/);
  });

  it("sin resultado calculado no se envía ni se emite", () => {
    expect(motivoRechazo("ENVIAR", ctx({ calculada: false }))).toMatch(/resultado/);
    expect(motivoRechazo("EMITIR", ctx({ estado: "en_revision", esAutor: false, puedeEmitir: true, calculada: false }))).toMatch(/resultado/);
  });

  it("el estado antiguo «calculada» se trata como borrador", () => {
    expect(estadoDe("calculada")).toBe("borrador");
    expect(accionesDisponibles(ctx({ estado: "calculada" }))).toContain("ENVIAR");
  });
});

describe("Código de la calibración", () => {
  it("el año sale de la fecha de calibración, no está fijo", () => {
    expect(codigoCalibracion("2027-01-05", 7)).toBe("CAL-2027-0007");
    expect(codigoCalibracion("2025-12-31", 123)).toBe("CAL-2025-0123");
  });
  it("fecha válida se respeta; vacía o inválida = hoy en Chile", () => {
    expect(fechaCalibracion("2026-03-24")).toBe("2026-03-24");
    expect(fechaCalibracion(null, new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
    expect(fechaCalibracion("24-03-2026", new Date("2026-06-01T15:00:00Z"))).toBe("2026-06-01");
  });
});

describe("Formulario vacío", () => {
  it("conserva la forma del caso y no deja ningún valor de ejemplo", () => {
    expect(plantillaVacia({ res: 0.1, comp: "20 mg E2", pts: [{ nom: 1, s: [1, 2, null] }], ok: true }))
      .toEqual({ res: null, comp: "", pts: [{ nom: null, s: [null, null, null] }], ok: true });
  });
});
