import { erroresHoras, perfilMuestreo, tipoAdjunto } from "./formulario-completo";
import { fichaFormularioHtml } from "./ficha-formulario";

describe("Formulario de selección y extracción (R6)", () => {
  it("horas de inicio y término", () => {
    expect(erroresHoras("08:30", "12:00")).toEqual([]);
    expect(erroresHoras("12:00", "08:30")).toHaveLength(1);
    expect(erroresHoras("25:00", null)).toHaveLength(1);
    expect(erroresHoras(null, null)).toEqual([]);
  });
  it("perfil: el muestreador de Comercial sin plan ni costo; el inspector con plan", () => {
    const comercial = perfilMuestreo(["MUESTREO"], ["muestreo.registrar", "ot.ver", "muestra.crear"]);
    expect(comercial).toEqual({ soloMuestrea: true, verPlan: false, verCosto: false, nombre: "Muestreador de Comercial" });
    const inspector = perfilMuestreo(["INSPECTOR"], ["muestreo.registrar", "resultado.crear"]);
    expect(inspector).toMatchObject({ soloMuestrea: false, verPlan: true, nombre: "Inspector" });
    expect(perfilMuestreo(["SUPERADMIN"], [])).toMatchObject({ soloMuestrea: false, verPlan: true, verCosto: true });
  });
  it("adjunto: PDF, PNG o JPEG por su firma", () => {
    expect(tipoAdjunto(Buffer.from("%PDF-1.4"))).toBe("application/pdf");
    expect(tipoAdjunto(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(tipoAdjunto(Buffer.from("<html>"))).toBeNull();
  });
  it("ficha imprimible: campos, sellos y texto escapado", () => {
    const html = fichaFormularioHtml(
      { otCodigo: "OT-2026-0001", numeroFormulario: "PRUEBA-1", sellos: ["S1", "S2"], horaInicio: "08:00", horaTermino: "09:15", detalleMuestras: "<b>x</b>", unidades: [] },
      [],
    );
    expect(html).toContain("PRUEBA-1");
    expect(html).toContain("S1, S2");
    expect(html).toContain("08:00 · 09:15");
    expect(html).not.toContain("<b>x</b>");
  });
});
