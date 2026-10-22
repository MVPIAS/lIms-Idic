import { configSegregacion, decidirAccionResultado, motivoMismoRevisor, type LabDeResultado } from "./alcance-resultado";

const LQA = "u-lqa", LMB = "u-lmb";
const propio: LabDeResultado = { unidadId: LQA, principalId: LQA, derivado: false, ordenInternaId: null, oiNumero: null, oiEstado: null, unidadCodigo: "LQA" };
const derivado = (estado: string): LabDeResultado => ({
  unidadId: LMB, principalId: LQA, derivado: true, ordenInternaId: "oi", oiNumero: "OI-2026-0001", oiEstado: estado, unidadCodigo: "LMB",
});
const ve = (...us: string[]) => (u: string | null) => !!u && us.includes(u);

describe("alcance por ensayo dentro de la OT (D02-02, D02-04)", () => {
  it("un ensayo propio de la OT lo trabaja el laboratorio responsable; otro laboratorio, 403", () => {
    expect(decidirAccionResultado(propio, "capturar", ve(LQA)).permitido).toBe(true);
    const d = decidirAccionResultado(propio, "aprobar", ve(LMB));
    expect(d).toMatchObject({ permitido: false, status: 403 });
  });

  it("el destino captura, revisa y aprueba sus derivados mientras la orden está recibida", () => {
    for (const a of ["capturar", "revisar", "aprobar"] as const)
      expect(decidirAccionResultado(derivado("recibida"), a, ve(LMB)).permitido).toBe(true);
  });

  it("el responsable de la OT ve los derivados pero no los captura ni aprueba (solo lectura)", () => {
    expect(decidirAccionResultado(derivado("recibida"), "ver", ve(LQA)).permitido).toBe(true);
    const d = decidirAccionResultado(derivado("recibida"), "aprobar", ve(LQA));
    expect(d).toMatchObject({ permitido: false, status: 403 });
    expect(d.motivo).toMatch(/LMB.*solo lectura/);
  });

  it("antes de recibir o tras cerrar la orden, el destino no trabaja el ensayo (409); reabrir sí con la orden cerrada", () => {
    expect(decidirAccionResultado(derivado("abierta"), "capturar", ve(LMB))).toMatchObject({ permitido: false, status: 409 });
    expect(decidirAccionResultado(derivado("cerrada"), "aprobar", ve(LMB)).motivo).toMatch(/cerrada/);
    expect(decidirAccionResultado(derivado("cerrada"), "reabrir", ve(LMB)).permitido).toBe(true);
  });

  it("un laboratorio ajeno a la OT y a la orden no ve el ensayo", () => {
    expect(decidirAccionResultado(derivado("recibida"), "ver", ve("u-les")).permitido).toBe(false);
  });
});

describe("revisión y aprobación por personas distintas (D06-05)", () => {
  const cfg = configSegregacion("distintas", "");
  it("quien revisó no aprueba", () => {
    expect(motivoMismoRevisor({ revisadoPor: "u1" }, "u1", cfg, "SSTGO")).toMatch(/otra persona/);
    expect(motivoMismoRevisor({ revisadoPor: "u1" }, "u2", cfg, "SSTGO")).toBeNull();
  });
  it("configurable: excepción por laboratorio o desactivada", () => {
    expect(motivoMismoRevisor({ revisadoPor: "u1" }, "u1", configSegregacion("distintas", "LMT, lnf"), "LNF")).toBeNull();
    expect(motivoMismoRevisor({ revisadoPor: "u1" }, "u1", configSegregacion("misma_persona", ""), "LQA")).toBeNull();
    expect(configSegregacion(null, null)).toEqual({ modo: "distintas", excepciones: [] });
  });
});
