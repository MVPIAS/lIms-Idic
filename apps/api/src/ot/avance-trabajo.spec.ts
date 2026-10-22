import { calcularAvance, type HechosOt } from "./avance-ot";

/** OT del LRB con muestra y analista asignado, sin capturas. */
function base(p: Partial<HechosOt> = {}): HechosOt {
  return {
    id: "ot-1",
    codigo: "OT-2026-0100",
    estado: "recepcionada",
    origen: "COTIZACION",
    conCobro: true,
    unidad: { codigo: "LRB" },
    cotizacion: { codigo: "2026-00001", estado: "aceptada" },
    muestras: { total: 1, recepcionIncompleta: 0 },
    analistas: ["Analista LRB"],
    resultados: { total: 1, pendientes: 1, capturados: 0, revisados: 0, aprobados: 0, devueltos: 0 },
    documentos: [],
    factura: null,
    ...p,
  };
}
const trabajo = (estado: string | null, laboratorio = "LRB") => ({ laboratorio, titulo: laboratorio === "LEM" ? "Proyecto de Párrafo (trabajo en terreno)" : "Planilla de trabajo", exige: true, estado, texto: "x" });

describe("Ruta de la OT · preparación del trabajo del DSA (EP-05 2.2–2.3)", () => {
  it("sin aprobación exigida no hay etapa nueva", () => {
    expect(calcularAvance(base()).etapas.map((e) => e.clave)).not.toContain("preparacion");
    expect(calcularAvance(base({ trabajoDsa: { ...trabajo(null), exige: false } })).etapas.map((e) => e.clave)).not.toContain("preparacion");
  });
  it("entre asignación y análisis; sin preparar le toca al analista", () => {
    const a = calcularAvance(base({ trabajoDsa: trabajo(null) }));
    const claves = a.etapas.map((e) => e.clave);
    expect(claves.indexOf("preparacion")).toBe(claves.indexOf("asignacion") + 1);
    expect(a.etapaActual).toBe("preparacion");
    expect(a.siguiente?.texto).toMatch(/Preparar la Planilla de trabajo/);
    expect(a.siguiente?.accion).toMatchObject({ pestana: "preparacion", permisos: ["resultado.crear", "ot.asignar"] });
  });
  it("en aprobación le toca al Jefe de Laboratorio; aprobada pasa al análisis", () => {
    const a = calcularAvance(base({ trabajoDsa: trabajo("en_aprobacion") }));
    expect(a.siguiente?.leToca?.rol).toBe("Jefe de Laboratorio");
    expect(a.siguiente?.accion?.permisos).toEqual(["ot.preparacion.aprobar"]);
    const b = calcularAvance(base({ trabajoDsa: trabajo("aprobada") }));
    expect(b.etapas.find((e) => e.clave === "preparacion")?.estado).toBe("hecho");
    expect(b.etapaActual).toBe("analisis");
  });
  it("LEM en terreno: valida la Sección y aprueba el Jefe DSA", () => {
    expect(calcularAvance(base({ unidad: { codigo: "LEM" }, trabajoDsa: trabajo("en_aprobacion", "LEM") })).siguiente?.leToca?.unidad).toBe("SEM");
    expect(calcularAvance(base({ unidad: { codigo: "LEM" }, trabajoDsa: trabajo("validada", "LEM") })).siguiente?.leToca?.unidad).toBe("DSA");
  });
  it("devuelta: corregir y enviar de nuevo", () => {
    expect(calcularAvance(base({ trabajoDsa: trabajo("devuelta") })).siguiente?.texto).toMatch(/Corregir la Planilla de trabajo devuelta/);
  });
});
