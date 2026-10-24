import { erroresCabecera, evaluarLoteSvm, evaluarVehiculo, leerPlantilla, novedades, veredictoMetodo, type InspeccionVehiculo, cabeceraDesdeRecepcion } from "./hcp";

const plantilla = leerPlantilla(
  JSON.stringify([
    { item: "2.1.1", grupo: "2. Configuración", subgrupo: "2.1 Vista frontal", requisito: "Brazo limpia parabrisas", cantidad: "02", clase: "B", metodo: "539" },
    { item: "2.10.1", grupo: "2. Configuración", subgrupo: "2.10 Inventario", requisito: "Rueda de repuesto", clase: "c", metodo: "1410" },
    { item: "4.2.1", grupo: "4. Dinámico", subgrupo: "4.2 Giro", requisito: "Viraje 360° en Ø máximo 16 m", clase: "A", metodo: "545", max: "16", unidad: "m" },
    { item: "", requisito: "sin ítem", clase: "B" },
    { item: "9", requisito: "clase rara", clase: "Z" },
  ]),
);

const cab = { inspectores: ["Analista SVM 1", "Analista SVM 2"], chasis: "CH-1", motor: "MO-1" };
const vehiculo = (numero: number, items: InspeccionVehiculo["items"], c = cab): InspeccionVehiculo => ({ numero, cabecera: c, items });

describe("HCP · plantilla", () => {
  it("lee la tabla y descarta filas inválidas", () => {
    expect(plantilla.map((i) => i.item)).toEqual(["2.1.1", "2.10.1", "4.2.1"]);
    expect(plantilla[1].clase).toBe("C");
    expect(plantilla[2]).toMatchObject({ max: 16, unidad: "m" });
  });
  it("JSON roto → plantilla vacía", () => expect(leerPlantilla("{")).toEqual([]));
});

describe("HCP · vehículo", () => {
  it("todo conforme con cabecera → inspeccionado y cumple", () => {
    const v = evaluarVehiculo(plantilla, vehiculo(1, { "2.1.1": { resultado: "C" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 15.2 } }));
    expect(v).toMatchObject({ veredicto: "cumple", estado: "inspeccionado", respondidos: 3, errores: [] });
  });
  it("cuantitativo fuera de Máx → N/C (y exige observación)", () => {
    const v = evaluarVehiculo(plantilla, vehiculo(2, { "2.1.1": { resultado: "C" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 16.4 } }));
    expect(v.veredicto).toBe("no_cumple");
    expect(v.ncPorClase.A).toBe(1);
    expect(v.errores.join(" ")).toMatch(/4\.2\.1.*observación/);
    expect(v.estado).toBe("en_inspeccion");
  });
  it("faltan ítems → pendiente / en inspección", () => {
    const v = evaluarVehiculo(plantilla, vehiculo(3, { "2.1.1": { resultado: "C" } }));
    expect(v).toMatchObject({ veredicto: "pendiente", estado: "en_inspeccion" });
  });
  it("cabecera obligatoria", () => {
    expect(erroresCabecera({ inspectores: [], chasis: "", motor: "" })).toHaveLength(3);
    expect(erroresCabecera({ ...cab, kmSalida: 100, kmLlegada: 50 }).join(" ")).toMatch(/llegada/);
    const v = evaluarVehiculo(plantilla, vehiculo(4, { "2.1.1": { resultado: "C" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 10 } }, { inspectores: [], chasis: "", motor: "" }));
    expect(v.estado).not.toBe("inspeccionado");
  });
  it("ítem desconocido", () => expect(evaluarVehiculo(plantilla, vehiculo(5, { X: { resultado: "C" } })).errores.join(" ")).toMatch(/no están en la plantilla/));
  it("veredicto por método para el resultado de la muestra", () => {
    const v = evaluarVehiculo(plantilla, vehiculo(6, { "2.1.1": { resultado: "NC", observacion: "Falta una plumilla" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 12 } }));
    expect(veredictoMetodo(v, "539")).toMatchObject({ veredicto: "no_cumple", items: 1 });
    expect(veredictoMetodo(v, "539")!.observacion).toMatch(/Falta una plumilla/);
    expect(veredictoMetodo(v, "545")).toMatchObject({ veredicto: "cumple" });
    expect(veredictoMetodo(v, "999")).toBeNull();
  });
});

describe("HCP · lote por clase", () => {
  const cfg = { nivel: "II" as const, aqlA: "0", aqlB: "2,5", aqlC: "6,5" };
  const conforme = (n: number) => evaluarVehiculo(plantilla, vehiculo(n, { "2.1.1": { resultado: "C" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 12 } }));
  it("clase A: un vehículo con N/C rechaza el lote", () => {
    const malo = evaluarVehiculo(plantilla, vehiculo(1, { "2.1.1": { resultado: "C" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 17, observacion: "Ø 17 m" } }));
    const l = evaluarLoteSvm(70, 2, [malo, conforme(2)], cfg);
    expect(l.veredicto).toBe("no_cumple");
    expect(l.clases.find((c) => c.clase === "A")).toMatchObject({ ac: 0, re: 1, vehiculosConNc: 1, decision: "rechaza" });
  });
  it("clase B dentro de Ac → acepta; falta inspeccionar → pendiente", () => {
    const b = evaluarVehiculo(plantilla, vehiculo(1, { "2.1.1": { resultado: "NC", observacion: "x" }, "2.10.1": { resultado: "C" }, "4.2.1": { valor: 12 } }));
    // Lote 70, nivel II, AQL 2,5 → Ac 1: un vehículo con N/C B se acepta.
    expect(evaluarLoteSvm(70, 2, [b, conforme(2)], cfg).veredicto).toBe("cumple");
    expect(evaluarLoteSvm(70, 13, [b, conforme(2)], cfg).veredicto).toBe("pendiente");
  });
  it("datos del lote inválidos", () => expect(evaluarLoteSvm(10, 20, [], cfg).errores.join(" ")).toMatch(/no puede superar/));
});

describe("HCP · novedades del lote", () => {
  it("una fila por N/C, ordenadas, con la acción del proveedor", () => {
    const v1 = evaluarVehiculo(plantilla, vehiculo(2, { "2.1.1": { resultado: "NC", observacion: "Falta plumilla" }, "2.10.1": { resultado: "NC", observacion: "Sin repuesto" }, "4.2.1": { valor: 12 } }));
    const n = novedades([{ evaluado: v1, chasis: "CH-2" }], { "2:2.1.1": "Reponer plumilla" });
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ vehiculo: 2, clase: "B", item: "2.1.1", accionProveedor: "Reponer plumilla" });
    expect(n[1].descripcion).toMatch(/Sin repuesto/);
  });
});

describe("D05-21 · la cabecera de la HCP propone lo registrado en la recepción del vehículo", () => {
  it("chasis, motor, año y km de llegada desde los datos propios del SVM", () => {
    expect(cabeceraDesdeRecepcion({ chasis: " 9BW-001 ", motor: "M-77", anio: "2025", km: "1.250,5".replace(".", ""), identificador: "EJTO-1" }))
      .toEqual({ chasis: "9BW-001", motor: "M-77", anio: 2025, kmLlegada: 1250.5 });
  });
  it("sin recepción: vacío", () => {
    expect(cabeceraDesdeRecepcion(null)).toEqual({ chasis: "", motor: "", anio: null, kmLlegada: null });
  });
});
