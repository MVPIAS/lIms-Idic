import { BadRequestException } from "@nestjs/common";
import { passwordTemporal, validarClaveInicial } from "./usuarios.controller";
import { erroresNuevaClave } from "../auth/clave";

describe("Contraseña inicial del administrador (mismas reglas que el cambio de contraseña)", () => {
  it("rechaza una clave corta", () => {
    expect(() => validarClaveInicial("abc1", "prueba.usuario")).toThrow(BadRequestException);
  });
  it("rechaza una clave sin número o sin letra", () => {
    expect(() => validarClaveInicial("soloLetrasLargas", "prueba.usuario")).toThrow(/al menos un número/);
    expect(() => validarClaveInicial("1234567890", "prueba.usuario")).toThrow(/al menos una letra/);
  });
  it("rechaza una clave que contiene el nombre de usuario", () => {
    expect(() => validarClaveInicial("xprueba.usuario9", "prueba.usuario")).toThrow(/nombre de usuario/);
  });
  it("acepta una clave que cumple", () => {
    expect(() => validarClaveInicial("Clave2026Prueba", "prueba.usuario")).not.toThrow();
  });
  it("la temporal generada (alta y reset) siempre cumple las reglas", () => {
    for (let i = 0; i < 300; i++) {
      const t = passwordTemporal("abc");
      expect(t).toHaveLength(12);
      expect(erroresNuevaClave(t, { username: "abc" })).toEqual([]);
    }
  });
});
