import { FORMATO_BPCH, codigoVerificacionValido, nuevoCodigoVerificacion } from "./codigo-verificacion";
import { nuevoCodigoVerificacion as deMetrologia } from "../metrologia/metrologia.reglas";

describe("código de verificación · un solo generador (revisión r3, hallazgo 17)", () => {
  it("por defecto: Crockford 5-5, el que acepta la verificación pública", () => {
    for (let i = 0; i < 50; i++) expect(codigoVerificacionValido(nuevoCodigoVerificacion())).toBe(true);
  });
  it("Metrología reutiliza el mismo generador", () => {
    expect(deMetrologia).toBe(nuevoCodigoVerificacion);
  });
  it("documentos BPCH: mismo formato que antes (XXXX-XXXX-XXXX sin 0, 1, I ni O)", () => {
    for (let i = 0; i < 50; i++) expect(nuevoCodigoVerificacion(FORMATO_BPCH)).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
