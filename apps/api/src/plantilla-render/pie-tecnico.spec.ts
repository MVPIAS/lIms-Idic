import { textoPie } from "./pdf.renderer";

describe("B-074 · pie técnico común de los PDF", () => {
  it("lleva tildes y el código de verificación con su URL", () => {
    expect(textoPie({ numero: "M-3950", fecha: "23-10-2026", codigoVerificacion: "WENJS-DX2K8", urlVerificacion: "https://lims.local/verificar" }))
      .toBe("M-3950  |  Emitido el 23-10-2026  |  Cód. verificación: WENJS-DX2K8  |  https://lims.local/verificar");
  });
  it("sin código de verificación no imprime «Cod. verificacion: —» ni la URL", () => {
    expect(textoPie({ numero: "IT-0001", fecha: "23-10-2026", codigoVerificacion: "—", urlVerificacion: "https://lims.local/verificar" }))
      .toBe("IT-0001  |  Emitido el 23-10-2026");
    expect(textoPie({ numero: "Listado", fecha: "", codigoVerificacion: "--", urlVerificacion: "" })).toBe("Listado");
  });
});
