import { urlVerificacionBase } from "./url-verificacion";

describe("B-079 · URL de verificación de la instalación", () => {
  it("la explícita manda", () => expect(urlVerificacionBase({ URL_VERIFICACION: "https://lims.idic.local/verificar/", DOMAIN: "x" } as any)).toBe("https://lims.idic.local/verificar"));
  it("sin explícita, el dominio de la instalación", () => expect(urlVerificacionBase({ DOMAIN: "preprod.ejemplo.cl" } as any)).toBe("https://preprod.ejemplo.cl/verificar"));
  it("sin dominio, el primer origen de CORS", () => expect(urlVerificacionBase({ CORS_ORIGINS: "https://preprod.ejemplo.cl, http://localhost:3000" } as any)).toBe("https://preprod.ejemplo.cl/verificar"));
  it("nunca el dominio de producción por defecto", () => expect(urlVerificacionBase({} as any)).toBe("/verificar"));
});
