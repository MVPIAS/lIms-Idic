import { mismoNombre } from "./contacto-principal";

describe("contacto principal (B-038)", () => {
  it("reconoce el mismo contacto aunque cambien tildes, mayúsculas o espacios", () => {
    expect(mismoNombre("José  Pérez", "jose perez")).toBe(true);
    expect(mismoNombre("Ana Soto", "Ana Sotomayor")).toBe(false);
    expect(mismoNombre("", "")).toBe(false);
  });
});
