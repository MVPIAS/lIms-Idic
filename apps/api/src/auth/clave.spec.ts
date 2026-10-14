import { erroresNuevaClave } from "./clave";

describe("Reglas de la nueva contraseña", () => {
  it("acepta una contraseña que cumple todo", () => {
    expect(erroresNuevaClave("Laboratorio2026", { actual: "Temporal12345", username: "j.perez" })).toEqual([]);
  });

  it("exige largo mínimo", () => {
    expect(erroresNuevaClave("Abc12345").join(" ")).toMatch(/al menos 10/);
  });

  it("exige letra y número", () => {
    expect(erroresNuevaClave("12345678901").join(" ")).toMatch(/letra/);
    expect(erroresNuevaClave("soloLetrasLargas").join(" ")).toMatch(/número/);
  });

  it("no puede repetir la actual", () => {
    expect(erroresNuevaClave("Temporal12345", { actual: "Temporal12345" }).join(" ")).toMatch(/distinta/);
  });

  it("no puede contener el nombre de usuario (sin distinguir mayúsculas)", () => {
    expect(erroresNuevaClave("xx-J.Perez-2026", { username: "j.perez" }).join(" ")).toMatch(/nombre de usuario/);
  });

  it("admite letras con tilde o ñ como letra", () => {
    expect(erroresNuevaClave("ñandú1234567")).toEqual([]);
  });
});
