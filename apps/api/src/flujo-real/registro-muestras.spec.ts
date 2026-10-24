import { admiteSinEnsayos, erroresRegistro, proponerDesdeCotizacion, siguientesCodigos, type MetodoCatalogo } from "./registro-muestras";

const met = (id: string, ensayoId: string | null, analitos = 1): MetodoCatalogo => ({
  id, codigo: id.toUpperCase(), nombre: `Método ${id}`, ensayoId, analitos,
});

describe("registro de muestras desde la cotización", () => {
  const porEnsayo = new Map<string, MetodoCatalogo[]>([
    ["E1", [met("m1", "E1")]],
    ["E2", [met("m2a", "E2"), met("m2b", "E2"), met("m2c", "E2", 0)]],
    ["E3", [met("m3", "E3", 0)]],
  ]);

  it("propone marcado el único método de un ensayo", () => {
    const [l] = proponerDesdeCotizacion([{ id: "L1", descripcion: null, cantidad: 2, catEnsayoId: "E1", ensayoCodigo: "EN1", ensayoNombre: "pH" }], porEnsayo);
    expect(l.sugeridos).toEqual(["m1"]);
    expect(l.aviso).toBeNull();
    expect(l.descripcion).toBe("pH");
    expect(l.cantidad).toBe(2);
  });

  it("con varios métodos útiles no adivina: pide elegir", () => {
    const [l] = proponerDesdeCotizacion([{ id: "L2", descripcion: "Azufre", cantidad: 1, catEnsayoId: "E2", ensayoCodigo: "EN2" }], porEnsayo);
    expect(l.sugeridos).toEqual([]);
    expect(l.metodos).toHaveLength(3);
    expect(l.aviso).toMatch(/2 métodos/);
  });

  it("avisa si los métodos no tienen analitos o el ensayo no tiene métodos", () => {
    const r = proponerDesdeCotizacion(
      [
        { id: "L3", descripcion: "X", cantidad: 1, catEnsayoId: "E3", ensayoCodigo: "EN3" },
        { id: "L4", descripcion: "Y", cantidad: 1, catEnsayoId: "E9", ensayoCodigo: "EN9" },
        { id: "L5", descripcion: "Servicio de muestreo", cantidad: 1, catEnsayoId: null, ensayoCodigo: null },
      ],
      porEnsayo,
    );
    expect(r[0].aviso).toMatch(/no tienen analitos/);
    expect(r[1].aviso).toMatch(/no tiene métodos/);
    expect(r[2].aviso).toMatch(/sin ensayo del catálogo/);
    expect(r.every((l) => l.sugeridos.length === 0)).toBe(true);
  });

  it("numera las muestras después de las existentes sin repetir", () => {
    expect(siguientesCodigos("OT-2026-0001", [], 2)).toEqual(["OT-2026-0001-M1", "OT-2026-0001-M2"]);
    expect(siguientesCodigos("OT-2026-0001", ["OT-2026-0001-M1", "OT-2026-0001-M3", "otra"], 2)).toEqual([
      "OT-2026-0001-M4",
      "OT-2026-0001-M5",
    ]);
    // Códigos con caracteres de expresión regular no rompen la numeración.
    expect(siguientesCodigos("OT.1(2)", ["OT.1(2)-M7"], 1)).toEqual(["OT.1(2)-M8"]);
  });

  it("los códigos no superan 30 caracteres", () => {
    const [c] = siguientesCodigos("X".repeat(40), [], 1);
    expect(c.length).toBeLessThanOrEqual(30);
  });

  it("valida OT abierta, nombre, métodos existentes y con analitos", () => {
    const mapa = new Map([["m1", met("m1", "E1")], ["m3", met("m3", "E3", 0)]]);
    expect(erroresRegistro("recepcionada", [{ nombre: "Lote 1", metodoIds: ["m1"] }], mapa)).toEqual([]);
    expect(erroresRegistro("cerrada", [{ nombre: "Lote 1", metodoIds: ["m1"] }], mapa)[0]).toMatch(/cerrada/);
    const e = erroresRegistro("recepcionada", [{ nombre: " ", metodoIds: [] }, { nombre: "B", metodoIds: ["m3", "zz"] }], mapa);
    expect(e.join(" | ")).toMatch(/Muestra 1: indique su nombre/);
    expect(e.join(" | ")).toMatch(/Muestra 1: elija al menos un método/);
    expect(e.join(" | ")).toMatch(/M3 · Método m3 no tiene analitos/);
    expect(e.join(" | ")).toMatch(/zz no existe/);
    expect(erroresRegistro("recepcionada", [], mapa)).toEqual(["Indique al menos una muestra."]);
  });
});

describe("B-013 · testigo, custodia o contramuestra sin ensayos", () => {
  const metodos = new Map();
  it("una muestra de análisis sin métodos no se registra", () => {
    expect(erroresRegistro("recepcionada", [{ nombre: "Nitrato", metodoIds: [] }], metodos).join(" ")).toMatch(/elija al menos un método/);
    expect(erroresRegistro("recepcionada", [{ nombre: "Nitrato", metodoIds: [], claseCustodia: "analisis" }], metodos)).toHaveLength(1);
  });
  it("testigo, custodia y contramuestra van a bodega sin ensayos", () => {
    for (const clase of ["testigo", "custodia", "contramuestra"])
      expect(erroresRegistro("recepcionada", [{ nombre: "Testigo lote 4", metodoIds: [], claseCustodia: clase }], metodos)).toEqual([]);
    expect(admiteSinEnsayos("testigo")).toBe(true);
    expect(admiteSinEnsayos(null)).toBe(false);
  });
});
