import { clavesAvisoFirmaOficio, editable, errorTransicionOficio, erroresDespachoOficio, erroresOficio, etapasOficio, htmlOficio } from "./reglas-oficio";

describe("estados del oficio conductor", () => {
  it("borrador → en firma → firmado → despachado", () => {
    expect(errorTransicionOficio("borrador", "en_firma")).toBeNull();
    expect(errorTransicionOficio("en_firma", "firmado")).toBeNull();
    expect(errorTransicionOficio("firmado", "despachado")).toBeNull();
  });
  it("devuelto vuelve a firmas; no se despacha sin firmar; despachado no cambia", () => {
    expect(errorTransicionOficio("en_firma", "devuelto")).toBeNull();
    expect(errorTransicionOficio("devuelto", "en_firma")).toBeNull();
    expect(errorTransicionOficio("en_firma", "despachado")).toMatch(/no se puede despachar/);
    expect(errorTransicionOficio("borrador", "despachado")).toMatch(/borrador/);
    expect(errorTransicionOficio("despachado", "anulado")).toMatch(/anular/);
  });
  it("solo se corrige en borrador o devuelto", () => {
    expect(editable("borrador")).toBe(true);
    expect(editable("devuelto")).toBe(true);
    expect(editable("en_firma")).toBe(false);
    expect(editable("firmado")).toBe(false);
  });
});

describe("contenido del oficio (EP-00 3.1, EP-05 7.2)", () => {
  const base = { destinatario: "Comandante de prueba", materia: "Remite IVC", documentos: ["d1"], cotizacionId: null, otId: "ot", distribucion: [] };
  it("válido con OT y documento", () => {
    expect(erroresOficio(base)).toEqual([]);
  });
  it("desde una cotización no exige documentos", () => {
    expect(erroresOficio({ ...base, otId: null, documentos: [], cotizacionId: "c" })).toEqual([]);
  });
  it("sin vínculo, sin documento, sin destinatario ni materia, distribución inválida", () => {
    expect(erroresOficio({ ...base, otId: null })[0]).toMatch(/cotización o documentos/);
    expect(erroresOficio({ ...base, documentos: [] })[0]).toMatch(/documento/);
    expect(erroresOficio({ ...base, destinatario: " " })[0]).toMatch(/destinatario/);
    expect(erroresOficio({ ...base, materia: "" })[0]).toMatch(/materia/);
    expect(erroresOficio({ ...base, distribucion: [{ destinatario: "DCO", ejemplares: 0 }] })[0]).toMatch(/ejemplares/);
  });
  it("despacho por Oficina de partes: Nº y fecha no futura", () => {
    expect(erroresDespachoOficio({ numero: "123", fecha: "2026-10-22", hoy: "2026-10-22" })).toEqual([]);
    expect(erroresDespachoOficio({ numero: "", fecha: "2026-10-22", hoy: "2026-10-22" })[0]).toMatch(/Nº/);
    expect(erroresDespachoOficio({ numero: "1", fecha: "2026-10-23", hoy: "2026-10-22" })[0]).toMatch(/futura/);
  });
});

describe("cuerpo del oficio", () => {
  it("escapa los datos y lista referencias y distribución", () => {
    const h = htmlOficio({
      numero: "OF-DCO-2026-0001",
      unidad: { codigo: "DCO", nombre: "Departamento Comercial" },
      fecha: "22-10-2026",
      destinatario: "Jefe <b>X</b>",
      materia: "Remite cotización",
      cuerpo: "Primer párrafo.\n\nSegundo párrafo.",
      referencias: ["Cotización 2026-00001"],
      distribucion: [{ destinatario: "Archivo DCO", ejemplares: 1 }],
      despacho: null,
    });
    expect(h).toContain("OFICIO OF-DCO-2026-0001");
    expect(h).toContain("Jefe &lt;b&gt;X&lt;/b&gt;");
    expect(h).toContain("Cotización 2026-00001");
    expect(h).toContain("<p>Segundo párrafo.</p>");
    expect(h).toContain("Archivo DCO");
  });
});

describe("avisos de firma de un oficio que dejan de estar pendientes (F091)", () => {
  it("una clave por paso, sin repetir ni vacíos", () => {
    expect(clavesAvisoFirmaOficio(["p1", "p2", "p1", null, undefined, ""])).toEqual(["oficio_firma:p1", "oficio_firma:p2"]);
    expect(clavesAvisoFirmaOficio([])).toEqual([]);
  });
});

describe("barra de etapas del oficio (circuito real)", () => {
  const cotizacion = [
    { id: "a", orden: 1, accion: "VB", rolNombre: "Jefe de Departamento", unidadCodigo: "DCO", estado: "firmado" },
    { id: "b", orden: 2, accion: "VB", rolNombre: "Jefe de Laboratorio", unidadCodigo: "LQC", estado: "pendiente" },
    { id: "c", orden: 3, accion: "VB", rolNombre: "Subdirector", unidadCodigo: null, estado: "pendiente" },
    { id: "d", orden: 4, accion: "FIRMA", rolNombre: "Director", unidadCodigo: null, estado: "pendiente" },
  ];
  it("oficio de cotización en firma: Elaborar, los 4 pasos de OFICIO_COTIZACION y Despacho", () => {
    const e = etapasOficio({ estado: "en_firma", pasos: [{ id: "x", orden: 1, accion: "VB", rolNombre: "Viejo", estado: "anulado" }, ...cotizacion], pasoActual: ["b"] });
    expect(e.map((x) => x.titulo)).toEqual([
      "Elaborar",
      "V°B° Jefe de Departamento · DCO",
      "V°B° Jefe de Laboratorio · LQC",
      "V°B° Subdirector",
      "Firma Director",
      "Despacho por Oficina de partes",
    ]);
    expect(e.map((x) => x.estado)).toEqual(["hecho", "hecho", "actual", "pendiente", "pendiente", "pendiente"]);
  });
  it("en borrador usa los pasos previstos por la matriz; firmado deja todo hecho y el despacho como actual", () => {
    const b = etapasOficio({ estado: "borrador", pasos: [], previstos: cotizacion.map((p) => ({ ...p, id: null, estado: null })) });
    expect(b).toHaveLength(6);
    expect(b[0].estado).toBe("actual");
    expect(b.slice(1).every((x) => x.estado === "pendiente")).toBe(true);
    const f = etapasOficio({ estado: "firmado", pasos: cotizacion });
    expect(f.map((x) => x.estado)).toEqual(["hecho", "hecho", "hecho", "hecho", "hecho", "actual"]);
  });
  it("sin pasos conocidos muestra el circuito genérico", () => {
    expect(etapasOficio({ estado: "borrador", pasos: [] }).map((x) => x.titulo)).toEqual([
      "Elaborar",
      "V°B° Jefe de Departamento",
      "Firma de la Dirección",
      "Despacho por Oficina de partes",
    ]);
  });
});
