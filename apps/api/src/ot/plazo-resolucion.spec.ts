import { diasVigencia, errorCambioPlazo, plazoAjustado, sumarDias, vigenciaHasta } from "./plazo-resolucion";
import { pestanasParaPerfil } from "./avance-ot";

describe("Plazo de la OT y vigencia de la resolución (R3)", () => {
  it("180 días por defecto; el parámetro manda si es válido", () => {
    expect(diasVigencia(null)).toBe(180);
    expect(diasVigencia("90")).toBe(90);
    expect(diasVigencia("0")).toBe(180);
    expect(diasVigencia("abc")).toBe(180);
  });
  it("vigencia = fecha de la resolución + días", () => {
    expect(vigenciaHasta("2026-11-01", 180)).toBe("2027-04-30");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("la fecha de compromiso se recorta a la vigencia o la toma si no hay plazo", () => {
    expect(plazoAjustado(null, "2027-04-30")).toEqual({ fecha: "2027-04-30", recortada: false });
    expect(plazoAjustado("2026-11-20", "2027-04-30")).toEqual({ fecha: "2026-11-20", recortada: false });
    expect(plazoAjustado("2027-06-01", "2027-04-30")).toEqual({ fecha: "2027-04-30", recortada: true });
  });
  it("cambio de plazo: no pasa la vigencia ni queda vacío en el BPCH y la D11", () => {
    expect(errorCambioPlazo("2027-05-01", "2027-04-30", true)).toMatch(/30-04-2027/);
    expect(errorCambioPlazo(null, "2027-04-30", true)).toMatch(/sin plazo/);
    expect(errorCambioPlazo(null, null, false)).toBeNull();
    expect(errorCambioPlazo("2027-04-30", "2027-04-30", true)).toBeNull();
  });
});

describe("Pestañas para quien solo muestrea (R6)", () => {
  const base = { muestreo: true, preparacion: true, terreno: false, asignacion: true };
  it("oculta asignación y preparación y muestra el perfil", () => {
    expect(pestanasParaPerfil(base, { soloMuestrea: true, nombre: "Muestreador de Comercial" })).toEqual({
      ...base,
      asignacion: false,
      preparacion: false,
      perfil: "Muestreador de Comercial",
    });
  });
  it("al resto no le cambia nada", () => {
    expect(pestanasParaPerfil(base, { soloMuestrea: false, nombre: null })).toEqual({ ...base, perfil: null });
  });
});
