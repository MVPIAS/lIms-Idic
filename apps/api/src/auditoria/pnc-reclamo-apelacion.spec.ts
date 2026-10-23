import { ensayosAReejecutar, erroresPnc, modoDevolucion } from "./no-conformidad.reglas";
import { estadoReclamo } from "./reclamo.controller";
import { plazoApelacion, siguienteCodigoApelacion, sumarDiasHabiles } from "./apelacion.controller";

describe("PNC/TNC IDIC-PG12 (BL-165)", () => {
  it("una NC general no lleva acción; un PNC exige OT o calibración y su acción", () => {
    expect(erroresPnc({ clase: "NC", accion: "reejecutar" })).toHaveLength(1);
    expect(erroresPnc({ clase: "PNC" })).toEqual(expect.arrayContaining([expect.stringMatching(/OT o una calibración/), expect.stringMatching(/acción/)]));
    expect(erroresPnc({ clase: "PNC", otId: "o", accion: "reejecutar" })).toEqual(["Para reejecutar, indique los ensayos afectados."]);
    expect(erroresPnc({ clase: "TNC", otId: "o", accion: "volver_elaboracion" })).toEqual(["«Volver a la elaboración» es para una calibración."]);
    expect(erroresPnc({ clase: "PNC", otId: "o", accion: "reejecutar", resultadoIds: ["r"], costoNoCalidad: 12000 })).toEqual([]);
  });
  it("reejecutar devuelve cada ensayo según su estado y sin repetir", () => {
    expect(ensayosAReejecutar({ resultadoIds: ["a", "b"], resultadoId: "a" })).toEqual(["a", "b"]);
    expect(modoDevolucion("aprobado")).toBe("reabrir");
    expect(modoDevolucion("revisado_n1")).toBe("devolver");
    expect(modoDevolucion("capturado")).toBe("devolver");
    expect(modoDevolucion("pendiente")).toBe("nada");
  });
});

describe("Reclamos (BL-219)", () => {
  it("abierto → respondido → cerrado", () => {
    expect(estadoReclamo({ estado: "abierta" })).toBe("abierto");
    expect(estadoReclamo({ estado: "abierta", respuesta: "Se reemitió el informe" })).toBe("respondido");
    expect(estadoReclamo({ estado: "cerrada", respuesta: "x" })).toBe("cerrado");
  });
});

describe("Apelación del Informe de Rechazo (BL-166)", () => {
  it("5 días hábiles desde la recepción, sin sábados ni domingos", () => {
    // viernes 23-10-2026 + 5 hábiles = viernes 30-10-2026
    expect(sumarDiasHabiles("2026-10-23", 5)).toBe("2026-10-30");
    expect(plazoApelacion("2026-10-23", "2026-10-30", 5)).toEqual({ venceEl: "2026-10-30", fueraDePlazo: false });
    expect(plazoApelacion("2026-10-23", "2026-11-02", 5).fueraDePlazo).toBe(true);
  });
  it("código APE-AAAA-NNNN por año", () => {
    expect(siguienteCodigoApelacion(null, 2026)).toBe("APE-2026-0001");
    expect(siguienteCodigoApelacion("APE-2026-0009", 2026)).toBe("APE-2026-0010");
    expect(siguienteCodigoApelacion("APE-2025-0009", 2026)).toBe("APE-2026-0001");
  });
});
