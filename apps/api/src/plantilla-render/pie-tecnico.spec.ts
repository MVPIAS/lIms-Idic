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

describe("B-075 · firmas del circuito conservan la leyenda de la plantilla", () => {
  const { cuerpoConFirmas } = require("./plantilla-defecto");
  const cuerpo = `<p>x</p><div class="firmas">
  <div class="firma"><span class="linea"></span>Jefe Laboratorio de Química</div>
  <div class="firma"><span class="linea"></span>Jefe Departamento Químico · Por orden del Director del IDIC</div>
</div>`;
  it("la leyenda pasa a la firma que oficializa", () => {
    const h = cuerpoConFirmas(cuerpo, [
      { accion: "FIRMA", rol: "Jefe de Laboratorio", pendiente: true },
      { accion: "OFICIALIZA", rol: "Jefe de Departamento", pendiente: true },
    ]);
    expect(h).toContain("firmas-e");
    expect(h.indexOf("Por orden del Director del IDIC")).toBeGreaterThan(h.indexOf("Jefe de Departamento"));
    expect(h).not.toContain("Jefe Laboratorio de Química</div>");
  });
});
