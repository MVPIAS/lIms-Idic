/**
 * Tests del validador de RUT chileno (`rut.validator.ts`).
 *
 * Módulo 11 con dígito verificador. Cubre DV numérico, DV 'K', DV '0', formatos
 * con/sin puntos y guión, minúsculas, y entradas basura. Los RUTs válidos se
 * calcularon con el propio algoritmo módulo 11 (no son inventados).
 */
import { validaRut, formatRut } from "./rut.validator";

describe("validaRut · válidos", () => {
  it.each([
    "11111111-1",
    "12345678-5",
    "20347879-8",
    "10000013-K", // DV K (resto 10)
    "10000004-0", // DV 0 (resto 11)
  ])("acepta %s (con guión)", (rut) => {
    expect(validaRut(rut)).toBe(true);
  });

  it("acepta el formato con puntos y guión", () => {
    expect(validaRut("12.345.678-5")).toBe(true);
  });

  it("acepta el formato sin puntos ni guión", () => {
    expect(validaRut("123456785")).toBe(true);
  });

  it("acepta la K en minúscula", () => {
    expect(validaRut("10000013-k")).toBe(true);
  });
});

describe("validaRut · inválidos", () => {
  it("rechaza un DV incorrecto", () => {
    expect(validaRut("12345678-9")).toBe(false); // el correcto es 5
    expect(validaRut("11111111-2")).toBe(false);
  });

  it("rechaza null, undefined y cadena vacía", () => {
    expect(validaRut(null)).toBe(false);
    expect(validaRut(undefined)).toBe(false);
    expect(validaRut("")).toBe(false);
  });

  it("rechaza cadenas demasiado cortas (menos de 2 caracteres útiles)", () => {
    expect(validaRut("1")).toBe(false);
    expect(validaRut("-")).toBe(false);
  });

  it("rechaza basura no numérica", () => {
    expect(validaRut("ABCDEFG-H")).toBe(false);
  });
});

describe("formatRut", () => {
  it("formatea un RUT válido con puntos y guión", () => {
    expect(formatRut("123456785")).toBe("12.345.678-5");
  });

  it("preserva el DV K", () => {
    expect(formatRut("10000013K")).toBe("10.000.013-K");
  });

  it("normaliza la k minúscula a mayúscula", () => {
    expect(formatRut("10000013k")).toBe("10.000.013-K");
  });

  it("devuelve la entrada intacta si el RUT no es válido (no reformatea basura)", () => {
    expect(formatRut("12345678-9")).toBe("12345678-9");
  });
});
