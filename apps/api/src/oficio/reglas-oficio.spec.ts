import { editable, errorTransicionOficio, erroresDespachoOficio, erroresOficio, htmlOficio } from "./reglas-oficio";

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
