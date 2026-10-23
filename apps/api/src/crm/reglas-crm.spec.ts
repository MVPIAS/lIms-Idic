import { etapaPorCotizacion, oportunidadEnAlcance, siguienteCodigoOportunidad } from "./reglas-crm";

describe("CRM · oportunidades (EP-00 0.3)", () => {
  it("el código lleva el año en curso y reinicia el correlativo cada año", () => {
    expect(siguienteCodigoOportunidad(null, 2027)).toBe("OPP-2027-0001");
    expect(siguienteCodigoOportunidad("OPP-2027-0041", 2027)).toBe("OPP-2027-0042");
    expect(siguienteCodigoOportunidad("OPP-2026-0041", 2027)).toBe("OPP-2027-0001");
  });
  it("alcance: global, Comercial (DCO) ve todas; un laboratorio solo las suyas", () => {
    expect(oportunidadEnAlcance(null, null, "dco")).toBe(true);
    expect(oportunidadEnAlcance(["dco"], "lqc", "dco")).toBe(true);
    expect(oportunidadEnAlcance(["lqc"], "lqc", "dco")).toBe(true);
    expect(oportunidadEnAlcance(["lqc"], "lpn", "dco")).toBe(false);
    expect(oportunidadEnAlcance(["lqc"], null, "dco")).toBe(false);
  });
  it("la cotización enlazada mueve la etapa: propuesta al crearla, ganada al aceptarla", () => {
    expect(etapaPorCotizacion("creada")).toEqual({ etapa: "propuesta", estado: "viva" });
    expect(etapaPorCotizacion("aceptada")).toEqual({ etapa: "ganada", estado: "ganada" });
  });
});
