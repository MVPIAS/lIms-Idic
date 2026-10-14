import { permisoParaCompletar } from "./permiso-paso";

describe("permiso para completar un paso del flujo de la OT", () => {
  const p = (actividad: string, configJson: unknown = {}) => ({ actividad, configJson });

  it("el permiso fijado en el paso manda", () => {
    expect(permisoParaCompletar(p("Análisis instrumental", { permiso: "certificado.emitir" }), "FLU-QUI")).toBe("certificado.emitir");
    // Un valor que no parece un permiso se ignora.
    expect(permisoParaCompletar(p("Análisis instrumental", { permiso: "todo" }), "FLU-QUI")).toBe("resultado.crear");
  });

  it("aprobación y supervisión exigen aprobar resultados", () => {
    expect(permisoParaCompletar(p("Aprobación escalonada"), "FLU-QUI")).toBe("resultado.aprobar");
    expect(permisoParaCompletar(p("Aprobación (supervisor)"), "FLU-BAL")).toBe("resultado.aprobar");
    expect(permisoParaCompletar(p("Aprobación (jefe metrología)"), "FLU-MET")).toBe("resultado.aprobar");
  });

  it("control de calidad exige revisar", () => {
    expect(permisoParaCompletar(p("Control de calidad"), "FLU-QUI")).toBe("resultado.revisar");
  });

  it("registro, custodia y almacén son de quien registra muestras", () => {
    expect(permisoParaCompletar(p("Registro + cadena de custodia"), "FLU-QUI")).toBe("muestra.crear");
    expect(permisoParaCompletar(p("Almacén / ubicación de evidencia"), "FLU-BAL")).toBe("muestra.crear");
    expect(permisoParaCompletar(p("Muestreo"), "FLU-ENE")).toBe("muestra.crear");
  });

  it("el trabajo de laboratorio exige capturar resultados", () => {
    expect(permisoParaCompletar(p("Siembra"), "FLU-MIC")).toBe("resultado.crear");
    expect(permisoParaCompletar(p("Incubación (temporizada)"), "FLU-MIC")).toBe("resultado.crear");
    expect(permisoParaCompletar(p(""), null)).toBe("resultado.crear");
  });

  it("flujo comercial: cotización, firma y aceptación", () => {
    expect(permisoParaCompletar(p("Generación de cotización"), "FLU-COM")).toBe("cotizacion.crear");
    expect(permisoParaCompletar(p("Remite cotización al cliente"), "FLU-COM")).toBe("cotizacion.crear");
    expect(permisoParaCompletar(p("Revisión y firma (Jefe DCO)"), "FLU-COM")).toBe("cotizacion.aprobar");
    expect(permisoParaCompletar(p("Aceptación del cliente (OPI/OC)"), "FLU-COM")).toBe("cotizacion.aceptar");
  });

  it("ningún paso queda abierto a solo lectura (ot.ver)", () => {
    for (const a of ["Registro", "Análisis", "Aprobación", "Control de calidad", "Generación de cotización", "Paso libre"])
      expect(permisoParaCompletar(p(a), "FLU-X")).not.toBe("ot.ver");
  });
});
