import { codigoPrecotizacion, erroresLineasPrecot, esPrecotizacion, motivoNoConvertir, motivoNoNuevaVersion, siguienteVersion } from "./precotizacion";

describe("pre-cotización (reunión 10, SVM)", () => {
  it("numeración propia con versión", () => {
    expect(codigoPrecotizacion(2026, 7)).toBe("PC-2026-0007");
    expect(codigoPrecotizacion(2026, 7, 2)).toBe("PC-2026-0007-v2");
    expect(siguienteVersion(null)).toBe(2);
    expect(siguienteVersion(3)).toBe(4);
  });

  it("solo valores referenciales: sin ensayos ni muestras, con descripción y monto", () => {
    expect(erroresLineasPrecot([])).toEqual(["Indique al menos un valor referencial (descripción y monto)."]);
    expect(erroresLineasPrecot([{ descripcion: "Proyecto PRUEBA", precioUnitario: 1000, cantidad: 1 }])).toEqual([]);
    const e = erroresLineasPrecot([{ descripcion: "", precioUnitario: 0, catEnsayoId: "x", muestraN: 1, cantidad: 0 }]).join(" ");
    expect(e).toMatch(/no lleva ensayos/);
    expect(e).toMatch(/no lleva muestras/);
    expect(e).toMatch(/descripción/);
    expect(e).toMatch(/monto/);
    expect(e).toMatch(/cantidad/);
  });

  it("nueva versión y cotización formal solo desde la versión vigente", () => {
    const vigente = { tipoDocumento: "precotizacion", estado: "abierta", reemplazadaPorId: null };
    expect(esPrecotizacion(vigente)).toBe(true);
    expect(motivoNoNuevaVersion(vigente)).toBeNull();
    expect(motivoNoConvertir(vigente)).toBeNull();
    // Vencida: puede volver a cotizarse años después.
    expect(motivoNoNuevaVersion({ ...vigente, estado: "expirada" })).toBeNull();
    expect(motivoNoNuevaVersion({ ...vigente, estado: "anulada", reemplazadaPorId: "v2" })).toMatch(/reemplazada/);
    expect(motivoNoConvertir({ ...vigente, estado: "anulada" })).toMatch(/anulada/);
    expect(motivoNoNuevaVersion({ tipoDocumento: "cotizacion", estado: "abierta" })).toMatch(/Solo una pre-cotización/);
  });
});
