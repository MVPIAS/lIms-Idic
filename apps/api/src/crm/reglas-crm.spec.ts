import { erroresInteraccion, etapaPorCotizacion, lineaTiempo, oportunidadEnAlcance, siguienteCodigoOportunidad, type HitoCliente } from "./reglas-crm";

describe("CRM · oportunidades (EP-00 0.3)", () => {
  it("el código lleva el año en curso y reinicia el correlativo cada año", () => {
    expect(siguienteCodigoOportunidad(null, 2027)).toBe("OPP-2027-0001");
    expect(siguienteCodigoOportunidad("OPP-2027-0041", 2027)).toBe("OPP-2027-0042");
    expect(siguienteCodigoOportunidad("OPP-2026-0041", 2027)).toBe("OPP-2027-0001");
  });
  it("alcance: global, Comercial (DCO) ve todas; un laboratorio solo las suyas", () => {
    expect(oportunidadEnAlcance(null, null, "dco")).toBe(true);
    expect(oportunidadEnAlcance(["dco"], "lqc", "dco")).toBe(true);
    expect(oportunidadEnAlcance(["lqc"], "lqc", "dco")).toBe(true);
    expect(oportunidadEnAlcance(["lqc"], "lpn", "dco")).toBe(false);
    expect(oportunidadEnAlcance(["lqc"], null, "dco")).toBe(false);
  });
  it("la cotización enlazada mueve la etapa: propuesta al crearla, ganada al aceptarla", () => {
    expect(etapaPorCotizacion("creada")).toEqual({ etapa: "propuesta", estado: "viva" });
    expect(etapaPorCotizacion("aceptada")).toEqual({ etapa: "ganada", estado: "ganada" });
  });
});

describe("CRM · historial del cliente (§4.1.2)", () => {
  const h = (clase: HitoCliente["clase"], id: string, fecha: string): HitoCliente => ({ clase, id, fecha, titulo: id, detalle: null, subtipo: null, responsable: null, ruta: null });
  it("une las fuentes del más reciente al más antiguo, sin repetidos ni fechas inválidas", () => {
    const t = lineaTiempo([
      [h("cotizacion", "COT-1", "2026-10-01T12:00:00Z"), h("ot", "OT-1", "2026-10-05T09:00:00Z")],
      [h("interaccion", "llamada", "2026-10-05T09:00:00Z"), h("correo", "c1", "no es fecha"), h("ot", "OT-1", "2026-10-05T09:00:00Z")],
    ]);
    expect(t.map((x) => x.id)).toEqual(["llamada", "OT-1", "COT-1"]);
  });
  it("respeta el límite", () => {
    expect(lineaTiempo([[h("nota" as any, "a", "2026-01-01"), h("ot", "b", "2026-01-02")]], 1)).toHaveLength(1);
  });
  it("una interacción no se registra en el futuro y la próxima fecha exige la acción", () => {
    const ahora = new Date("2026-11-02T12:00:00Z");
    expect(erroresInteraccion({ fecha: new Date("2026-11-02T10:00:00Z") }, ahora)).toEqual([]);
    expect(erroresInteraccion({ fecha: new Date("2026-11-10T10:00:00Z") }, ahora)[0]).toMatch(/futura/);
    expect(erroresInteraccion({ fecha: null }, ahora)[0]).toMatch(/fecha/);
    expect(erroresInteraccion({ fecha: ahora, proximaFecha: "2026-11-09", proximaAccion: "" }, ahora)[0]).toMatch(/próxima acción/);
  });
});
