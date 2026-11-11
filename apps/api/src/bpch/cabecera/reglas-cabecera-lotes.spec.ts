import { erroresLotesCabecera, lugaresDisponibles } from "./reglas-cabecera";

const unidades = { lote: ["kg", "t"], muestra: ["t", "kg", "g", "unidades"] };

describe("Lotes de la inspección del BPCH (R3)", () => {
  it("varios lotes con especificación, unidades y vencimiento", () => {
    expect(
      erroresLotesCabecera(
        [
          { identificacion: "PRUEBA-L1", tamanoLote: 2.5, unidadLote: "t", tamanoMuestra: 500, unidadMuestra: "g", vencimiento: "2027-01-31", especificacion: "PRUEBA · NCh xxx" },
          { identificacion: "PRUEBA-L2", tamanoLote: 100, unidadLote: "kg", tamanoMuestra: 3, unidadMuestra: "unidades" },
        ],
        unidades,
      ),
    ).toEqual([]);
  });
  it("identificación obligatoria y sin repetir", () => {
    const e = erroresLotesCabecera([{ identificacion: "" }, { identificacion: "A" }, { identificacion: "a" }], unidades).join(" ");
    expect(e).toMatch(/Lote 1: indique/);
    expect(e).toMatch(/repetido/);
  });
  it("tamaño con su unidad de la lista y muestra no mayor que el lote (convierte masa)", () => {
    expect(erroresLotesCabecera([{ identificacion: "A", tamanoLote: 10 }], unidades).join(" ")).toMatch(/unidad/);
    expect(erroresLotesCabecera([{ identificacion: "A", tamanoLote: 10, unidadLote: "lb" }], unidades).join(" ")).toMatch(/no está en la lista/);
    expect(erroresLotesCabecera([{ identificacion: "A", tamanoLote: 1, unidadLote: "t", tamanoMuestra: 2000, unidadMuestra: "kg" }], unidades).join(" ")).toMatch(/mayor que el lote/);
    expect(erroresLotesCabecera([{ identificacion: "A", tamanoLote: 1, unidadLote: "t", tamanoMuestra: 900, unidadMuestra: "kg" }], unidades)).toEqual([]);
  });
  it("fecha de vencimiento válida", () => {
    expect(erroresLotesCabecera([{ identificacion: "A", vencimiento: "2027-02-30x" }], unidades).join(" ")).toMatch(/vencimiento/);
  });
});

describe("Lugares de inspección (R3)", () => {
  it("plantas del cliente y lugares de la sucursal, sin repetir", () => {
    const l = lugaresDisponibles(
      [{ origen: "planta", lugar: "Planta Norte", direccion: "Calle 1", comuna: "Antofagasta" }],
      [
        { origen: "tabla", lugar: "planta norte", direccion: "x", comuna: null, sucursal: null },
        { origen: "tabla", lugar: "Faena", direccion: "Km 10", comuna: "Calama", sucursal: "SCALAM" },
        { origen: "tabla", lugar: "Bodega", direccion: "Av 2", comuna: "Antofagasta", sucursal: "SANTOF" },
      ],
      "SANTOF",
    );
    expect(l.map((x) => x.lugar)).toEqual(["Planta Norte", "Bodega"]);
  });
});
