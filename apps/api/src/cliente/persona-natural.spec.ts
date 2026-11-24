import { PersonaNaturalSchema, conflictoRut, razonSocialPersona, rutNormal } from "./persona-natural";

describe("personas naturales (Delegación Nº 11)", () => {
  it("valida RUT, nombres y apellidos; lo demás es opcional", () => {
    expect(PersonaNaturalSchema.safeParse({ rut: "11.111.111-1", nombres: "Persona", apellidos: "Prueba Uno" }).success).toBe(true);
    expect(PersonaNaturalSchema.safeParse({ rut: "11.111.111-2", nombres: "Persona", apellidos: "Prueba" }).success).toBe(false);
    expect(PersonaNaturalSchema.safeParse({ rut: "11.111.111-1", nombres: "", apellidos: "Prueba" }).success).toBe(false);
    expect(PersonaNaturalSchema.safeParse({ rut: "11.111.111-1", nombres: "P", apellidos: "Q", email: "malo" }).success).toBe(false);
    expect(PersonaNaturalSchema.parse({ rut: "11111111-1", nombres: "P", apellidos: "Q", email: "", comuna: "" })).toMatchObject({ email: undefined, comuna: undefined });
  });
  it("RUT normalizado y razón social", () => {
    expect(rutNormal("11.111.111-1")).toBe("11111111-1");
    expect(rutNormal("111111111")).toBe("11111111-1");
    expect(rutNormal("12.345.678-k")).toBe("12345678-K");
    expect(razonSocialPersona(" Persona ", " Prueba  Uno ")).toBe("Persona Prueba Uno");
  });
  it("no duplica un RUT", () => {
    expect(conflictoRut(null)).toBeNull();
    expect(conflictoRut({ es_persona_natural: true })).toMatch(/edítela/);
    expect(conflictoRut({ es_persona_natural: false })).toMatch(/empresa/);
  });
});
